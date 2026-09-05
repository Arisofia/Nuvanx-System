import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');

describe('MCP health routing contract', () => {
  it('matches the Supabase function-prefixed route', () => {
    expect(source).toContain("app.get('/mcp/health'");
    expect(source).toContain("health: '/mcp/health'");
    expect(source).not.toContain("app.get('/health'");
  });
});