import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const clinicsBridge = fs.readFileSync(
  'supabase/migrations/20260830202800_reconcile_clinics_core_contract.sql',
  'utf8',
);

describe('clinics clean-replay bridge', () => {
  it('completes the later clinic contract without altering a view-dependent name type', () => {
    expect(clinicsBridge).toMatch(/ADD COLUMN IF NOT EXISTS timezone varchar\(64\)/);
    expect(clinicsBridge).toMatch(/ALTER COLUMN name SET NOT NULL/);
    expect(clinicsBridge).not.toMatch(/ALTER COLUMN name TYPE/i);
    expect(clinicsBridge).toMatch(/clinics_slug_key UNIQUE \(slug\)/);
  });
});
