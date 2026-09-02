import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const migration = fs.readFileSync(
  'supabase/migrations/20260902092000_reconcile_source_to_cash_contract.sql',
  'utf8',
);

describe('source_to_cash clean-replay contract', () => {
  it('accepts only canonical Production or the exact observed replay signature', () => {
    expect(migration).toContain('v_signature text;');
    expect(migration).toContain("1:lead_id:uuid\\n2:user_id:uuid\\n3:lead_name:character varying(255)\\n4:acquisition_channel:character varying(64)");
    expect(migration).toContain("17:patient_name:character varying\\n18:doctoralia_ltv:numeric(12,2)\\n19:settled_amount:numeric(12,2)");
    expect(migration).toContain("1:lead_id:uuid\\n2:user_id:uuid\\n3:lead_name:text\\n4:acquisition_channel:text");
    expect(migration).toContain("17:patient_name:text\\n18:doctoralia_ltv:numeric(14,2)\\n19:settled_amount:numeric(14,2)");
    expect(migration).toContain('23:effective_revenue:numeric');
    expect(migration).toContain('Unexpected source_to_cash signature');
  });

  it('rebuilds only without CASCADE and refuses dependent views', () => {
    expect(migration).toContain('Cannot rebuild legacy source_to_cash: dependent view exists');
    expect(migration).toContain('DROP VIEW public.source_to_cash;');
    expect(migration).not.toMatch(/DROP\s+VIEW\s+public\.source_to_cash[^;]*CASCADE/i);
  });

  it('pins the public output types to the Production contract', () => {
    expect(migration).toContain('l.name::character varying(255) AS lead_name');
    expect(migration).toContain('l.source::character varying(64) AS acquisition_channel');
    expect(migration).toContain('l.campaign_name::character varying(255) AS campaign_name');
    expect(migration).toContain('l.campaign_id::character varying(64) AS campaign_id');
    expect(migration).toContain('l.reply_delay_minutes::integer AS reply_delay_minutes');
    expect(migration).toContain('p.total_ltv::numeric(12,2) AS doctoralia_ltv');
    expect(migration).toContain('fs.amount_net::numeric(12,2) AS settled_amount');
    expect(migration).toContain('fs.template_name::character varying(255) AS financing_template');
    expect(migration).toContain('COALESCE(p.name::text, dai.dai_patient_name::text)::character varying AS patient_name');
  });

  it('preserves view options, grants and owner when replay requires a rebuild', () => {
    expect(migration).toContain('nvx_source_to_cash_restore');
    expect(migration).toContain('nvx_source_to_cash_acl');
    expect(migration).toContain('pg_catalog.aclexplode');
    expect(migration).toContain('ALTER VIEW public.source_to_cash SET');
    expect(migration).toContain('GRANT %s ON TABLE public.source_to_cash');
    expect(migration).toContain('ALTER VIEW public.source_to_cash OWNER TO %I');
  });

  it('does not rewrite source data', () => {
    expect(migration).not.toMatch(/\bUPDATE\s+public\./i);
    expect(migration).not.toMatch(/\bDELETE\s+FROM\s+public\./i);
    expect(migration).not.toMatch(/\bINSERT\s+INTO\s+public\./i);
  });
});
