import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const capture = fs.readFileSync('supabase/functions/lead-captured/index.ts', 'utf8');
const reconcile = fs.readFileSync('supabase/functions/web-lead-reconcile/index.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260831031258_canonical_attribution_identity_and_qa_cleanup.sql', 'utf8');

describe('Attribution Identity v1 contract', () => {
  it('keeps Meta browser identity consent-gated and non-synthetic', () => {
    expect(capture).toMatch(/"fbclid", "fbc", "fbp"/);
    expect(capture).toMatch(/marketingConsent \? cleanAttribution\(body\.conversion_attribution\) : \{\}/);
    expect(capture).toMatch(/FBP is never synthesized/);
    expect(reconcile).toMatch(/fbc: capture\.marketing_consent === true \? attrValue\(capture, "fbc"\) : null/);
    expect(reconcile).toMatch(/fbp: capture\.marketing_consent === true \? attrValue\(capture, "fbp"\) : null/);
  });

  it('keeps cleanup replay-safe and bounded to the known QA baseline', () => {
    expect(migration).toMatch(/IF v_count NOT IN \(0, 14\) THEN/);
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.nvx_get_attribution_health\(\)/);
  });

  it('does not mutate clinical stage or verified revenue', () => {
    expect(migration).not.toMatch(/stage\s*=\s*'convertido'/);
    expect(migration).not.toMatch(/verified_revenue\s*=/);
  });
});
