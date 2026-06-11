#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const GITHUB_DIR = path.join(ROOT, '.github');
const FORBIDDEN_ACTION_REFS = new Set(['master', 'main', 'latest']);
const FORBIDDEN_RUNTIME_FLAGS = [
  'FORCE_JAVASCRIPT_ACTIONS_TO_NODE20',
  'FORCE_JAVASCRIPT_ACTIONS_TO_NODE22',
  'FORCE_JAVASCRIPT_ACTIONS_TO_NODE24',
];

const FORBIDDEN_TEXT_PATTERNS = [
  [/ci_dummy|dummy_|fake_|not-configured|your-project\.supabase\.co|your-anon-key|your-public-anon-key|your-publishable-key/i, 'placeholder or dummy credential/data detected'],
  [/continue-on-error:\s*true/i, 'continue-on-error is forbidden for production workflow gates'],
  [/skip_.*=true|skipped.*missing secrets|warning::.*skipped/i, 'skip-on-missing-secrets pattern detected'],
  [/\|\|\s*true/, 'command failure swallowed with || true'],
];

const errors = [];

function relative(filePath) {
  return path.relative(ROOT, filePath).replaceAll(path.sep, '/');
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ya?ml)$/i.test(entry.name)) out.push(full);
  }
  return out;
}

function commandExists(command) {
  const checker = process.platform === 'win32' ? 'where' : 'command';
  const args = process.platform === 'win32' ? [command] : ['-v', command];
  const result = cp.spawnSync(checker, args, { stdio: 'ignore', shell: process.platform !== 'win32' });
  return result.status === 0;
}

function sanitizeGithubExpressions(script) {
  return script.replace(/\$\{\{[\s\S]*?\}\}/g, 'GITHUB_EXPRESSION');
}

function validateBashSyntax(script, label) {
  if (!commandExists('bash')) return;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-bash-'));
  const scriptPath = path.join(tempDir, 'script.sh');
  fs.writeFileSync(scriptPath, `#!/usr/bin/env bash\n${sanitizeGithubExpressions(script)}\n`, 'utf8');
  const result = cp.spawnSync('bash', ['-n', scriptPath], { encoding: 'utf8' });
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (result.status !== 0) {
    errors.push(`${label}: bash syntax check failed: ${(result.stderr || '').trim()}`);
  }
}

function extractRunBlocks(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(/^(\s*)run:\s*\|\s*$/);
    if (!match) continue;

    const baseIndent = match[1].length;
    const blockLines = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const current = lines[j];
      if (current.trim() === '') {
        blockLines.push('');
        continue;
      }
      const indent = current.match(/^\s*/)[0].length;
      if (indent <= baseIndent) break;
      blockLines.push(current.slice(Math.min(indent, baseIndent + 2)));
    }

    blocks.push({ line: i + 1, script: blockLines.join('\n') });
  }

  return blocks;
}

function validateWorkflowFile(file) {
  const rel = relative(file);
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);

  if (/^(<<<<<<<|=======|>>>>>>>)$/m.test(text)) {
    errors.push(`${rel}: merge conflict marker detected`);
  }

  for (const [pattern, message] of FORBIDDEN_TEXT_PATTERNS) {
    if (pattern.test(text)) errors.push(`${rel}: ${message}`);
  }

  for (const flag of FORBIDDEN_RUNTIME_FLAGS) {
    if (text.includes(flag)) errors.push(`${rel}: remove deprecated global runtime flag ${flag}`);
  }

  lines.forEach((line, index) => {
    if (/^[^#\n]*:\s*[^#\n]+\s{2,}[A-Za-z0-9_-]+:\s*(\||[^#\n]*)?$/.test(line)) {
      errors.push(`${rel}: possible malformed YAML with two keys on line ${index + 1}: ${line.trim()}`);
    }

    const uses = line.match(/^\s*uses:\s*([^\s#]+)\s*$/);
    if (!uses) return;
    const action = uses[1];
    if (action.startsWith('./') || action.startsWith('docker://')) return;
    if (!action.includes('@')) {
      errors.push(`${rel}: line ${index + 1} uses '${action}' without a pinned ref`);
      return;
    }
    const ref = action.split('@').pop();
    if (FORBIDDEN_ACTION_REFS.has(ref)) {
      errors.push(`${rel}: line ${index + 1} uses unstable action ref '${action}'`);
    }
  });

  for (const block of extractRunBlocks(text)) {
    validateBashSyntax(block.script, `${rel}: line ${block.line} run block`);
  }
}

const workflowFiles = walk(GITHUB_DIR).sort();
if (workflowFiles.length === 0) {
  errors.push('No GitHub YAML files found under .github/.');
}

for (const file of workflowFiles) validateWorkflowFile(file);

if (errors.length > 0) {
  console.error(errors.map((error) => `::error::${error}`).join('\n'));
  process.exit(1);
}

console.log(`OK ${workflowFiles.length} GitHub YAML files validated without placeholder/fake-data gates`);
