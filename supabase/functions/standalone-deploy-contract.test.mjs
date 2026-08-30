import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/deploy-standalone-edge-functions.yml', 'utf8');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

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
    expect(workflow).not.toContain("ref: ${{ github.event_name == 'workflow_run'");
  });

  it('serializes against Manual Maintenance deploy_edge', () => {
    expect(workflow).toContain('group: manual-maintenance-deploy_edge');
  });

  it('revalidates tests and all standalone Deno entrypoints before deployment', () => {
    expect(packageJson.scripts.test).toContain('vitest run supabase/functions');
    expect(workflow).toContain('npm test');
    expect(workflow).toContain('supabase/functions/dashboard/index.ts');
    expect(workflow).toContain('supabase/functions/agent-run/index.ts');
    expect(workflow).toContain('supabase/functions/runtime-bootstrap/index.ts');
    expect(workflow).toContain('supabase/functions/google-ads-health/index.ts');
    expect(workflow).toContain('supabase/functions/meta-lead-backfill/index.ts');
    expect(workflow).toContain('supabase/functions/meta-daily-insights/index.ts');
    expect(workflow).toContain('supabase/functions/meta-capi-dispatch/index.ts');
    expect(workflow).toContain('supabase/functions/whatsapp-send/index.ts');
    expect(workflow).toContain('supabase/functions/whatsapp-status-webhook/index.ts');
  });

  it('preserves the production JWT policies while deploying each standalone function', () => {
    expect(workflow).toContain('supabase functions deploy dashboard --project-ref "$SUPABASE_PROJECT_REF"');
    expect(workflow).toContain('supabase functions deploy agent-run --project-ref "$SUPABASE_PROJECT_REF"');
    expect(workflow).toContain('supabase functions deploy runtime-bootstrap --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
    expect(workflow).toContain('supabase functions deploy google-ads-health --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
    expect(workflow).toContain('supabase functions deploy meta-lead-backfill --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
    expect(workflow).toContain('supabase functions deploy meta-daily-insights --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
    expect(workflow).toContain('supabase functions deploy meta-capi-dispatch --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
    expect(workflow).toContain('supabase functions deploy whatsapp-send --project-ref "$SUPABASE_PROJECT_REF"');
    expect(workflow).toContain('supabase functions deploy whatsapp-status-webhook --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
    expect(workflow).not.toContain('supabase functions deploy whatsapp-send --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
    expect(workflow).not.toContain('supabase functions deploy dashboard --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
    expect(workflow).not.toContain('supabase functions deploy agent-run --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
  });
});
