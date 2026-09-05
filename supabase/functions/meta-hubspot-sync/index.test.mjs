import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
const deployWorkflow = readFileSync(
  fileURLToPath(new URL("../../../.github/workflows/deploy-standalone-edge-functions.yml", import.meta.url)),
  "utf8",
);
const ownerAuthorityMigration = readFileSync(
  fileURLToPath(new URL("../../migrations/20260905183000_hubspot_owner_authority.sql", import.meta.url)),
  "utf8",
);

describe("Meta to HubSpot reconciliation contract", () => {
  it("enriches already-linked HubSpot contacts instead of skipping them", () => {
    const linkedBranch = source.indexOf("if (lead.hubspot_contact_id)");
    const fetchLinked = source.indexOf("const contact = await hubspotContactById(token, contactId)", linkedBranch);
    const patchLinked = source.indexOf("await patchMissingContactProperties(token, contact, desired)", linkedBranch);
    const branchEnd = source.indexOf("const email = normalizeEmail(desired.email)", linkedBranch);

    expect(linkedBranch).toBeGreaterThan(-1);
    expect(fetchLinked).toBeGreaterThan(linkedBranch);
    expect(patchLinked).toBeGreaterThan(fetchLinked);
    expect(branchEnd).toBeGreaterThan(patchLinked);
  });

  it("patches only missing values and never overwrites populated HubSpot properties", () => {
    expect(source).toContain("function missingOnly(existing: Record<string, unknown>, desired: Record<string, string>)");
    expect(source).toContain('if (!String(existing?.[key] ?? "").trim() && value) patch[key] = value;');
    expect(source).toContain('outcome: patchedProperties.length ? "linked_enriched" : "already_linked"');
  });

  it("keeps canonical lineage and Meta attribution fields in the enrichment set", () => {
    for (const property of [
      "nvx_lead_id",
      "nvx_utm_source",
      "nvx_utm_medium",
      "nvx_utm_campaign",
      "nvx_utm_content",
      "nvx_attribution_captured_at",
    ]) {
      expect(source).toContain(`"${property}"`);
    }
    expect(source).toContain('put("nvx_utm_source", lead?.utm_source || "facebook")');
    expect(source).toContain('put("nvx_utm_medium", lead?.utm_medium || "paid_social")');
  });

  it("inherits provider owner authority without name/email heuristics", () => {
    expect(source).toContain('"hubspot_owner_id"');
    expect(source).toContain("function hubspotOwnerId(contact: any)");
    expect(source).toContain('admin.rpc("nvx_apply_hubspot_owner_authority"');
    expect(source).toContain("p_hubspot_owner_id: hubspotOwnerId(contact)");
    expect(source).not.toMatch(/owner.*(?:email|name)|(?:email|name).*owner/i);

    expect(ownerAuthorityMigration).toContain("create table if not exists public.hubspot_owner_user_mappings");
    expect(ownerAuthorityMigration).toContain("hubspot_owner_id text primary key");
    expect(ownerAuthorityMigration).toContain("user_id uuid not null references public.users(id)");
    expect(ownerAuthorityMigration).toContain("create or replace function public.nvx_apply_hubspot_owner_authority");
    expect(ownerAuthorityMigration).toContain("assigned_to = case");
    expect(ownerAuthorityMigration).toContain("when v_owner_id is null then l.assigned_to");
    expect(ownerAuthorityMigration).toContain("needs_reprojection = case");
  });

  it("preserves active Deal projection claims when provider owner changes", () => {
    expect(ownerAuthorityMigration).toContain("projection_status in ('creating', 'updating')");
    expect(ownerAuthorityMigration).toContain("then public.hubspot_deal_projections.projection_status");
    expect(ownerAuthorityMigration).toContain("then true");
    expect(ownerAuthorityMigration).toContain("else public.hubspot_deal_projections.needs_reprojection");
  });

  it("preserves linked-contact audit mode without mutation", () => {
    expect(source).toContain('outcome: missingProperties.length ? "would_enrich_linked" : "already_linked"');
    expect(source).toContain('would_enrich_linked: results.filter((row) => row.outcome === "would_enrich_linked").length');
  });

  it("retains fallback grace, race handling and the internal-secret boundary", () => {
    expect(source).toContain("NATIVE_SYNC_GRACE_MS");
    expect(source).toContain('if (Number(error?.status) !== 409) throw error;');
    expect(source).toContain('p_name: "REVOPS_INTERNAL_SECRET"');
    expect(source).toContain('req.headers.get("x-nvx-internal-secret")');
  });

  it("remains owned by the governed standalone Edge deployment", () => {
    expect(deployWorkflow).toContain("supabase/functions/meta-hubspot-sync/index.ts");
    expect(deployWorkflow).toContain(
      'supabase functions deploy meta-hubspot-sync --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt',
    );
  });
});
