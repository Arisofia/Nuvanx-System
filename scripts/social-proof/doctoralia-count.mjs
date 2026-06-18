#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const url = process.env.DOCTORALIA_URL || 'https://www.doctoralia.es/clinicas/nuvanx-medicina-estetica-laser-endolift';
const fallback = Number(process.env.FALLBACK_DOCTORALIA_COUNT || 98);
const outDir = process.env.OUT_DIR || 'tmp/social-proof-audit';

function firstCount(text) {
  const plain = text.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const patterns = [
    /Opiniones sobre los especialistas \((\d{1,4})\)/i,
    /especialistas \((\d{1,4})\)/i,
    /(\d{1,4}) opiniones/i
  ];
  for (const pattern of patterns) {
    const match = plain.match(pattern);
    if (match) {
      const value = Number(match[1]);
      if (value > 0) return value;
    }
  }
  return null;
}

await fs.mkdir(outDir, { recursive: true });
let count = fallback;
let source = 'fallback';
let status = 0;
let error = '';

try {
  const response = await fetch(`${url}?count_audit=${Date.now()}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 NUVANX-Doctoralia-Count/1.0',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    },
    redirect: 'follow'
  });
  status = response.status;
  const html = await response.text();
  await fs.writeFile(path.join(outDir, 'doctoralia-count-source.html'), html, 'utf8');
  const parsed = firstCount(html);
  if (parsed) {
    count = parsed;
    source = 'doctoralia_public_html';
  }
} catch (err) {
  error = String(err?.message || err);
}

const report = { url, count, source, status, fallback, error };
await fs.writeFile(path.join(outDir, 'doctoralia-count.json'), JSON.stringify(report, null, 2), 'utf8');
await fs.writeFile(path.join(outDir, 'doctoralia-count.env'), `DOCTORALIA_COUNT=${count}\nDOCTORALIA_COUNT_SOURCE=${source}\n`, 'utf8');

if (process.env.GITHUB_OUTPUT) {
  await fs.appendFile(process.env.GITHUB_OUTPUT, `doctoralia_count=${count}\nsource=${source}\n`);
}

console.log(JSON.stringify(report, null, 2));
