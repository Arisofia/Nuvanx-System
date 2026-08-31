import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const capture = fs.readFileSync('supabase/functions/lead-captured/index.ts', 'utf8');
const reconcile = fs.readFileSync('supabase/functions/web-lead-reconcile/index.ts', 'utf8');
const baseline = fs.readFileSync('supabase/migrations/20260831031258_canonical_attribution_identity_and_qa_cleanup.sql', 'utf8');
const hardening = fs.readFileSync('supabase/migrations/20260831081800_harden_attribution_lineage_and_tenant_health.sql', 'utf8');

describe('Attribution Identity v1 contract', () => {
  it('keeps Meta browser identity consent-gated, bounded and non-synthetic', () => {
    expect(capture).toMatch(/"fbclid", "fbc", "fbp"/);
    expect(capture).toMatch(/marketingConsent \? cleanAttribution\(body\.conversion_attribution\) : \{\}/);
    expect(capture).toMatch(/META_BROWSER_ID_MAX_LENGTH = 512/);
    expect(capture).toMatch(/FBP is never synthesized/);
    expect(reconcile).toMatch(/const consented = capture\.marketing_consent === true/);
    expect(reconcile).toMatch(/metaBrowserIdentityValue\(capture, "fbc"\)/);
    expect(reconcile).toMatch(/metaBrowserIdentityValue\(capture, "fbp"\)/);
    expect(reconcile).not.toMatch(/fbc: attrValue\(capture, "fbc"\)/);
    expect(reconcile).not.toMatch(/fbp: attrValue\(capture, "fbp"\)/);
  });

  it('keeps the original QA cleanup replay-safe and bounded to the known baseline', () => {
    expect(baseline).toMatch(/IF v_count NOT IN \(0, 14\) THEN/);
    expect(baseline).toMatch(/CREATE OR REPLACE FUNCTION public\.nvx_get_attribution_health\(\)/);
  });

  it('binds finalization to exact lead lineage and preserves service-role-only execution', () => {
    expect(hardening).toMatch(/v_lead\.nvx_lead_id IS DISTINCT FROM v_capture\.nvx_lead_id/);
    expect(hardening).toMatch(/Lead and capture lineage mismatch/);
    expect(hardening).toMatch(/v_effective_hubspot_contact_id := COALESCE\(p_hubspot_contact_id, v_lead\.hubspot_contact_id\)/);
    expect(hardening).toMatch(/REVOKE ALL ON FUNCTION public\.finalize_web_capture_reconciliation\(uuid,uuid,bigint,text\) FROM authenticated/);
    expect(hardening).toMatch(/GRANT EXECUTE ON FUNCTION public\.finalize_web_capture_reconciliation\(uuid,uuid,bigint,text\) TO service_role/);
  });

  it('scopes health ledgers through the authenticated lead tenant and normalizes nullable QA flags', () => {
    expect(hardening).toMatch(/WITH active_leads AS/);
    expect(hardening).toMatch(/FROM public\.web_lead_captures c[\s\S]*?EXISTS \([\s\S]*?FROM active_leads l/);
    expect(hardening).toMatch(/FROM public\.google_click_attributions g[\s\S]*?EXISTS \([\s\S]*?FROM active_leads l/);
    expect(hardening).toMatch(/c\.nvx_lead_id IS NOT NULL AND l\.nvx_lead_id = c\.nvx_lead_id/);
    expect(hardening).toMatch(/g\.nvx_lead_id IS NOT NULL AND l\.nvx_lead_id = g\.nvx_lead_id/);
    expect(hardening).toMatch(/COALESCE\(is_test_lead, false\)/);
    expect(hardening).toMatch(/tenant-scoped no-PII acquisition identity health/);
  });

  it('rejects malformed or oversized Meta browser identity at the database finalizer too', () => {
    expect(hardening).toMatch(/char_length\(v_fbc\) > 512/);
    expect(hardening).toMatch(/char_length\(v_fbp\) > 512/);
    expect(hardening).toMatch(/v_fbc := NULL/);
    expect(hardening).toMatch(/v_fbp := NULL/);
  });

  it('does not mutate clinical stage or verified revenue', () => {
    expect(baseline).not.toMatch(/stage\s*=\s*'convertido'/);
    expect(baseline).not.toMatch(/verified_revenue\s*=/);
    expect(hardening).not.toMatch(/stage\s*=\s*'convertido'/);
    expect(hardening).not.toMatch(/verified_revenue\s*=/);
  });
});
