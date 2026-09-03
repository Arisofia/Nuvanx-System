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
  'legacy-only',
  'mock-',
  'must-never-be-stored',
  'must-not-appear',
  'must-not-leak',
  'placeholder',
  'redacted',
  'refresh-token',
  'runtime-secret',
  'sensitive-',
  'service-role',
  'service-role-value',
  'test-',
  'your-',
];

const POSTGRES_URL_RE = /postgres(?:ql)?:\/\/[^\s'"<>]+/gi;
const AWS_ACCESS_KEY_RE = /AKIA[0-9A-Z]{16}/;
const HARDCODED_SECRET_ASSIGNMENT_RE = /([A-Z0-9_]*(?:SECRET|TOKEN|API_KEY|PASSWORD|SERVICE_ROLE|PRIVATE_KEY)[A-Z0-9_]*)\s*[:=]\s*(['"])([^'"\r\n]{20,})\2/gi;

function isSecretIdentifier(identifier) {
  const upper = String(identifier || '').trim().toUpperCase();
  if (!/(?:SECRET|TOKEN|API_KEY|PASSWORD|SERVICE_ROLE|PRIVATE_KEY)/.test(upper)) {
    return false;
  }
  if (/(?:_URL|_URI|_ENDPOINT|_LABEL|_MODE|_FORMAT|_TYPE|_NAME|_PROP)$/.test(upper)) {
    return false;
  }
  if (/^(?:TOKENLABEL|TOKENMODE|TOKENURL|TOKENURI)$/.test(upper)) {
    return false;
  }
  return true;
}

function normalizedPlaceholderPassword(password) {
  return String(password || '')
    .trim()
    .replace(/^[[({<]+|[\])}>]+$/g, '')
    .toLowerCase();
}

function isPlaceholderPassword(password) {
  const raw = String(password || '').trim();
  const normalized = normalizedPlaceholderPassword(raw);
  return (
    raw.startsWith('$')
    || normalized.includes('example')
    || normalized.includes('placeholder')
    || normalized.includes('redacted')
    || POSTGRES_PLACEHOLDER_PASSWORDS.has(normalized)
  );
}

function parsePostgresCredential(rawUrl) {
  const cleaned = String(rawUrl || '').replace(/[),;]+$/g, '');
  const match = cleaned.match(/^postgres(?:ql)?:\/\/([^:@$]+):([^@]+)@([^/:]+)/i);
  if (!match) return null;
  return {
    user: match[1],
    password: match[2],
    host: match[3].toLowerCase(),
  };
}

function postgresCredentialFindings(line) {
  const findings = [];
  POSTGRES_URL_RE.lastIndex = 0;
  for (const match of String(line || '').matchAll(POSTGRES_URL_RE)) {
    const credential = parsePostgresCredential(match[0]);
    if (!credential) continue;
    if (isPlaceholderPassword(credential.password)) continue;
    if (
      credential.user.toLowerCase() === 'postgres'
      && credential.password === 'postgres'
      && (credential.host === '127.0.0.1' || credential.host === 'localhost')
    ) continue;
    if (credential.password.length < 8) continue;

    findings.push(
      credential.host.endsWith('.pooler.supabase.com')
        ? 'Supabase pooler URL with inline password'
        : 'Postgres URL with inline password',
    );
  }
  return findings;
}

function isPlaceholderPostgresUrlLine(line) {
  const urls = Array.from(String(line || '').matchAll(POSTGRES_URL_RE));
  if (urls.length === 0) return false;
  return urls.every((match) => {
    const credential = parsePostgresCredential(match[0]);
    return !credential || isPlaceholderPassword(credential.password);
  });
}

function isLocalPostgresHarnessLine(line) {
  const urls = Array.from(String(line || '').matchAll(POSTGRES_URL_RE));
  if (urls.length !== 1) return false;
  const credential = parsePostgresCredential(urls[0][0]);
  return Boolean(
    credential
    && credential.user.toLowerCase() === 'postgres'
    && credential.password === 'postgres'
    && (credential.host === '127.0.0.1' || credential.host === 'localhost')
  );
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

function shannonEntropy(value) {
  const raw = String(value || '');
  if (!raw) return 0;
  const counts = new Map();
  for (const char of raw) counts.set(char, (counts.get(char) || 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / raw.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function looksHighEntropySecret(value) {
  const normalized = String(value || '').trim();
  if (normalized.length < 24 || /\s/.test(normalized)) return false;
  const uniqueRatio = new Set(normalized).size / normalized.length;
  return shannonEntropy(normalized) >= 4.25 && uniqueRatio >= 0.45;
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

function isTinyPemTestFixture(file, value) {
  if (!isTestLikePath(file)) return false;
  const normalized = normalizeEscapedNewlines(value);
  return (
    normalized.includes('-----BEGIN ')
    && normalized.includes('PRIVATE KEY-----')
    && findPrivateKeyMaterial(normalized) === null
  );
}

function scanText(file, text) {
  const findings = [];
  const lines = String(text || '').split(/\r?\n/);

  lines.forEach((line, index) => {
    for (const pattern of postgresCredentialFindings(line)) {
      findings.push({ file, line: index + 1, pattern });
    }

    if (AWS_ACCESS_KEY_RE.test(line)) {
      findings.push({ file, line: index + 1, pattern: 'AWS access key' });
    }

    HARDCODED_SECRET_ASSIGNMENT_RE.lastIndex = 0;
    for (const match of line.matchAll(HARDCODED_SECRET_ASSIGNMENT_RE)) {
      const identifier = match[1];
      const value = match[3];
      if (!isSecretIdentifier(identifier)) continue;
      if (isDynamicSecretReference(value)) continue;
      if (looksHighEntropySecret(value)) {
        findings.push({ file, line: index + 1, pattern: 'Hardcoded secret assignment' });
        continue;
      }
      if (isHumanReadableDiagnostic(identifier, value)) continue;
      if (isClearlySyntheticFixture(file, value)) continue;
      if (isTinyPemTestFixture(file, value)) continue;
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
  isSecretIdentifier,
  isTestLikePath,
  isTinyPemTestFixture,
  looksHighEntropySecret,
  postgresCredentialFindings,
  scanText,
  scanTrackedFiles,
  shannonEntropy,
};
