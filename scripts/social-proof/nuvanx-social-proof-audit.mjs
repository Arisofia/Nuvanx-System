#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const pages = [
  'https://nuvanx.com/',
  'https://nuvanx.com/medicina-estetica-laser/',
  'https://nuvanx.com/contacto/',
  'https://nuvanx.com/equipo-medico/',
  'https://nuvanx.com/nosotros/',
  'https://nuvanx.com/endolift-facial-el-lifting-sin-cirugia-que-revoluciona-la-medicina-estetica/',
  'https://nuvanx.com/clinicas-de-medicina-estetica-nuvanx/medicina-estetica-goya-barrio-salamanca/'
];

const expectedCount = Number(process.env.EXPECTED_DOCTORALIA_COUNT || 98);
const outDir = process.env.OUT_DIR || 'tmp/social-proof-audit';
const stamp = Date.now();

function matches(text, needle) {
  return text.includes(needle);
}

function count(text, needle) {
  return text.split(needle).length - 1;
}

function fileName(url) {
  return url.replace(/^https:\/\/nuvanx\.com\/?/, '').replace(/[/?#=&:]+/g, '-') || 'home';
}

async function fetchHtml(url) {
  const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}social_proof_audit=${stamp}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 NUVANX-Social-Proof-Audit',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    },
    redirect: 'follow'
  });
  return { status: response.status, html: await response.text() };
}

function validate(url, status, html) {
  const start = html.indexOf('NVX_DOCTORALIA_SOCIAL_PROOF_V2_START');
  const end = html.indexOf('NVX_DOCTORALIA_SOCIAL_PROOF_V2_END');
  const block = start >= 0 && end > start ? html.slice(start, end) : '';

  const row = block.indexOf('nvx-doctoralia-proof__headline-row');
  const stat = row >= 0 ? block.indexOf('nvx-doctoralia-proof__stat', row) : -1;
  const countPos = row >= 0 ? block.indexOf(`${expectedCount} opiniones`, row) : -1;
  const lead = row >= 0 ? block.indexOf('nvx-doctoralia-proof__lead', row) : -1;
  const withinRow = row >= 0 && stat >= 0 && countPos >= 0 && lead >= 0 && stat < lead && countPos < lead;

  const checks = {
    http200: status === 200,
    doctoraliaBlock: block.length > 0,
    countVisible: matches(block, `${expectedCount} opiniones`),
    ctaVisible: matches(block, `Ver ${expectedCount} opiniones en Doctoralia`),
    visualRow: matches(block, 'nvx-doctoralia-proof__headline-row'),
    visualStat: matches(block, 'nvx-doctoralia-proof__stat'),
    statWithinVisualRow: withinRow,
    cssNoWrap: matches(html, 'white-space:nowrap'),
    cssMaxContent: matches(html, 'max-width:max-content'),
    googleBlock: matches(html, 'NVX_GOOGLE_REVIEW_REQUEST_BLOCK_START'),
    chamberiLink: matches(html, '14466361551980384911'),
    goyaLink: matches(html, '180607008212147292'),
    noOld93: !/93 opiniones|93 reseñas/i.test(html),
    noPhpErrors: !/Fatal error|Parse error|Warning: |Notice: |Deprecated:/i.test(html),
    noNoindex: !/noindex/i.test(html)
  };

  return {
    url,
    status,
    counts: {
      doctoraliaBlocks: count(html, 'NVX_DOCTORALIA_SOCIAL_PROOF_V2_START'),
      opinions: count(html, `${expectedCount} opiniones`),
      googleBlocks: count(html, 'NVX_GOOGLE_REVIEW_REQUEST_BLOCK_START')
    },
    checks,
    failures: Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key)
  };
}

await fs.mkdir(outDir, { recursive: true });
const results = [];
for (const url of pages) {
  const { status, html } = await fetchHtml(url);
  await fs.writeFile(path.join(outDir, `${fileName(url)}.html`), html, 'utf8');
  results.push(validate(url, status, html));
}

const failures = results.flatMap((r) => r.failures.map((f) => `${r.url}:${f}`));
const report = { expectedCount, validationFail: failures.length, results, failures };
await fs.writeFile(path.join(outDir, 'social-proof-report.json'), JSON.stringify(report, null, 2), 'utf8');
await fs.writeFile(path.join(outDir, 'social-proof-env.txt'), `DOCTORALIA_COUNT=${expectedCount}\nVALIDATION_FAIL=${failures.length}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exit(1);
