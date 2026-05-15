const fs = require('fs');
const files = [
  '.github/workflows/ci.yml',
  '.github/workflows/meta-daily-report.yml',
  '.github/workflows/meta-historical-backfill.yml',
  '.github/workflows/daily-health-check.yml'
];

files.forEach(f => {
  try {
    const content = fs.readFileSync(f, 'utf8');
    // Basic check: can it be read and is it non-empty?
    if (!content) throw new Error('Empty file');
    console.log('OK ' + f);
  } catch (e) {
    console.error('FAIL ' + f + ': ' + e.message);
    process.exit(1);
  }
});
