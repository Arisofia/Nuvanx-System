import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/deploy-standalone-edge-functions.yml', 'utf8');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function deploymentLines(functionName) {
  const command = `supabase functions deploy ${functionName} --project-ref "$SUPABASE_PROJECT_REF"`;
  const pattern = new RegExp(`^\\s*${escapeRegex(command)}(?:\\s+--no-verify-jwt)?\\s*$`);
  return workflow.split('\n').filter((line) => pattern.test(line));
}

function expectDeploymentPolicy(functionName, { noVerifyJwt }) {
  const lines = deploymentLines(functionName);
  expect(lines, `${functionName} must have exactly one governed deploy command`).toHaveLength(1);
  if (noVerifyJwt) {
    expect(lines[0]).toContain('--no-verify-jwt');
  } else {
    expect(lines[0]).not.toContain('--no-verify-jwt');
  }
}

function denoCheckBlock() {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => /^\s*deno check --config=supabase\/functions\/deno\.json\s*\\\s*$/.test(line));
  const firstDeploy = lines.findIndex((line) => /^\s*supabase functions deploy\b/.test(line));
  expect(start, 'governed executable Deno check command must exist').toBeGreaterThanOrEqual(0);
  expect(firstDeploy, 'Deno validation must run before the first executable deploy command').toBeGreaterThan(start);
  return lines.slice(start, firstDeploy);
}

describe('standalone Edge deployment ownership', () => {
  it('runs only after successful Master System main-push quality or explicit manual dispatch', () => {
    expect(workflow).toContain("workflows: ['Master System']");
    expect(workflow).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(workflow).toContain("github.event.workflow_run.event == 'push'");
    expect(workflow).toContain("github.event.workflow_run.head_branch == 'main'");
  });

  it('checks out only trusted main and requires it to equal the quality-approved SHA', () => {
    expect(workflow).toContain('ref: main');
    expect(workflow).toContain('QUALITY_APPROVED_SHA: ${{ github.event.workflow_run.head_sha }}');
    expect(workflow).toContain('if [[ "$CURRENT_SHA" != "$QUALITY_APPROVED_SHA" ]]');
    expect(workflow).toContain('echo "deploy=false" >> "$GITHUB_OUTPUT"');
  });

  it('uses the shared Production Edge mutation lock', () => {
    expect(workflow).toContain('group: manual-maintenance-deploy_edge');
    expect(workflow).toContain('cancel-in-progress: false');
  });

  it('publishes a Cloudflare-only browser CORS boundary after Vercel retirement', () => {
    expect(workflow).toContain('CORS_ALLOWED_ORIGINS: https://nuvanx-frontend.jenineferderas.workers.dev');
    expect(workflow).toContain('FRONTEND_URL: https://nuvanx-frontend.jenineferderas.workers.dev');
    expect(workflow).toContain('PRODUCTION_FALLBACK_URL: https://nuvanx-frontend.jenineferderas.workers.dev');
    expect(workflow).toContain('CORS_ALLOWED_ORIGINS="$CORS_ALLOWED_ORIGINS"');
    expect(workflow).toContain('FRONTEND_URL="$FRONTEND_URL"');
    expect(workflow).toContain('PRODUCTION_FALLBACK_URL="$PRODUCTION_FALLBACK_URL"');
    expect(workflow).not.toContain('frontend-arisofias-projects-c2217452.vercel.app');
    expect(workflow).not.toContain('frontend-git-main-arisofias-projects-c2217452.vercel.app');
  });

  it('owns each production-critical core runtime exactly once with its intended JWT policy', () => {
    expectDeploymentPolicy('api', { noVerifyJwt: true });
    expectDeploymentPolicy('mcp', { noVerifyJwt: true });
    expectDeploymentPolicy('daily-aggregates', { noVerifyJwt: true });
    expectDeploymentPolicy('auth', { noVerifyJwt: true });
    expectDeploymentPolicy('health', { noVerifyJwt: true });
    expectDeploymentPolicy('playbooks', { noVerifyJwt: false });
    expectDeploymentPolicy('web-lead-reconcile', { noVerifyJwt: false });
    expectDeploymentPolicy('deal-factory', { noVerifyJwt: false });
    expectDeploymentPolicy('whatsapp-provider-acceptance', { noVerifyJwt: true });
  });

  it('owns the canonical Google Ads MCC routing value in the governed Edge deploy', () => {
    expect(workflow).toContain("GOOGLE_ADS_LOGIN_CUSTOMER_ID: '8265708501'");
    expect(workflow).toContain('[[ "$GOOGLE_ADS_LOGIN_CUSTOMER_ID" == "8265708501" ]]');
    expect(workflow).toContain('GOOGLE_ADS_LOGIN_CUSTOMER_ID="$GOOGLE_ADS_LOGIN_CUSTOMER_ID"');
    expect(workflow).toContain('supabase functions deploy google-ads-auth-preflight --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
    expect(workflow).toContain('supabase functions deploy google-ads-health --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
    expect(workflow).toContain('supabase functions deploy google-ads-daily-sync --project-ref "$SUPABASE_PROJECT_REF"');
  });

  it('waits read-only for every versioned candidate migration and fails closed before Edge deploys', () => {
    expect(workflow).toContain('Wait for automatic Production migration owner');
    expect(workflow).toContain('LOCAL_MIGRATIONS=()');
    expect(workflow).toContain("find supabase/migrations -maxdepth 1 -type f -name '*.sql' -print | sort");
    expect(workflow).toContain('MIGRATION_VERSION="$(basename "$MIGRATION_FILE" | cut -d_ -f1)"');
    expect(workflow).toContain('[[ "$MIGRATION_VERSION" =~ ^[0-9]{14}$ ]]');
    expect(workflow).toContain('for REQUIRED_MIGRATION in "${LOCAL_MIGRATIONS[@]}"; do');
    expect(workflow).toContain('for ATTEMPT in {1..20}; do');
    expect(workflow).toContain('Automatic Production migration owner did not converge candidate migrations');
    expect(workflow).toContain('[|│]');
    expect(workflow).not.toContain('REQUIRED_MIGRATIONS=(');
    expect(workflow).not.toContain('bash scripts/supabase-migrate.sh');
    expect(workflow).not.toContain('supabase db push');
  });

  it('revalidates every governed core entrypoint inside the executable Deno block before any deploy', () => {
    expect(packageJson.scripts.test).toContain('vitest run supabase/functions');
    expect(workflow).toContain('npm test');
    const block = denoCheckBlock();
    for (const path of [
      'supabase/functions/api/index.ts',
      'supabase/functions/mcp/index.ts',
      'supabase/functions/daily-aggregates/index.ts',
      'supabase/functions/auth/index.ts',
      'supabase/functions/health/index.ts',
      'supabase/functions/playbooks/index.ts',
      'supabase/functions/dashboard/index.ts',
      'supabase/functions/agent-run/index.ts',
      'supabase/functions/runtime-bootstrap/index.ts',
      'supabase/functions/control-centre-provider/index.ts',
      'supabase/functions/google-ads-auth-preflight/index.ts',
      'supabase/functions/google-ads-health/index.ts',
      'supabase/functions/google-ads-daily-sync/index.ts',
      'supabase/functions/google-ads-backfill-dispatcher/index.ts',
      'supabase/functions/meta-lead-backfill/index.ts',
      'supabase/functions/meta-daily-insights/index.ts',
      'supabase/functions/meta-routing-audit/index.ts',
      'supabase/functions/meta-leadgen-subscribe/index.ts',
      'supabase/functions/meta-hubspot-sync/index.ts',
      'supabase/functions/meta-capi-dispatch/index.ts',
      'supabase/functions/hubspot-marketing-contact-monitor/index.ts',
      'supabase/functions/web-lead-reconcile/index.ts',
      'supabase/functions/deal-factory/index.ts',
      'supabase/functions/revops-dispatcher/index.ts',
      'supabase/functions/whatsapp-send/index.ts',
      'supabase/functions/whatsapp-outbound-worker/index.ts',
      'supabase/functions/whatsapp-provider-acceptance/index.ts',
      'supabase/functions/whatsapp-status-webhook/index.ts',
      'supabase/functions/google-click-attribution/index.ts',
      'supabase/functions/google-data-manager-export/index.ts',
      'supabase/functions/seo-web-performance/index.ts',
    ]) {
      const pathLine = new RegExp(`^\\s*${escapeRegex(path)}\\s*\\\\?\\s*$`);
      expect(block.some((line) => pathLine.test(line)), `${path} must be an executable Deno-check argument`).toBe(true);
    }
  });

  it('preserves JWT policies while deploying WhatsApp patient and acceptance lanes together', () => {
    expect(workflow).toContain('supabase functions deploy meta-capi-dispatch --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
    expect(workflow).toContain('supabase functions deploy revops-dispatcher --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
    expect(workflow).toContain('supabase functions deploy whatsapp-send --project-ref "$SUPABASE_PROJECT_REF"');
    expect(workflow).toContain('supabase functions deploy whatsapp-outbound-worker --project-ref "$SUPABASE_PROJECT_REF"');
    expect(workflow).toContain('supabase functions deploy whatsapp-provider-acceptance --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
    expect(workflow).toContain('supabase functions deploy whatsapp-status-webhook --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
    expect(workflow).toContain('supabase functions deploy seo-web-performance --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
    expect(workflow).not.toContain('supabase functions deploy whatsapp-send --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
    expect(workflow).not.toContain('supabase functions deploy whatsapp-outbound-worker --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
  });
});
