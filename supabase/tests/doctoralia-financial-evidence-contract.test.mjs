import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const evidenceMigration = readFileSync(
  'supabase/migrations/20260905192900_preserve_legacy_doctoralia_financial_evidence.sql',
  'utf8',
);
const boundaryMigration = readFileSync(
  'supabase/migrations/20260905193000_incremental_doctoralia_and_financial_boundary.sql',
  'utf8',
);

describe('Doctoralia legacy financial evidence boundary', () => {
  it('preserves exact legacy rows with explicit non-financial semantics before authority cleanup', () => {
    expect(evidenceMigration).toContain('create table if not exists public.doctoralia_financial_materialization_evidence');
    expect(evidenceMigration).toContain("financial_semantics text not null default 'appointment_value_unverified'");
    expect(evidenceMigration).toContain('source_snapshot jsonb not null');
    expect(evidenceMigration).toContain('to_jsonb(fs)');
    expect(evidenceMigration).toContain('v_exact_evidence_count <> v_source_count');
    expect(evidenceMigration).toContain('Doctoralia financial evidence preservation incomplete');
  });

  it('fails closed on delete unless the exact pre-delete snapshot exists', () => {
    expect(evidenceMigration).toContain('create or replace function public.nvx_require_doctoralia_financial_evidence_before_delete()');
    expect(evidenceMigration).toContain('before delete on public.financial_settlements');
    expect(evidenceMigration).toContain('e.source_snapshot = to_jsonb(old)');
    expect(evidenceMigration).toContain('Doctoralia financial row cannot be removed before exact evidence preservation');
  });

  it('keeps evidence outside the verified financial authority and then blocks future Doctoralia materialization', () => {
    expect(boundaryMigration).toContain('delete from public.financial_settlements');
    expect(boundaryMigration).toContain('financial_settlements_no_doctoralia_appointment_materialization');
    expect(boundaryMigration).toContain("Doctoralia appointment values are operational appointment data and cannot be stored here");
    expect(evidenceMigration).toContain('Audit-only snapshots');
    expect(evidenceMigration).toContain('not paid/settled cash');
  });
});
