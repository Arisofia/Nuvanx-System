import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");

describe("Deal Factory contract", () => {
  it("uses the verified NUVANX pipeline and stages", () => {
    expect(source).toContain('const PIPELINE_ID = "3707782370"');
    for (const stage of ["5159669951", "5159669952", "5159669955", "5159669956", "5159669957"]) {
      expect(source).toContain(stage);
    }
  });

  it("requires the exact Supabase service-role credential before queue processing", () => {
    expect(source).toContain("async function requireServiceRole");
    expect(source).toContain("secretMatches(match[1], SERVICE_ROLE)");
    expect(source).toContain('message: "Forbidden"');
  });

  it("loads HubSpot from env or the service-role-only runtime vault RPC", () => {
    expect(source).toContain('Deno.env.get("HUBSPOT_ACCESS_TOKEN")');
    expect(source).toContain('rpc("nvx_get_runtime_secret", { p_name: "HUBSPOT_ACCESS_TOKEN" })');
  });

  it("has provider-side idempotency before create", () => {
    expect(source).toContain('return `NUVANX · ${leadId}`');
    const search = source.indexOf("findExistingDeal(name)");
    const create = source.indexOf('hubspot(`/crm/v3/objects/deals`', search);
    expect(search).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(search);
    expect(source).toContain("exact || results[0] || null");
  });

  it("suppresses QA contacts before any Deal write", () => {
    expect(source).toContain("if (truthy(payload?.properties?.nvx_is_test_lead))");
    expect(source).toContain('projection_status: "suppressed"');
  });

  it("requires the HubSpot contact association and never embeds medical semantics in deal name", () => {
    expect(source).toContain("ensureAssociation");
    expect(source).toContain("defaultDealContactAssociationTypeId");
    expect(source).not.toMatch(/treatment|diagnosis|body_area|procedure/i);
  });

  it("inherits owner when present and keeps EUR as the canonical deal currency", () => {
    expect(source).toContain("projection.owner_id || DEFAULT_OWNER_ID");
    expect(source).toContain('deal_currency_code: projection.currency_code || "EUR"');
  });
});
