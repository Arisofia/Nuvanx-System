import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");

describe("RevOps dispatcher contract", () => {
  it("authenticates only with the Vault-generated internal secret", () => {
    expect(source).toContain('req.headers.get("x-nvx-internal-secret")');
    expect(source).toContain('p_name: "REVOPS_INTERNAL_SECRET"');
    expect(source).toContain("secretMatches(received, String(expected))");
    expect(source).toContain('message: "Forbidden"');
  });

  it("allowlists only governed RevOps workers", () => {
    expect(source).toContain('new Set(["web-lead-reconcile", "deal-factory", "google-data-manager-export"])');
    expect(source).toContain("if (!ALLOWED_WORKERS.has(worker))");
  });

  it("upgrades the narrow dispatch credential to service-role only inside Edge Runtime", () => {
    expect(source).toContain('Authorization: `Bearer ${SERVICE_ROLE}`');
    expect(source).toContain('fetch(`${SUPABASE_URL}/functions/v1/${worker}`');
  });

  it("does not expose credentials or worker response bodies", () => {
    expect(source).not.toMatch(/console\.(?:log|error)\([^\n]*(?:received|expected|SERVICE_ROLE)/);
    expect(source).not.toContain("await response.text()");
    expect(source).not.toContain("await response.json()");
  });
});
