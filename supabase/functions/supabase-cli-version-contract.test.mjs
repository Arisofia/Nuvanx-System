import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const supabaseLinkRunAction = readFileSync('.github/actions/supabase-link-run/action.yml', 'utf8');

describe('governed Supabase CLI version', () => {
  it('stays past the v2.102.0 machine-output regression used by Edge release inventory checks', () => {
    expect(supabaseLinkRunAction).toContain("default: '2.116.0'");
    expect(supabaseLinkRunAction).not.toContain("default: '2.102.0'");
    expect(supabaseLinkRunAction).toContain('upstream fix supabase/cli#5410');
  });
});
