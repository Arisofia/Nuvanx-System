import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/deploy-standalone-edge-functions.yml', 'utf8');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const migrationParityRow = (version) => new RegExp(`^[\\s]*${version}[\\s]*[|│][\\s]*${version}[\\s]*([|│]|$)`);

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

  it('owns the canonical Google Ads MCC routing value in the governed Edge deploy', () => {
    expect(workflow).toContain("GOOGLE_ADS_LOGIN_CUSTOMER_ID: '8265708501'");
    expect(workflow).toContain('[[ "$GOOGLE_ADS_LOGIN_CUSTOMER_ID" == "8265708501" ]]');
    expect(workflow).toContain('GOOGLE_ADS_LOGIN_CUSTOMER_ID="$GOOGLE_ADS_LOGIN_CUSTOMER_ID"');
    expect(workflow).toContain('supabase functions deploy google-ads-auth-preflight --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
    expect(workflow).toContain('supabase functions deploy google-ads-health --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
    expect(workflow).toContain('supabase functions deploy google-ads-daily-sync --project-ref "$SUPABASE_PROJECT_REF"');
  });

  it('waits read-only for the automatic migration owner and fails closed before migration-dependent Edge deploys', () => {
    expect(workflow).toContain('Wait for automatic Production migration owner');
    expect(workflow).toContain('supabase migration list --db-url');
    expect(workflow).toContain('REQUIRED_MIGRATIONS=(20260901190000 20260901190100 20260901190200 20260903142000 20260905141000)');
    expect(workflow).toContain('for ATTEMPT in {1..20}; do');
    expect(workflow).toContain('Automatic Production migration owner did not converge required migrations');
    expect(workflow).toContain('[|│]');
    expect(workflow).not.toContain('bash scripts/supabase-migrate.sh');
    expect(workflow).not.toContain('supabase db push');

    for (const version of ['20260901190000', '20260901190100', '20260901190200', '20260903142000', '20260905141000']) {
      const asciiParity = migrationParityRow(version);
      const unicodeParity = migrationParityRow(version);
      expect(asciiParity.test(`  ${version} | ${version} | 2026-09-05 14:10:00`)).toBe(true);
      expect(unicodeParity.test(`  ${version} │ ${version} │ 2026-09-05 14:10:00`)).toBe(true);

      const localOnlyAscii = migrationParityRow(version);
      const remoteOnlyAscii = migrationParityRow(version);
      const localOnlyUnicode = migrationParityRow(version);
      const remoteOnlyUnicode = migrationParityRow(version);
      expect(localOnlyAscii.test(`  ${version} |                | 2026-09-05 14:10:00`)).toBe(false);
      expect(remoteOnlyAscii.test(`                 | ${version} | 2026-09-05 14:10:00`)).toBe(false);
      expect(localOnlyUnicode.test(`  ${version} │                │ 2026-09-05 14:10:00`)).toBe(false);
      expect(remoteOnlyUnicode.test(`                 │ ${version} │ 2026-09-05 14:10:00`)).toBe(false);
    }
  });

  it('revalidates tests and all governed Deno entrypoints before deployment', () => {
    expect(packageJson.scripts.test).toContain('vitest run supabase/functions');
    expect(workflow).toContain('npm test');
    expect(workflow).toContain('supabase/functions/dashboard/index.ts');
    expect(workflow).toContain('supabase/functions/agent-run/index.ts');
    expect(workflow).toContain('supabase/functions/runtime-bootstrap/index.ts');
    expect(workflow).toContain('supabase/functions/google-ads-auth-preflight/index.ts');
    expect(workflow).toContain('supabase/functions/google-ads-health/index.ts');
    expect(workflow).toContain('supabase/functions/google-ads-daily-sync/index.ts');
    expect(workflow).toContain('supabase/functions/google-ads-backfill-dispatcher/index.ts');
    expect(workflow).toContain('supabase/functions/meta-lead-backfill/index.ts');
    expect(workflow).toContain('supabase/functions/meta-daily-insights/index.ts');
    expect(workflow).toContain('supabase/functions/meta-capi-dispatch/index.ts');
    expect(workflow).toContain('supabase/functions/hubspot-marketing-contact-monitor/index.ts');
    expect(workflow).toContain('supabase/functions/revops-dispatcher/index.ts');
    expect(workflow).toContain('supabase/functions/whatsapp-send/index.ts');
    expect(workflow).toContain('supabase/functions/whatsapp-outbound-worker/index.ts');
    expect(workflow).toContain('supabase/functions/whatsapp-status-webhook/index.ts');
    expect(workflow).toContain('supabase/functions/seo-web-performance/index.ts');
  });

  it('preserves JWT policies while deploying the registry, enqueue function and worker together', () => {
    expect(workflow).toContain('supabase functions deploy meta-capi-dispatch --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
    expect(workflow).toContain('supabase functions deploy revops-dispatcher --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
    expect(workflow).toContain('supabase functions deploy whatsapp-send --project-ref "$SUPABASE_PROJECT_REF"');
    expect(workflow).toContain('supabase functions deploy whatsapp-outbound-worker --project-ref "$SUPABASE_PROJECT_REF"');
    expect(workflow).toContain('supabase functions deploy whatsapp-status-webhook --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
    expect(workflow).toContain('supabase functions deploy seo-web-performance --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
    expect(workflow).not.toContain('supabase functions deploy whatsapp-send --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
    expect(workflow).not.toContain('supabase functions deploy whatsapp-outbound-worker --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
  });
});
