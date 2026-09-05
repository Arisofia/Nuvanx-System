import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/deploy-standalone-edge-functions.yml', 'utf8');
const acceptance = readFileSync('supabase/functions/meta-runtime-credential-acceptance/index.ts', 'utf8');

describe('Meta canonical token authority regression', () => {
  it('never sources the canonical management token from GitHub or Edge environment', () => {
    expect(workflow).not.toContain('META_CANONICAL_ACCESS_TOKEN');
    expect(acceptance).not.toContain('META_CANONICAL_ACCESS_TOKEN');
    expect(acceptance).not.toContain('Deno.env.get("META_ACCESS_TOKEN")');
    expect(acceptance).toContain('.from("credentials")');
    expect(acceptance).toContain('.eq("service", "meta_ads")');
  });
});