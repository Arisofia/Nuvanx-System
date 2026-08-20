import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../../migrations/20260820095000_meta_crm_conversion_outbox.sql', import.meta.url),
  'utf8',
);

const tableBlock = migration.match(
  /CREATE TABLE IF NOT EXISTS public\.meta_crm_conversion_outbox \(([\s\S]*?)\n\);/,
)?.[1] || '';

describe('Meta CRM conversion outbox contract', () => {
  it('is hold-only and contains no outbound Meta transport', () => {
    expect(migration).toContain("status text NOT NULL DEFAULT 'held'");
    expect(migration).toContain("'awaiting_events_manager_funnel_validation'");
    expect(migration).not.toMatch(/graph\.facebook\.com/i);
    expect(migration).not.toMatch(/\bfetch\s*\(/i);
    expect(migration).not.toMatch(/web-events/i);
  });

  it('uses the canonical Meta Lead Ads identity bridge', () => {
    expect(migration).toContain('FROM public.meta_attribution ma');
    expect(migration).toContain('ma.lead_id = p_lead_id');
    expect(migration).toContain('ma.leadgen_id');
    expect(migration).toContain('UNIQUE (leadgen_id, stage_key)');
  });

  it('keeps the proposed funnel semantics explicit', () => {
    expect(migration).toContain("WHEN 'lead' THEN 'Lead'");
    expect(migration).toContain("WHEN 'appointment_scheduled' THEN 'Schedule'");
    expect(migration).toContain("WHEN 'qualified' THEN 'QualifiedLead'");
    expect(migration).toContain("WHEN 'closed_won' THEN 'Purchase'");
  });

  it('never treats convertido alone as a purchase', () => {
    expect(migration).toContain("p_stage_key = 'qualified' AND v_lead.stage::text IS DISTINCT FROM 'convertido'");
    expect(migration).toContain("p_stage_key = 'closed_won' AND COALESCE(v_lead.verified_revenue, 0) <= 0");
    expect(migration).toContain("'closed_won'");
    expect(migration).toContain("'verified_revenue_positive'");
  });

  it('captures only future transitions and performs no historical backfill', () => {
    expect(migration).toContain('AFTER INSERT OR UPDATE OF lead_id ON public.meta_attribution');
    expect(migration).toContain('AFTER UPDATE OF appointment_date, stage, verified_revenue, deleted_at ON public.leads');
    expect(migration).not.toMatch(/INSERT INTO public\.meta_crm_conversion_outbox[\s\S]{0,500}\bSELECT\b/i);
    expect(migration).toContain('Deliberately no INSERT ... SELECT backfill');
  });

  it('stores no direct PII or clinical fields in the outbox schema', () => {
    expect(tableBlock).not.toMatch(/\bemail\b/i);
    expect(tableBlock).not.toMatch(/\bphone\b/i);
    expect(tableBlock).not.toMatch(/\btreatment\b/i);
    expect(tableBlock).not.toMatch(/\bdiagnosis\b/i);
    expect(tableBlock).not.toMatch(/\bmessage\b/i);
    expect(tableBlock).not.toMatch(/\bevent_source_url\b/i);
  });

  it('fails closed for deleted and non-Meta leads', () => {
    expect(migration).toContain('AND deleted_at IS NULL');
    expect(migration).toContain('IF v_leadgen_id IS NULL THEN');
    expect(migration).toContain('RETURN false;');
  });
});
