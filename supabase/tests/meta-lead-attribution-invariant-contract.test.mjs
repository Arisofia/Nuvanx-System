import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const readMigration = (name) => readFileSync(
  fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)),
  'utf8',
);
const stripComments = (sql) => sql
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*--.*$/gm, '');

const identityMigration = readMigration('20260904180400_remove_global_meta_leadgen_uniqueness.sql');
const migration = readMigration('20260904180500_enforce_meta_lead_attribution_invariant.sql');
const identityExecutable = stripComments(identityMigration);
const executable = stripComments(migration);

describe('Meta lead attribution invariant', () => {
  it('uses one convergence owner for new writes and historical repair', () => {
    expect(executable).toContain('create or replace function private.nvx_converge_meta_lead_attribution(p_lead public.leads)');
    expect(executable).toContain('perform private.nvx_converge_meta_lead_attribution(new);');
    expect(executable).toContain('perform private.nvx_converge_meta_lead_attribution(v_lead);');
    expect(executable).toContain('security definer');
    expect(executable).toContain("set search_path = ''");
  });

  it('separates insert and lineage-bearing update triggers without a stale fast path', () => {
    expect(executable).toContain('create trigger meta_lead_attribution_insert_invariant');
    expect(executable).toContain('after insert on public.leads');
    expect(executable).toContain('create trigger meta_lead_attribution_update_invariant');
    expect(executable).toContain('after update of');
    expect(executable).toMatch(/update of[\s\S]*\bmetadata\b[\s\S]*\bcreated_at_meta\b[\s\S]*\bcreated_at\b[\s\S]*\bdeleted_at\b[\s\S]*on public\.leads/i);
    expect(executable).not.toContain("if tg_op = 'UPDATE'");
  });

  it('fails closed for both new writes and historical repair when identity is invalid', () => {
    expect(executable).toContain("raise exception 'meta_leadgen lead requires external_id before attribution'");
    expect(executable).toContain("raise exception 'meta_leadgen external_id exceeds meta_attribution.leadgen_id contract'");
    expect(executable).toContain("raise exception 'meta_leadgen lineage identifier exceeds meta_attribution contract'");
    expect(executable).toMatch(/for v_lead in[\s\S]*perform private\.nvx_converge_meta_lead_attribution\(v_lead\)/i);
  });

  it('converges lineage idempotently without erasing richer existing optional attribution', () => {
    expect(executable).toContain('on conflict (lead_id) do update set');
    expect(executable).toContain('page_id = coalesce(excluded.page_id, public.meta_attribution.page_id)');
    expect(executable).toContain('form_id = coalesce(excluded.form_id, public.meta_attribution.form_id)');
    expect(executable).toContain('captured_at = least(public.meta_attribution.captured_at, excluded.captured_at)');
  });

  it('removes the unsafe global leadgen uniqueness assumption without removing lookup indexing', () => {
    expect(identityExecutable).toContain('drop index if exists public.meta_attribution_leadgen_id_uidx;');
    expect(identityExecutable).toContain('create index if not exists meta_attribution_leadgen_id_idx');
    expect(identityExecutable).not.toMatch(/create\s+unique\s+index[\s\S]{0,160}meta_attribution[\s\S]{0,160}leadgen_id/i);
  });

  it('repairs orphaned live Meta leads by contract and proves none remain without embedding Production identifiers', () => {
    expect(executable).toContain('left join public.meta_attribution a on a.lead_id = l.id');
    expect(executable).toContain('and a.lead_id is null');
    expect(executable).toContain("raise exception 'Meta lead attribution invariant failed: % live orphan(s) remain'");
    expect(executable).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(executable).not.toMatch(/'\d{10,}'/);
  });

  it('leaves transaction ownership to the migration runner for every PostgreSQL transaction spelling', () => {
    expect(executable).not.toMatch(/^\s*begin(?:\s+(?:work|transaction))?\s*;/im);
    expect(executable).not.toMatch(/^\s*start\s+transaction\b/im);
    expect(executable).not.toMatch(/^\s*commit(?:\s+(?:work|transaction))?(?:\s+and\s+(?:no\s+)?chain)?\s*;/im);
  });

  it('does not introduce destructive cleanup or broaden function execution', () => {
    expect(executable).not.toMatch(/\bDELETE\s+FROM\s+public\.meta_attribution\b/i);
    expect(executable).not.toMatch(/\b(?:drop|truncate)\b[\s\S]{0,120}?\bcascade\b/i);
    expect(executable).toContain('revoke all on function private.nvx_converge_meta_lead_attribution(public.leads) from public;');
    expect(executable).toContain('revoke all on function private.nvx_ensure_meta_lead_attribution() from public;');
  });
});
