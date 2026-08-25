import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('supabase/functions/mcp/index.ts', 'utf8');
const localConfig = readFileSync('supabase/functions/mcp/deno.json', 'utf8');
const rootConfig = readFileSync('supabase/functions/deno.json', 'utf8');

function convertRepresentativeInputSchema() {
  const script = `
    import { z } from 'zod';
    const LimitSchema = z.number().int().min(1).max(200).default(50);
    const input = z.object({ limit: LimitSchema, query: z.string().optional() });
    const schema = z.toJSONSchema(input, { io: 'input' });
    console.log(JSON.stringify(schema));
  `;

  const output = execFileSync(
    'deno',
    ['eval', '--config=supabase/functions/mcp/deno.json', script],
    { encoding: 'utf8' },
  );
  return JSON.parse(output.trim());
}

describe('MCP native Zod 4 schema contract', () => {
  it('uses native JSON Schema conversion in input mode', () => {
    expect(source).toContain("z.toJSONSchema(schema as z.ZodType, { io: 'input' })");
    expect(source).not.toContain('zod-to-json-schema');
    expect(source).not.toContain('ZodTypeAny');
  });

  it('converts representative registered input semantics with a defaulted optional limit', () => {
    const schema = convertRepresentativeInputSchema();
    expect(schema.type).toBe('object');
    expect(schema.properties?.limit?.type).toBe('integer');
    expect(schema.properties?.limit?.default).toBe(50);
    expect(schema.properties?.limit?.minimum).toBe(1);
    expect(schema.properties?.limit?.maximum).toBe(200);
    expect(schema.required ?? []).not.toContain('limit');
    expect(schema.required ?? []).not.toContain('query');
  });

  it('pins Zod 4 and removes deprecated adapter from both import maps', () => {
    expect(localConfig).toContain('npm:zod@4.1.12');
    expect(rootConfig).toContain('npm:zod@4.1.12');
    expect(localConfig).not.toContain('zod-to-json-schema');
    expect(rootConfig).not.toContain('zod-to-json-schema');
  });
});
