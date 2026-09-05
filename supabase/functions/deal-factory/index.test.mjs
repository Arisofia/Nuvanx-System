import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
const lifecycleMigration = readFileSync(
  fileURLToPath(new URL("../../migrations/20260905182000_harden_hubspot_deal_projection_lifecycle.sql", import.meta.url)),
  "utf8",
);

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
    expect(source).toContain('finalizeProjection(admin, projection, "suppressed")');
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

  it("claims queue work atomically instead of broad-replaying created projections", () => {
    expect(source).toContain('admin.rpc("nvx_claim_hubspot_deal_projections"');
    expect(source).toContain("p_lease_seconds: CLAIM_LEASE_SECONDS");
    expect(source).not.toContain('.in("projection_status", ["pending", "failed", "created"])');
    expect(lifecycleMigration.toLowerCase()).toContain("for update skip locked");
    expect(lifecycleMigration).toContain("claim_token uuid");
    expect(lifecycleMigration).toContain("claimed_at timestamptz");
    expect(lifecycleMigration).toContain("needs_reprojection boolean not null default false");
    expect(lifecycleMigration).toContain("p.projection_status in ('pending', 'failed')");
    expect(lifecycleMigration).not.toContain("projection_status in ('pending', 'failed', 'created')");
  });

  it("invalidates only Deal inputs and preserves changes that arrive during a claim", () => {
    expect(lifecycleMigration).toContain("after update of\n  verified_revenue,\n  revenue,\n  appointment_date,\n  attended_at,\n  first_response_at,\n  first_outbound_at");
    expect(lifecycleMigration).toContain("p.projection_status in ('creating', 'updating')");
    expect(lifecycleMigration).toContain("needs_reprojection = true");
    expect(lifecycleMigration).toContain("case when v_dirty then 'pending' else 'created' end");
    expect(lifecycleMigration).not.toContain("after update of updated_at");
  });

  it("finalizes only the current claim and recovers stale leases through the fallback", () => {
    expect(source).toContain('admin.rpc("nvx_finalize_hubspot_deal_projection"');
    expect(source).toContain('p_claim_token: claimToken');
    expect(source).toContain('finalStatus === "claim_lost"');
    expect(lifecycleMigration).toContain("p.claim_token = p_claim_token");
    expect(lifecycleMigration).toContain("p.claimed_at is null or p.claimed_at < v_stale_before");
    expect(lifecycleMigration).toContain("claimed_at < now() - interval '5 minutes'");
  });
});
