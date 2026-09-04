import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const supabaseLinkRunAction = readFileSync(fileURLToPath(new URL('../../.github/actions/supabase-link-run/action.yml', import.meta.url)), 'utf8');

describe('governed Supabase CLI version', () => {
  it('stays inside the verified machine-output and migration-list compatibility window', () => {
    expect(supabaseLinkRunAction).toContain("default: '2.108.0'");
    expect(supabaseLinkRunAction).not.toContain("default: '2.102.0'");
    expect(supabaseLinkRunAction).not.toContain("default: '2.116.0'");
    expect(supabaseLinkRunAction).toContain('upstream fix supabase/cli#5410');
    expect(supabaseLinkRunAction).toContain('predating supabase/cli#5671');
    expect(supabaseLinkRunAction).toContain('moving past this boundary requires migrating that gate first');
  });
});
