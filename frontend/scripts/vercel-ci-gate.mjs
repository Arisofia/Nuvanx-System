import { spawnSync } from 'node:child_process';

const OWNER = 'Arisofia';
const REPO = 'Nuvanx-System';
const REQUIRED_WORKFLOW_PATH = '.github/workflows/master.yml';
const POLL_INTERVAL_MS = 30_000;
const MAX_WAIT_MS = 10 * 60_000;

function ignoreBuild(reason) {
  console.log(`[vercel-ci-gate] IGNORE: ${reason}`);
  process.exit(0);
}

function continueBuild(reason) {
  console.log(`[vercel-ci-gate] CONTINUE: ${reason}`);
  process.exit(1);
}

function git(args) {
  const result = spawnSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return {
    status: result.status,
    stdout: result.stdout?.trim() ?? '',
    stderr: result.stderr?.trim() ?? '',
  };
}

function resolveCommitSha() {
  const fromVercel = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  if (fromVercel) return fromVercel;

  const result = git(['rev-parse', 'HEAD']);
  if (result.status !== 0 || !result.stdout) {
    ignoreBuild(`cannot resolve commit SHA: ${result.stderr || 'git rev-parse failed'}`);
  }
  return result.stdout;
}

function frontendChanged() {
  const result = git(['diff', 'HEAD^', 'HEAD', '--quiet', '.']);
  if (result.status === 0) return false;
  if (result.status === 1) return true;

  console.log(`[vercel-ci-gate] unable to evaluate frontend diff; checking CI instead: ${result.stderr}`);
  return true;
}

async function getRequiredWorkflowRun(sha) {
  const url = new URL(`https://api.github.com/repos/${OWNER}/${REPO}/actions/runs`);
  url.searchParams.set('head_sha', sha);
  url.searchParams.set('event', 'push');
  url.searchParams.set('per_page', '20');

  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'nuvanx-vercel-ci-gate',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const runs = Array.isArray(payload.workflow_runs) ? payload.workflow_runs : [];
  const matching = runs
    .filter((run) => run?.path === REQUIRED_WORKFLOW_PATH && run?.head_sha === sha)
    .sort((a, b) => {
      const attemptDelta = Number(b.run_attempt ?? 1) - Number(a.run_attempt ?? 1);
      if (attemptDelta !== 0) return attemptDelta;
      return Number(b.id ?? 0) - Number(a.id ?? 0);
    });

  return matching[0] ?? null;
}

async function main() {
  const branch = process.env.VERCEL_GIT_COMMIT_REF?.trim();
  if (branch && branch !== 'main') {
    ignoreBuild(`branch ${branch} is not main`);
  }

  if (!frontendChanged()) {
    ignoreBuild('no frontend changes in this commit');
  }

  const sha = resolveCommitSha();
  const deadline = Date.now() + MAX_WAIT_MS;
  console.log(`[vercel-ci-gate] waiting for ${REQUIRED_WORKFLOW_PATH} on ${sha}`);

  while (Date.now() < deadline) {
    try {
      const run = await getRequiredWorkflowRun(sha);

      if (!run) {
        console.log('[vercel-ci-gate] required workflow run not visible yet; waiting');
      } else if (run.status !== 'completed') {
        console.log(`[vercel-ci-gate] required workflow status=${run.status}; waiting`);
      } else if (run.conclusion === 'success') {
        continueBuild(`required workflow passed for ${sha}`);
      } else {
        ignoreBuild(`required workflow concluded ${run.conclusion ?? 'unknown'} for ${sha}`);
      }
    } catch (error) {
      console.log(`[vercel-ci-gate] GitHub status lookup failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  ignoreBuild(`timed out waiting for a successful ${REQUIRED_WORKFLOW_PATH} result`);
}

main().catch((error) => {
  ignoreBuild(`unexpected gate error: ${error instanceof Error ? error.message : String(error)}`);
});
