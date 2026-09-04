import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const supabaseLinkRunAction = readFileSync(fileURLToPath(new URL('../../.github/actions/supabase-link-run/action.yml', import.meta.url)), 'utf8');

function extractSupabaseCliDefault(actionYaml) {
  const inputBlock = actionYaml.match(/^  supabase_cli_version:\s*\n(?<block>(?:^    .*\n?)*)/m)?.groups?.block;
  const rawDefault = inputBlock?.match(/^    default:\s*(?<value>[^#\n]+?)\s*(?:#.*)?$/m)?.groups?.value?.trim();

  if (!rawDefault) return null;
  if ((rawDefault.startsWith("'") && rawDefault.endsWith("'")) || (rawDefault.startsWith('"') && rawDefault.endsWith('"'))) {
    return rawDefault.slice(1, -1);
  }
  return rawDefault;
}

describe('governed Supabase CLI version', () => {
  it('reads the effective default independently of YAML quoting', () => {
    expect(extractSupabaseCliDefault("inputs:\n  supabase_cli_version:\n    default: '2.108.0'\n")).toBe('2.108.0');
    expect(extractSupabaseCliDefault('inputs:\n  supabase_cli_version:\n    default: "2.108.0"\n')).toBe('2.108.0');
    expect(extractSupabaseCliDefault('inputs:\n  supabase_cli_version:\n    default: 2.108.0\n')).toBe('2.108.0');
  });

  it('stays inside the verified machine-output and migration-list compatibility window', () => {
    expect(extractSupabaseCliDefault(supabaseLinkRunAction)).toBe('2.108.0');
    expect(supabaseLinkRunAction).toContain('upstream fix supabase/cli#5410');
    expect(supabaseLinkRunAction).toContain('predating supabase/cli#5671');
    expect(supabaseLinkRunAction).toContain('moving past this boundary requires migrating that gate first');
  });
});
