import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/deploy-standalone-edge-functions.yml', 'utf8');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const migrationParityRow = (version) => new RegExp(`^[\\s]*${version}[\\s]*\\|[\\s]*${version}[\\s]*(\\||$)`);

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

  it('serializes against Manual Maintenance deploy_edge', () => {
    expect(workflow).toContain('group: manual-maintenance-deploy_edge');
  });

  it('publishes a Cloudflare-only browser CORS boundary after Vercel retirement', () => {
    expect(workflow).toContain('CORS_ALLOWED_ORIGINS: https://nuvanx-frontend.jenineferderas.workers.dev');
    expect(workflow).not.toContain('frontend-arisofias-projects-c2217452.vercel.app');
    expect(workflow).not.toContain('frontend-git-main-arisofias-projects-c2217452.vercel.app');
  });

  it('fails closed unless the complete WhatsApp migration tail is present in LOCAL and REMOTE history', () => {
    expect(workflow).toContain('Verify WhatsApp async migrations are already applied');
    expect(workflow).toContain('supabase migration list --db-url');
    expect(workflow).toContain('for REQUIRED_MIGRATION in 20260901190000 20260901190100; do');
    expect(workflow).toContain('not present in both LOCAL and REMOTE migration history');
    expect(workflow).not.toContain('bash scripts/supabase-migrate.sh');

    for (const version of ['20260901190000', '20260901190100']) {
      const parity = migrationParityRow(version);
      expect(parity.test(`  ${version} | ${version} | 2026-09-01 19:00:00`)).toBe(true);
      expect(parity.test(`  ${version} |                | 2026-09-01 19:00:00`)).toBe(false);
      expect(parity.test(`                 | ${version} | 2026-09-01 19:00:00`)).toBe(false);
    }
  });

  it('revalidates tests and all governed Deno entrypoints before deployment', () => {
    expect(packageJson.scripts.test).toContain('vitest run supabase/functions');
    expect(workflow).toContain('npm test');
    expect(workflow).toContain('supabase/functions/dashboard/index.ts');
    expect(workflow).toContain('supabase/functions/agent-run/index.ts');
    expect(workflow).toContain('supabase/functions/runtime-bootstrap/index.ts');
    expect(workflow).toContain('supabase/functions/google-ads-health/index.ts');
    expect(workflow).toContain('supabase/functions/google-ads-daily-sync/index.ts');
    expect(workflow).toContain('supabase/functions/google-ads-backfill-dispatcher/index.ts');
    expect(workflow).toContain('supabase/functions/meta-lead-backfill/index.ts');
    expect(workflow).toContain('supabase/functions/meta-daily-insights/index.ts');
    expect(workflow).toContain('supabase/functions/meta-capi-dispatch/index.ts');
    expect(workflow).toContain('supabase/functions/revops-dispatcher/index.ts');
    expect(workflow).toContain('supabase/functions/whatsapp-send/index.ts');
    expect(workflow).toContain('supabase/functions/whatsapp-outbound-worker/index.ts');
    expect(workflow).toContain('supabase/functions/whatsapp-status-webhook/index.ts');
  });

  it('preserves JWT policies while deploying the registry, enqueue function and worker together', () => {
    expect(workflow).toContain('supabase functions deploy meta-capi-dispatch --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
    expect(workflow).toContain('supabase functions deploy revops-dispatcher --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
    expect(workflow).toContain('supabase functions deploy whatsapp-send --project-ref "$SUPABASE_PROJECT_REF"');
    expect(workflow).toContain('supabase functions deploy whatsapp-outbound-worker --project-ref "$SUPABASE_PROJECT_REF"');
    expect(workflow).toContain('supabase functions deploy whatsapp-status-webhook --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
    expect(workflow).not.toContain('supabase functions deploy whatsapp-send --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
    expect(workflow).not.toContain('supabase functions deploy whatsapp-outbound-worker --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
  });
});
