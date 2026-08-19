import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");

describe("web lead reconciliation contract", () => {
  it("requires the exact service-role credential after gateway auth", () => {
    expect(source).toContain("async function requireServiceRole");
    expect(source).toContain('req.headers.get("Authorization")');
    expect(source).toContain("secretMatches(match[1], SERVICE_ROLE)");
    expect(source).toContain('message: "Forbidden"');
  });

  it("uses web_lead_captures as the canonical pending queue", () => {
    const handler = source.indexOf("Deno.serve");
    const queue = source.indexOf('.from("web_lead_captures")', handler);
    expect(queue).toBeGreaterThan(handler);
    expect(source.slice(handler)).not.toMatch(/\.from\("google_click_attributions"\)[\s\S]{0,300}\.in\("reconciliation_status"/);
  });

  it("requires a HubSpot contact matched by exact nvx_lead_id", () => {
    expect(source).toContain('propertyName: "nvx_lead_id"');
    expect(source).toContain('operator: "EQ"');
    expect(source).toContain("if (results.length !== 1)");
    expect(source).toContain('cleanUuidV4(props.nvx_lead_id) !== nvxLeadId');
  });

  it("checks capture email identity when a consented hash exists", () => {
    const verifyHash = source.indexOf('HubSpot email hash mismatch');
    const insertLead = source.indexOf('.from("leads").insert(leadPayload)');
    expect(verifyHash).toBeGreaterThan(-1);
    expect(insertLead).toBeGreaterThan(verifyHash);
    expect(source).toContain("if (expectedEmailHash)");
    expect(source).not.toMatch(/from\("leads"\)[\s\S]{0,240}\.eq\("email"/);
  });

  it("never creates or reconciles QA as a production lead", () => {
    const qaGuard = source.indexOf("if (capture.is_test_lead === true)");
    const contactFetch = source.indexOf("hubSpotContactByLeadId", qaGuard);
    expect(qaGuard).toBeGreaterThan(-1);
    expect(contactFetch).toBeGreaterThan(qaGuard);
    expect(source).toContain('reconciliation_status: "qa_suppressed"');
    expect(source).toContain("if (isTruthy(props.nvx_is_test_lead))");
    expect(source).toContain("suppressGoogleLineage");
  });

  it("creates a dedicated website_hubspot episode before the atomic capture finalizer", () => {
    expect(source).toContain('source: "website_hubspot"');
    expect(source).toContain('external_id: `website:${nvxLeadId}`');
    const insertLead = source.indexOf('.from("leads").insert(leadPayload)');
    const finalizer = source.indexOf("await finalizeReconciliation(", insertLead);
    expect(insertLead).toBeGreaterThan(-1);
    expect(finalizer).toBeGreaterThan(insertLead);
    expect(source).toContain('rpc("finalize_web_capture_reconciliation"');
  });

  it("treats Google attribution as optional enrichment rather than the lead source", () => {
    expect(source).toContain("googleAttributionForLead");
    expect(source).toContain("google_attribution: Boolean(google)");
    expect(source).toContain('gclid: attrValue(capture, "gclid") || google?.gclid || null');
  });

  it("does not write downstream Deal/Data Manager queues client-side", () => {
    expect(source).not.toContain('from("hubspot_deal_projections").upsert');
    expect(source).not.toContain('rpc("queue_google_data_manager_event"');
    expect(source).toContain("async function finalizeReconciliation");
  });

  it("loads HubSpot from env or the service-role-only runtime vault RPC", () => {
    expect(source).toContain('Deno.env.get("HUBSPOT_ACCESS_TOKEN")');
    expect(source).toContain('rpc("nvx_get_runtime_secret", { p_name: "HUBSPOT_ACCESS_TOKEN" })');
  });
});
