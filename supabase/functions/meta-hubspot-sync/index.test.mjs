import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
const deployWorkflow = readFileSync(
  fileURLToPath(new URL("../../../.github/workflows/deploy-standalone-edge-functions.yml", import.meta.url)),
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
