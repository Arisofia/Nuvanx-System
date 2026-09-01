import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");

describe("runtime bootstrap contract", () => {
  it("accepts only a bounded bearer token and never logs or returns it", () => {
    expect(source).toContain('req.headers.get("Authorization")');
    expect(source).toContain("token.length >= 20");
    expect(source).not.toMatch(/console\.(?:log|error)\([^\n]*token/i);
    const replyCalls = source.match(/return\s+reply\([\s\S]*?\);/g) || [];
    expect(replyCalls.length).toBeGreaterThan(0);
    expect(replyCalls.join("\n")).not.toMatch(/\btoken\s*:/i);
  });

  it("verifies the private-app token against the canonical NUVANX Hub ID", () => {
    expect(source).toContain('const EXPECTED_HUB_ID = "147416356"');
    expect(source).toContain("/oauth/v2/private-apps/get/access-token-info");
    expect(source).toContain("verified.hubId !== EXPECTED_HUB_ID");
  });

  it("requires contact and deal read/write scopes used by RevOps runtime", () => {
    const scopesDeclaration = source.match(/const REQUIRED_SCOPES = new Set\(\[([\s\S]*?)\]\);/)?.[1] || "";
    expect(scopesDeclaration).toContain('"crm.objects.contacts.read"');
    expect(scopesDeclaration).toContain('"crm.objects.contacts.write"');
    expect(scopesDeclaration).toContain('"crm.objects.deals.read"');
    expect(scopesDeclaration).toContain('"crm.objects.deals.write"');
    expect(source).toContain("const missingScopes = Array.from(REQUIRED_SCOPES).filter((scope) => !verified.scopes.includes(scope));");
    expect(source).toContain("missing_scopes: missingScopes");
    expect(source).toContain("missingScopes.length");
  });

  it("persists the allowlisted HubSpot credential only through the vault RPC", () => {
    expect(source).toContain('rpc("nvx_set_runtime_secret"');
    expect(source).toContain('p_name: "HUBSPOT_ACCESS_TOKEN"');
    expect(source).not.toMatch(/vault\.create_secret|vault\.update_secret/);
  });

  it("seeds the dispatcher with this runtime's own Supabase URL", () => {
    expect(source).toContain('const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").trim()');
    expect(source).toContain('rpc("nvx_set_revops_project_url"');
    expect(source).toContain("p_value: SUPABASE_URL");
    expect(source).toContain('project_route: "environment_local"');
    expect(source).not.toContain("ssvvuuysgxyqvmovrlvk.supabase.co");
  });

  it("uses repository Deno typings and treats caught failures as unknown", () => {
    expect(source).not.toContain("declare const Deno: any");
    expect(source).toContain("catch (error: unknown)");
    expect(source).not.toContain("catch (error: any)");
  });

  it("keeps error reporting fail-safe while preserving object-shaped and primitive messages", () => {
    expect(source).toContain("function safeErrorMessage(error: unknown): string");
    expect(source).toContain('error !== null && typeof error === "object" && "message" in error');
    expect(source).toContain("String((error as { message: unknown }).message)");
    expect(source).toMatch(/function safeErrorMessage\(error: unknown\): string \{[\s\S]*?try \{[\s\S]*?return String\(error\);[\s\S]*?catch \{[\s\S]*?return "error";[\s\S]*?\}/);
    expect(source).toContain("const message = safeErrorMessage(error)");
  });
});