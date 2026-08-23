import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/deploy-standalone-edge-functions.yml', 'utf8');

describe('standalone Edge deployment ownership', () => {
  it('owns dashboard, agent-run, runtime-bootstrap and shared changes', () => {
    for (const path of [
      'supabase/functions/dashboard/**',
      'supabase/functions/agent-run/**',
      'supabase/functions/runtime-bootstrap/**',
      'supabase/functions/_shared/**',
    ]) {
      expect(workflow).toContain(path);
    }
  });

  it('preserves the production JWT policies while deploying each standalone function', () => {
    expect(workflow).toContain('supabase functions deploy dashboard --project-ref "$SUPABASE_PROJECT_REF"');
    expect(workflow).toContain('supabase functions deploy agent-run --project-ref "$SUPABASE_PROJECT_REF"');
    expect(workflow).toContain('supabase functions deploy runtime-bootstrap --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
    expect(workflow).not.toContain('supabase functions deploy dashboard --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
    expect(workflow).not.toContain('supabase functions deploy agent-run --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
  });
});
