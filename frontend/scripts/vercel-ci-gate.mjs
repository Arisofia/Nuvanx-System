import { spawnSync } from 'node:child_process';

const OWNER = 'Arisofia';
const REPO = 'Nuvanx-System';
const REQUIRED_WORKFLOW_PATH = '.github/workflows/master.yml';
const POLL_INTERVAL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
// Vercel imposes a finite build window. Keep the gate below that window so
// successful CI still leaves time for the actual frontend build.
const MAX_WAIT_MS = 40 * 60_000;

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
  const previousSha = process.env.VERCEL_GIT_PREVIOUS_SHA?.trim();
  if (previousSha) {
    const result = git(['diff', '--quiet', previousSha, 'HEAD', '--', '.']);
    if (result.status === 0) return false;
    if (result.status === 1) return true;
    console.log(`[vercel-ci-gate] previous-SHA diff unavailable; falling back to HEAD^: ${result.stderr}`);
  }

  const result = git(['diff', 'HEAD^', 'HEAD', '--quiet', '--', '.']);
  if (result.status === 0) return false;
  if (result.status === 1) return true;

  // If Git cannot evaluate the diff, do not suppress a potentially necessary
  // production deployment. Continue to the CI gate instead.
  console.log(`[vercel-ci-gate] unable to evaluate frontend diff; checking CI instead: ${result.stderr}`);
  return true;
}

function latestRunPerWorkflow(runs) {
  const latest = new Map();

  for (const run of runs) {
    const key = run?.path;
    if (!key) continue;

    const current = latest.get(key);
    if (!current) {
      latest.set(key, run);
      continue;
    }

    const attemptDelta = Number(run.run_attempt ?? 1) - Number(current.run_attempt ?? 1);
    if (attemptDelta > 0 || (attemptDelta === 0 && Number(run.id ?? 0) > Number(current.id ?? 0))) {
      latest.set(key, run);
    }
  }

  return [...latest.values()];
}

async function getPushWorkflowRuns(sha, remainingMs) {
  const url = new URL(`https://api.github.com/repos/${OWNER}/${REPO}/actions/runs`);
  url.searchParams.set('head_sha', sha);
  url.searchParams.set('event', 'push');
  url.searchParams.set('per_page', '100');

  const controller = new AbortController();
  const requestTimeoutMs = Math.max(1_000, Math.min(REQUEST_TIMEOUT_MS, remainingMs));
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
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
    return latestRunPerWorkflow(runs.filter((run) => run?.head_sha === sha));
  } finally {
    clearTimeout(timer);
  }
}

function summarizeRuns(runs) {
  return runs
    .map((run) => `${run.path ?? run.name ?? 'unknown'}=${run.status}/${run.conclusion ?? 'pending'}`)
    .join(', ');
}

async function main() {
  const branch = process.env.VERCEL_GIT_COMMIT_REF?.trim();
  if (branch && branch !== 'main') {
    ignoreBuild(`branch ${branch} is not main`);
  }

  if (!frontendChanged()) {
    ignoreBuild('no frontend changes since the previous successful deployment');
  }

  const sha = resolveCommitSha();
  const deadline = Date.now() + MAX_WAIT_MS;
  console.log(`[vercel-ci-gate] waiting for all applicable push workflows on ${sha}`);

  while (Date.now() < deadline) {
    const remainingMs = deadline - Date.now();

    let runs;
    try {
      runs = await getPushWorkflowRuns(sha, remainingMs);
    } catch (error) {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      // Fail closed immediately. A deployment must never proceed when CI state
      // cannot be verified, including request timeouts or API failures.
      ignoreBuild(`cannot verify GitHub CI state: ${detail}`);
    }

    const requiredRun = runs.find((run) => run.path === REQUIRED_WORKFLOW_PATH);
    if (!requiredRun) {
      console.log('[vercel-ci-gate] required master workflow not visible yet; waiting');
    } else {
      const pending = runs.filter((run) => run.status !== 'completed');
      if (pending.length > 0) {
        console.log(`[vercel-ci-gate] workflows still running: ${summarizeRuns(pending)}`);
      } else {
        const failed = runs.filter((run) => run.conclusion !== 'success');
        if (failed.length > 0) {
          ignoreBuild(`push workflow gate failed: ${summarizeRuns(failed)}`);
        }

        continueBuild(`all ${runs.length} applicable push workflow(s) passed for ${sha}`);
      }
    }

    const sleepMs = Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now()));
    if (sleepMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, sleepMs));
    }
  }

  ignoreBuild(`timed out waiting for successful push workflows for ${sha}`);
}

main().catch((error) => {
  ignoreBuild(`unexpected gate error: ${error instanceof Error ? error.message : String(error)}`);
});
