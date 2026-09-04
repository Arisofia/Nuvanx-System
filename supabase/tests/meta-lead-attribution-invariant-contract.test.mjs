import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  fileURLToPath(new URL('../migrations/20260904180500_enforce_meta_lead_attribution_invariant.sql', import.meta.url)),
  'utf8',
);
const executable = migration.replace(/^\s*--.*$/gm, '');

describe('Meta lead attribution invariant', () => {
  it('moves lineage ownership to the database boundary for every Meta lead insertion route', () => {
    expect(migration).toContain('create or replace function private.nvx_ensure_meta_lead_attribution()');
    expect(migration).toContain('security definer');
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain('create trigger meta_lead_attribution_invariant');
    expect(migration).toContain('after insert or update on public.leads');
    expect(migration).toContain("= 'meta_leadgen'");
    expect(migration).toContain('execute function private.nvx_ensure_meta_lead_attribution()');
  });

  it('fails closed when a Meta lead cannot satisfy the attribution identity contract', () => {
    expect(migration).toContain("raise exception 'meta_leadgen lead requires external_id before attribution'");
    expect(migration).toContain("raise exception 'meta_leadgen external_id exceeds meta_attribution.leadgen_id contract'");
    expect(migration).toContain("raise exception 'meta_leadgen lineage identifier exceeds meta_attribution contract'");
  });

  it('converges lineage idempotently without erasing richer existing attribution', () => {
    expect(migration).toContain('on conflict (lead_id) do update set');
    expect(migration).toContain('page_id = coalesce(excluded.page_id, public.meta_attribution.page_id)');
    expect(migration).toContain('form_id = coalesce(excluded.form_id, public.meta_attribution.form_id)');
    expect(migration).toContain('captured_at = least(public.meta_attribution.captured_at, excluded.captured_at)');
  });

  it('repairs orphaned live Meta leads by contract and proves none remain', () => {
    expect(migration).toContain('left join public.meta_attribution a on a.lead_id = l.id');
    expect(migration).toContain('and a.lead_id is null');
    expect(migration).toContain("raise exception 'Meta lead attribution invariant failed: % live orphan(s) remain'");
    expect(migration).not.toContain('2e76b02e-33df-421c-b285-c74aa5b2d3ef');
    expect(migration).not.toContain('47f7d3fe-b178-4c8a-a0dd-2c63c7c234bd');
    expect(migration).not.toContain('1876033400044517');
    expect(migration).not.toContain('920250020698147');
  });

  it('does not introduce destructive cleanup or broaden function execution', () => {
    expect(executable).not.toMatch(/\bDELETE\s+FROM\s+public\.meta_attribution\b/i);
    expect(executable).not.toMatch(/\bCASCADE\b/i);
    expect(migration).toContain('revoke all on function private.nvx_ensure_meta_lead_attribution() from public;');
  });
});
