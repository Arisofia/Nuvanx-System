import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/20260905201500_add_meta_runtime_credential_acceptance_dispatcher.sql', 'utf8');

describe('Meta runtime credential dispatcher migration', () => {
  it('keeps the internal secret in Vault and exposes dispatch only to service_role', () => {
    expect(sql).toContain("FROM vault.decrypted_secrets");
    expect(sql).toContain("WHERE name = 'REVOPS_INTERNAL_SECRET'");
    expect(sql).toContain("WHERE name = 'REVOPS_PROJECT_URL'");
    expect(sql).toContain("'x-nvx-internal-secret', v_secret");
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.nvx_dispatch_meta_runtime_credential_acceptance() FROM PUBLIC');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.nvx_dispatch_meta_runtime_credential_acceptance() FROM anon');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.nvx_dispatch_meta_runtime_credential_acceptance() FROM authenticated');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.nvx_dispatch_meta_runtime_credential_acceptance() TO service_role');
  });
});