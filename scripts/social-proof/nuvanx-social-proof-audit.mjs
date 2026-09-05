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
  'https://nuvanx.com/clinicas-de-medicina-estetica-nuvanx/medicina-estetica-goya-barrio-salamanca/',
];

const retiredRuntimeMarkers = [
  'NVX_DOCTORALIA_SOCIAL_PROOF_V2_START',
  'nvx-doctoralia-proof',
  'NVX_GOOGLE_REVIEW_REQUEST_BLOCK_START',
  'nvx-google-review-request',
  'NVX_DOCTORALIA_PRICE_BLOCK_START',
  'nvx-doctoralia-price',
  'NVX_BARRIO_SALAMANCA_SEO_BLOCK_START',
  'nvx-barrio-salamanca-seo',
];

const outDir = process.env.OUT_DIR || 'tmp/social-proof-audit';
const stamp = Date.now();

function fileName(url) {
  return url.replace(/^https:\/\/nuvanx\.com\/?/, '').replace(/[/?#=&:]+/g, '-') || 'home';
}

async function fetchHtml(url) {
  const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}wordpress_owner_audit=${stamp}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 NUVANX-WordPress-Owner-Audit',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
    redirect: 'follow',
  });
  return { status: response.status, finalUrl: response.url || url, html: await response.text() };
}

function validate(url, status, finalUrl, html) {
  const legacyMarkers = retiredRuntimeMarkers.filter((marker) => html.includes(marker));
  const checks = {
    http200: status === 200,
    canonicalHost: (() => {
      try {
        return new URL(finalUrl).hostname === 'nuvanx.com';
      } catch {
        return false;
      }
    })(),
    noRetiredWordPressInjection: legacyMarkers.length === 0,
    noPhpErrors: !/Fatal error|Parse error|Warning: |Notice: |Deprecated:/i.test(html),
  };

  return {
    url,
    finalUrl,
    status,
    legacyMarkers,
    checks,
    failures: Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key),
  };
}

await fs.mkdir(outDir, { recursive: true });
const results = [];
for (const url of pages) {
  const { status, finalUrl, html } = await fetchHtml(url);
  await fs.writeFile(path.join(outDir, `${fileName(url)}.html`), html, 'utf8');
  results.push(validate(url, status, finalUrl, html));
}

const failures = results.flatMap((result) => result.failures.map((failure) => `${result.url}:${failure}`));
const legacyMarkers = [...new Set(results.flatMap((result) => result.legacyMarkers))];
const report = {
  contract: 'retired-wordpress-injection-owners',
  checkedAt: new Date().toISOString(),
  validationFail: failures.length,
  legacyMarkers,
  results,
  failures,
};

await fs.writeFile(path.join(outDir, 'wordpress-owner-retirement-report.json'), JSON.stringify(report, null, 2), 'utf8');
await fs.writeFile(
  path.join(outDir, 'social-proof-env.txt'),
  `WORDPRESS_LEGACY_OWNER_MARKERS=${legacyMarkers.length}\nVALIDATION_FAIL=${failures.length}\n`,
  'utf8',
);
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exit(1);
