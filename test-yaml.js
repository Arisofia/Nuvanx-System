const fs = require('fs');
const path = require('path');

const workflowDir = path.join(__dirname, '.github', 'workflows');
const files = fs.readdirSync(workflowDir)
  .filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
  .map(f => path.join('.github', 'workflows', f));

if (files.length === 0) {
  console.error('FAIL: No workflow files found in .github/workflows');
  process.exit(1);
}

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
