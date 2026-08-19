import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");

describe("web lead reconciliation contract", () => {
  it("requires a HubSpot contact matched by exact nvx_lead_id", () => {
    expect(source).toContain('propertyName: "nvx_lead_id"');
    expect(source).toContain('operator: "EQ"');
    expect(source).toContain("if (results.length !== 1)");
    expect(source).toContain('cleanUuidV4(props.nvx_lead_id) !== nvxLeadId');
  });

  it("verifies the HubSpot email hash before creating a lead episode", () => {
    const verifyHash = source.indexOf('HubSpot email hash mismatch');
    const insertLead = source.indexOf('.from("leads").insert(leadPayload)');
    expect(verifyHash).toBeGreaterThan(-1);
    expect(insertLead).toBeGreaterThan(verifyHash);
    expect(source).not.toMatch(/from\("leads"\)[\s\S]{0,240}\.eq\("email"/);
  });

  it("never creates or reconciles QA as a production lead", () => {
    const qaGuard = source.indexOf("if (attribution.is_test_lead === true)");
    const contactFetch = source.indexOf("hubSpotContactByLeadId", qaGuard);
    expect(qaGuard).toBeGreaterThan(-1);
    expect(contactFetch).toBeGreaterThan(qaGuard);
    expect(source).toContain('reconciliation_status: "qa_suppressed"');
    expect(source).toContain("if (isTruthy(props.nvx_is_test_lead))");
  });

  it("creates a dedicated website_hubspot episode before calling the atomic finalizer", () => {
    expect(source).toContain('source: "website_hubspot"');
    expect(source).toContain('external_id: `website:${nvxLeadId}`');
    const insertLead = source.indexOf('.from("leads").insert(leadPayload)');
    const finalizer = source.indexOf("await finalizeReconciliation(", insertLead);
    expect(insertLead).toBeGreaterThan(-1);
    expect(finalizer).toBeGreaterThan(insertLead);
  });

  it("does not write the reconciled FK or downstream queues in separate client-side transactions", () => {
    expect(source).not.toContain("applied_lead_id: lead.id");
    expect(source).not.toContain('from("hubspot_deal_projections").upsert');
    expect(source).not.toContain('rpc("queue_google_data_manager_event"');
    expect(source).toContain("async function finalizeReconciliation");
  });

  it("never marks an already-applied attribution as failed from a retry path", () => {
    expect(source).toContain('.is("applied_lead_id", null)');
  });
});
