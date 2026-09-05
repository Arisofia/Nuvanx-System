import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('supabase/functions/meta-runtime-credential-acceptance/index.ts', 'utf8');

describe('Meta runtime credential acceptance boundary', () => {
  it('uses only the canonical app secret and the encrypted meta_ads token authority', () => {
    expect(source).toContain('Deno.env.get("META_CANONICAL_APP_SECRET")');
    expect(source).not.toContain('META_CANONICAL_ACCESS_TOKEN');
    expect(source).not.toContain('META_REPORTING_APP_SECRET');
    expect(source).not.toContain('META_APP_SECRET');
    expect(source).toContain('.eq("service", "meta_ads")');
    expect(source).toContain('decryptCred(String(credential.encrypted_key))');
    expect(source).toContain('credentials.length !== 1');
  });

  it('binds token identity and scopes through debug_token', () => {
    expect(source).toContain('`${META_GRAPH}/debug_token`');
    expect(source).toContain('String(data?.app_id || "") !== CANONICAL_APP_ID');
    expect(source).toContain('String(data?.user_id || "") !== CANONICAL_SYSTEM_USER_ID');
    expect(source).toContain('scopes.includes("leads_retrieval")');
    expect(source).toContain('scopes.includes("pages_show_list")');
  });

  it('pins the canonical Page and proves appsecret_proof against it', () => {
    expect(source).toContain('const CANONICAL_PAGE_ID = "113908631183569"');
    expect(source).toContain('pageId !== CANONICAL_PAGE_ID');
    expect(source).toContain('proofUrl.searchParams.set("appsecret_proof", await computeAppsecretProof(ctx.managementToken))');
    expect(source).toContain('if (String(page?.id || "") !== ctx.pageId)');
    expect(source).toContain('proof_verified: true');
  });

  it('requires the internal RevOps boundary and never returns credential material', () => {
    expect(source).toContain('p_name: "REVOPS_INTERNAL_SECRET"');
    expect(source).toContain('timingSafeTextMatch');
    expect(source).not.toMatch(/reply\([^)]*managementToken/);
    expect(source).not.toMatch(/reply\([^)]*META_CANONICAL_APP_SECRET/);
    expect(source).toContain('message: "Meta credential acceptance failed"');
  });
});