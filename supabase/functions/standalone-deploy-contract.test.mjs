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
    expect(workflow).toContain('github.event.workflow_run.head_sha');
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
  });

  it('preserves the production JWT policies while deploying each standalone function', () => {
    expect(workflow).toContain('supabase functions deploy dashboard --project-ref "$SUPABASE_PROJECT_REF"');
    expect(workflow).toContain('supabase functions deploy agent-run --project-ref "$SUPABASE_PROJECT_REF"');
    expect(workflow).toContain('supabase functions deploy runtime-bootstrap --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
    expect(workflow).not.toContain('supabase functions deploy dashboard --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
    expect(workflow).not.toContain('supabase functions deploy agent-run --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
  });
});
