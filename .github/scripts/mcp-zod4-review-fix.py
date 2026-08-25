from pathlib import Path

source_path = Path('supabase/functions/mcp/index.ts')
source = source_path.read_text()
old = "z.toJSONSchema(schema as z.ZodType)"
new = "z.toJSONSchema(schema as z.ZodType, { io: 'input' })"
if source.count(old) != 1:
    raise SystemExit(f'Expected one native schema adapter anchor, found {source.count(old)}')
source_path.write_text(source.replace(old, new, 1))

test_path = Path('supabase/functions/mcp/zod4-native-schema-contract.test.mjs')
test = test_path.read_text()
test = test.replace(
    "expect(source).toContain('z.toJSONSchema(schema as z.ZodType)');",
    "expect(source).toContain(\"z.toJSONSchema(schema as z.ZodType, { io: 'input' })\");",
    1,
)
if "io: 'input'" not in test:
    raise SystemExit('MCP contract test was not updated')
test_path.write_text(test)
