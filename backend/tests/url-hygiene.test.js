/**
 * URL Hygiene test — fails if any frontend source file contains a hardcoded
 * Vercel deployment preview URL (pattern: random-hash subdomain on vercel.app).
 *
 * Preview URLs look like:
 *   https://frontend-abc123xyz-arisofias-projects-c2217452.vercel.app
 *
 * Production Vercel aliases and localhost are intentionally allowed.
 */

const fs = require('fs');
const path = require('path');

// Regex: vercel.app URLs whose subdomain contains a dash-separated hash segment
// (e.g. frontend-HASH-username or name-HASH)
const PREVIEW_URL_RE = /https?:\/\/[a-z0-9-]+-[a-z0-9]{7,}-[a-z0-9-]+\.vercel\.app/i;

// Directories and extensions to scan
const SCAN_ROOT = path.resolve(__dirname, '../../frontend/src');
const INCLUDE_EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.json', '.env', '.env.local']);

// Files that are explicitly allowed to reference such URLs (e.g. docs)
const ALLOW_LIST = new Set([]);

function collectFiles(dir, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, results);
    } else if (INCLUDE_EXTS.has(path.extname(entry.name))) {
      results.push(fullPath);
    }
  }
  return results;
}

describe('URL hygiene — no hardcoded Vercel preview URLs', () => {
  const files = collectFiles(SCAN_ROOT);

  test('at least one source file is scanned', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const filePath of files) {
    const relative = path.relative(path.resolve(__dirname, '../..'), filePath);
    if (ALLOW_LIST.has(relative)) continue;

    test(`${relative} contains no hardcoded preview URLs`, () => {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      const violations = [];

      lines.forEach((line, idx) => {
        // Skip comment-only lines (JS/TS single-line comments)
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
        if (PREVIEW_URL_RE.test(line)) {
          violations.push(`  line ${idx + 1}: ${line.trim()}`);
        }
      });

      if (violations.length > 0) {
        throw new Error(
          `Hardcoded Vercel preview URL found in ${relative}:\n${violations.join('\n')}\n\n` +
          'Use the VITE_API_BASE_URL env var instead of a hardcoded deployment URL.'
        );
      }
    });
  }
});
