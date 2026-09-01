import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const hardeningPath = 'supabase/migrations/20260901080300_harden_security_definer_rpc_access.sql';
const repairPath = 'supabase/migrations/20260901100500_reassert_authenticated_control_centre_monitor_rpcs.sql';
const hardening = fs.readFileSync(hardeningPath, 'utf8');
const repair = fs.readFileSync(repairPath, 'utf8');
const hubspotMonitor = fs.readFileSync('frontend/src/components/dashboard/HubSpotMarketingContactMonitor.tsx', 'utf8');
const attributionMonitor = fs.readFileSync('frontend/src/components/dashboard/AttributionHealthMonitor.tsx', 'utf8');

describe('Control Centre authenticated monitor RPC ACL contract', () => {
  it('repairs the two authenticated RPCs after the hardening migration that revoked them', () => {
    expect(hardening).toContain('REVOKE EXECUTE ON FUNCTION public.nvx_get_hubspot_marketing_contact_monitor() FROM authenticated;');
    expect(hardening).toContain('REVOKE EXECUTE ON FUNCTION public.nvx_get_attribution_health() FROM authenticated;');
    expect(repairPath.localeCompare(hardeningPath)).toBeGreaterThan(0);

    for (const signature of [
      'public.nvx_get_hubspot_marketing_contact_monitor()',
      'public.nvx_get_attribution_health()',
    ]) {
      expect(repair).toContain(`revoke all on function ${signature} from public;`);
      expect(repair).toContain(`revoke all on function ${signature} from anon;`);
      expect(repair).toContain(`grant execute on function ${signature} to authenticated, service_role;`);
    }
  });

  it('matches RPCs actually called by the authenticated dashboard', () => {
    expect(hubspotMonitor).toContain("supabase.rpc('nvx_get_hubspot_marketing_contact_monitor')");
    expect(attributionMonitor).toContain("supabase.rpc('nvx_get_attribution_health')");
  });

  it('does not grant either monitor RPC to anon or PUBLIC', () => {
    expect(repair).not.toMatch(/grant\s+execute[\s\S]*\bto\s+(anon|public)\b/i);
  });
});
