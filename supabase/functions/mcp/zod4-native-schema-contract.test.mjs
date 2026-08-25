import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('supabase/functions/mcp/index.ts', 'utf8');
const localConfig = readFileSync('supabase/functions/mcp/deno.json', 'utf8');
const rootConfig = readFileSync('supabase/functions/deno.json', 'utf8');

describe('MCP native Zod 4 schema contract', () => {
  it('uses native JSON Schema conversion in input mode', () => {
    expect(source).toContain("z.toJSONSchema(schema as z.ZodType, { io: 'input' })");
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
