import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(
  new URL('../../../scripts/qualify-governed-edge-deployment.py', import.meta.url),
);
const workflowPath = fileURLToPath(
  new URL('../../../.github/workflows/google-ads-runtime-acceptance.yml', import.meta.url),
);
const workflow = readFileSync(workflowPath, 'utf8');
const tempDirs = [];
const SHA = 'a'.repeat(40);
const RUN_ID = 321;
const REQUIRED_STEPS = [
  'Verify current main is the quality-approved candidate',
  'Revalidate governed Edge candidate',
  'Reverify remote main immediately before Production mutation',
  'Deploy governed functions',
];

function successPayload(overrides = {}) {
  return {
    jobs: [
      {
        name: 'Deploy · governed Edge Functions',
        run_id: RUN_ID,
        head_sha: SHA,
        conclusion: 'success',
        steps: REQUIRED_STEPS.map((name) => ({ name, conclusion: 'success' })),
        ...overrides,
      },
    ],
  };
}

function runQualifier({ payload = successPayload(), env = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'nvx-google-ads-provenance-'));
  tempDirs.push(dir);
  const jobsJson = join(dir, 'jobs.json');
  const githubOutput = join(dir, 'github-output.txt');
  writeFileSync(jobsJson, JSON.stringify(payload), 'utf8');
  writeFileSync(githubOutput, '', 'utf8');

  const result = spawnSync('python3', [scriptPath], {
    encoding: 'utf8',
    env: {
      ...process.env,
      JOBS_JSON: jobsJson,
      GITHUB_OUTPUT: githubOutput,
      DEPLOYED_SHA: SHA,
      UPSTREAM_RUN_ID: String(RUN_ID),
      UPSTREAM_CONCLUSION: 'success',
      UPSTREAM_EVENT: 'workflow_run',
      UPSTREAM_BRANCH: 'main',
      ...env,
    },
  });

  return {
    ...result,
    output: readFileSync(githubOutput, 'utf8'),
  };
}

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop(), { recursive: true, force: true });
});

describe('Google Ads governed deployment provenance qualification', () => {
  it('keeps the Python qualifier syntactically executable', () => {
    const result = spawnSync('python3', ['-m', 'py_compile', scriptPath], { encoding: 'utf8' });
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it('accepts only the unique exact-SHA governed deploy with all required steps green', () => {
    const result = runQualifier();
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.output).toContain('accept=true\n');
    expect(result.output).toContain(`deployed_sha=${SHA}\n`);
    expect(result.stdout).toContain('exact-SHA guards completed successfully');
  });

  it('treats a skipped upstream deployment as not applicable without claiming acceptance', () => {
    const result = runQualifier({ env: { UPSTREAM_CONCLUSION: 'skipped' } });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.output).toBe('accept=false\n');
    expect(result.stdout).toContain('runtime acceptance is not applicable');
  });

  it('fails closed for an untrusted trigger envelope', () => {
    const result = runQualifier({ env: { UPSTREAM_EVENT: 'workflow_dispatch' } });
    expect(result.status).toBe(1);
    expect(result.output).toBe('accept=false\n');
    expect(result.stdout).toContain('not trusted Master workflow_run');
  });

  it('fails closed when a required deploy step is absent or not successful', () => {
    const payload = successPayload({
      steps: REQUIRED_STEPS.slice(0, -1).map((name) => ({ name, conclusion: 'success' })),
    });
    const result = runQualifier({ payload });
    expect(result.status).toBe(1);
    expect(result.output).toBe('accept=false\n');
    expect(result.stdout).toContain('required deploy steps did not complete successfully');
  });

  it('prequalifies the trusted workflow envelope before checking out and executing candidate code', () => {
    const envelope = workflow.indexOf('Qualify trusted upstream envelope');
    const checkout = workflow.indexOf('Checkout trusted deployed candidate');
    const proof = workflow.indexOf('Prove governed Edge deployment actually ran');
    expect(envelope).toBeGreaterThan(-1);
    expect(checkout).toBeGreaterThan(envelope);
    expect(proof).toBeGreaterThan(checkout);
    expect(workflow).toContain("if [[ \"${UPSTREAM_EVENT:-}\" != \"workflow_run\" ]]");
    expect(workflow).toContain("if [[ \"${UPSTREAM_BRANCH:-}\" != \"main\" ]]");
    expect(workflow).toContain("if: ${{ steps.envelope.outputs.applicable == 'true' }}");
    expect(workflow).toContain('python3 -m py_compile scripts/qualify-governed-edge-deployment.py');
    expect(workflow).toContain('python3 scripts/qualify-governed-edge-deployment.py');
    expect(workflow).not.toContain("python3 - <<'PY'");
  });

  it('uses bounded HTTPS-only GitHub API transport for the token-bearing provenance request', () => {
    expect(workflow).toContain("--proto '=https' --proto-redir '=https'");
    expect(workflow).toContain('--connect-timeout 10 --max-time 30');
    expect(workflow).toContain('-H "Authorization: Bearer ${GH_TOKEN}"');
  });
});
