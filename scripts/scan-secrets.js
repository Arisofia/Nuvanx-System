#!/usr/bin/env node
'use strict';

const cp = require('node:child_process');
const fs = require('node:fs');

const tracked = cp.execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .filter((file) => !file.startsWith('node_modules/') && !file.startsWith('frontend/node_modules/'));

const patterns = [
  { name: 'Postgres URL with inline password', re: /postgres(?:ql)?:\/\/[^\s:@$]+:(?!password@|\$\{)[^\s:@$]{8,}@[^\s]+/i },
  { name: 'Supabase pooler URL with inline password', re: /postgres\.[a-z0-9]+:(?!\$\{)[^\s:@$]{8,}@aws-[^\s]+\.pooler\.supabase\.com/i },
  { name: 'AWS access key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/ },
  {
    name: 'Hardcoded secret assignment',
    re: /(?:SECRET|TOKEN|API_KEY|PASSWORD|SERVICE_ROLE_KEY|PRIVATE_KEY)\s*[:=]\s*['\"](?!env\(|\.\.\.|REPLACE_ME|changeme|example|test-|your-|\$)[^'\"\s]{20,}['\"]/i,
  },
];

const findings = [];
for (const file of tracked) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const pattern of patterns) {
      if (pattern.re.test(line)) {
        if (pattern.name === 'Private key block' && line.includes('replaceAll(')) continue;
        findings.push({ file, line: index + 1, pattern: pattern.name });
      }
    }
  });
}

if (findings.length > 0) {
  console.error('Potential secrets found:');
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} (${finding.pattern})`);
  }
  process.exit(1);
}

console.log(`Secret scan passed (${tracked.length} tracked files scanned).`);
