from pathlib import Path

path = Path('supabase/functions/mcp/index.ts')
text = path.read_text()

old_import = "import { zodToJsonSchema } from 'zod-to-json-schema'\n"
if old_import in text:
    text = text.replace(old_import, '', 1)

old_adapter_types = '''type JsonSchemaRecord = Record<string, unknown>
type ZodSchemaAdapter = (
  schema: z.ZodTypeAny,
  options: { target: 'jsonSchema7'; $refStrategy: 'none' },
) => JsonSchemaRecord

const convertZodSchema = zodToJsonSchema as unknown as ZodSchemaAdapter

'''
if old_adapter_types in text:
    text = text.replace(old_adapter_types, '', 1)

old_adapter = '''  schemaAdapter: (schema: unknown) =>
    convertZodSchema(schema as z.ZodTypeAny, {
      target: 'jsonSchema7',
      $refStrategy: 'none',
    }),
'''
new_adapter = '''  schemaAdapter: (schema: unknown) => z.toJSONSchema(schema as z.ZodType),
'''
if old_adapter in text:
    text = text.replace(old_adapter, new_adapter, 1)
elif new_adapter not in text:
    raise SystemExit('MCP schema adapter anchor not found')

for forbidden in ('zod-to-json-schema', 'ZodTypeAny', 'convertZodSchema'):
    if forbidden in text:
        raise SystemExit(f'legacy MCP schema adapter residue: {forbidden}')

path.write_text(text)

contract = Path('supabase/functions/mcp/zod4-native-schema-contract.test.mjs')
contract.write_text('''import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('supabase/functions/mcp/index.ts', 'utf8');
const localConfig = readFileSync('supabase/functions/mcp/deno.json', 'utf8');
const rootConfig = readFileSync('supabase/functions/deno.json', 'utf8');

describe('MCP native Zod 4 schema contract', () => {
  it('uses Zod native JSON Schema conversion', () => {
    expect(source).toContain('z.toJSONSchema(schema as z.ZodType)');
    expect(source).not.toContain('zod-to-json-schema');
    expect(source).not.toContain('ZodTypeAny');
  });

  it('pins Zod 4 and removes deprecated adapter from both import maps', () => {
    expect(localConfig).toContain('npm:zod@4.1.12');
    expect(rootConfig).toContain('npm:zod@4.1.12');
    expect(localConfig).not.toContain('zod-to-json-schema');
    expect(rootConfig).not.toContain('zod-to-json-schema');
  });
});
''')
