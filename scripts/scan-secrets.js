#!/usr/bin/env node
'use strict';

const cp = require('node:child_process');
const fs = require('node:fs');

const POSTGRES_PLACEHOLDER_PASSWORDS = new Set([
  'password',
  'pass',
  'pass-with-dashes_and.dots',
  'db_password',
  'database_password',
  'supabase_db_password',
  'redacted_password',
  'your_password',
  'your-password',
]);

const SYNTHETIC_FIXTURE_MARKERS = [
  '\\ntest\\n',
  'client-secret',
  'credential-material',
  'developer-token',
  'do-not-leak',
  'do-not-log',
  'ephemeral-access-token',
  'example-',
  'fake-',
  'integration-contract',
  'mock-',
  'must-never-be-stored',
  'must-not-appear',
  'must-not-leak',
  'placeholder',
  'redacted',
  'refresh-token',
  'runtime-secret',
  'sensitive-',
  'service-role-value',
  'test-',
  'your-',
];

const POSTGRES_INLINE_PASSWORD_RE = /postgres(?:ql)?:\/\/[^\s:@$]+:(?!password@|\$\{)[^\s:@$]{8,}@[^\s]+/i;
const SUPABASE_POOLER_INLINE_PASSWORD_RE = /postgres\.[a-z0-9]+:(?!\$\{)[^\s:@$]{8,}@aws-[^\s]+\.pooler\.supabase\.com/i;
const AWS_ACCESS_KEY_RE = /AKIA[0-9A-Z]{16}/;
const HARDCODED_SECRET_ASSIGNMENT_RE = /([A-Z0-9_]*(?:SECRET|TOKEN|API_KEY|PASSWORD|SERVICE_ROLE|PRIVATE_KEY)[A-Z0-9_]*)\s*[:=]\s*(['"])([^'"\r\n]{20,})\2/gi;

function isPlaceholderPostgresUrlLine(line) {
  const urlPasswordPattern = /postgres(?:ql)?:\/\/[^\s:@$]+:([^@\s]+)@/gi;
  const matches = Array.from(line.matchAll(urlPasswordPattern));

  if (matches.length === 0) return false;

  return matches.every((match) => {
    const password = match[1].trim();
    const normalized = password
      .replace(/^[[({<]+|[\])}>]+$/g, '')
      .toLowerCase();

    return (
      password.startsWith('${')
      || normalized.includes('example')
      || normalized.includes('placeholder')
      || normalized.includes('redacted')
      || POSTGRES_PLACEHOLDER_PASSWORDS.has(normalized)
    );
  });
}

function isLocalPostgresHarnessLine(line) {
  return /postgres(?:ql)?:\/\/postgres:postgres@(?:127\.0\.0\.1|localhost)(?::\d+)?\//i.test(line);
}

function isTestLikePath(file) {
  const normalized = String(file || '').replace(/\\/g, '/').toLowerCase();
  return (
    normalized.includes('/tests/')
    || normalized.includes('/test/')
    || /(?:^|\/)tests?\./.test(normalized)
    || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(normalized)
    || normalized.includes('.contract.test.')
    || normalized.includes('-contract.test.')
  );
}

function isClearlySyntheticFixture(file, value) {
  if (!isTestLikePath(file)) return false;
  const normalized = String(value || '').trim().toLowerCase();
  return SYNTHETIC_FIXTURE_MARKERS.some((marker) => normalized.includes(marker));
}

function isDynamicSecretReference(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return true;
  return (
    normalized.startsWith('$')
    || normalized.includes('${{')
    || normalized.includes('${')
    || normalized.includes('$(')
    || /^env\([A-Z0-9_]+\)$/i.test(normalized)
  );
}

function isHumanReadableDiagnostic(identifier, value) {
  const key = String(identifier || '').trim().toUpperCase();
  const normalized = String(value || '').trim();
  const diagnosticKey = (
    /^(?:MISSING|INVALID|UNKNOWN|UNEXPECTED|FAILURE|ERROR|DENIED|UNAVAILABLE)_/.test(key)
    || /_(?:ERROR|FAILURE|MESSAGE|DENIED|UNAVAILABLE)$/.test(key)
  );
  if (!diagnosticKey || !/\s/.test(normalized)) return false;
  return /[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(normalized);
}

function normalizeEscapedNewlines(text) {
  return String(text || '')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n');
}

function findPrivateKeyMaterial(text) {
  const normalized = normalizeEscapedNewlines(text);
  const re = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s*([A-Za-z0-9+/=\s]{64,}?)\s*-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g;
  for (const match of normalized.matchAll(re)) {
    const body = String(match[1] || '').replace(/\s+/g, '');
    if (body.length >= 64 && /^[A-Za-z0-9+/=]+$/.test(body)) {
      return { index: match.index || 0 };
    }
  }
  return null;
}

function scanText(file, text) {
  const findings = [];
  const lines = String(text || '').split(/\r?\n/);

  lines.forEach((line, index) => {
    if (
      POSTGRES_INLINE_PASSWORD_RE.test(line)
      && !isPlaceholderPostgresUrlLine(line)
      && !isLocalPostgresHarnessLine(line)
    ) {
      findings.push({ file, line: index + 1, pattern: 'Postgres URL with inline password' });
    }

    if (SUPABASE_POOLER_INLINE_PASSWORD_RE.test(line)) {
      findings.push({ file, line: index + 1, pattern: 'Supabase pooler URL with inline password' });
    }

    if (AWS_ACCESS_KEY_RE.test(line)) {
      findings.push({ file, line: index + 1, pattern: 'AWS access key' });
    }

    HARDCODED_SECRET_ASSIGNMENT_RE.lastIndex = 0;
    for (const match of line.matchAll(HARDCODED_SECRET_ASSIGNMENT_RE)) {
      const identifier = match[1];
      const value = match[3];
      if (isDynamicSecretReference(value)) continue;
      if (isHumanReadableDiagnostic(identifier, value)) continue;
      if (isClearlySyntheticFixture(file, value)) continue;
      findings.push({ file, line: index + 1, pattern: 'Hardcoded secret assignment' });
    }
  });

  const privateKey = findPrivateKeyMaterial(text);
  if (privateKey) {
    const line = String(text || '').slice(0, privateKey.index).split(/\r?\n/).length;
    findings.push({ file, line, pattern: 'Private key block' });
  }

  return findings;
}

function trackedFiles() {
  return cp.execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .filter((file) => !file.startsWith('node_modules/') && !file.startsWith('frontend/node_modules/'));
}

function scanTrackedFiles(files = trackedFiles()) {
  const findings = [];
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    findings.push(...scanText(file, text));
  }
  return { findings, scanned: files.length };
}

function main() {
  const { findings, scanned } = scanTrackedFiles();
  if (findings.length > 0) {
    console.error('Potential secrets found:');
    for (const finding of findings) {
      console.error(`- ${finding.file}:${finding.line} (${finding.pattern})`);
    }
    process.exit(1);
  }
  console.log(`Secret scan passed (${scanned} tracked files scanned).`);
}

if (require.main === module) main();

module.exports = {
  findPrivateKeyMaterial,
  isClearlySyntheticFixture,
  isDynamicSecretReference,
  isHumanReadableDiagnostic,
  isLocalPostgresHarnessLine,
  isPlaceholderPostgresUrlLine,
  isTestLikePath,
  scanText,
  scanTrackedFiles,
};
