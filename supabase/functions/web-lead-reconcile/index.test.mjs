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

  it("creates a dedicated website_hubspot episode and only then writes applied_lead_id", () => {
    expect(source).toContain('source: "website_hubspot"');
    expect(source).toContain('external_id: `website:${nvxLeadId}`');
    const insertLead = source.indexOf('.from("leads").insert(leadPayload)');
    const appliedUpdate = source.indexOf("applied_lead_id: lead.id");
    expect(insertLead).toBeGreaterThan(-1);
    expect(appliedUpdate).toBeGreaterThan(insertLead);
  });

  it("queues downstream projections only after verified reconciliation", () => {
    const appliedUpdate = source.indexOf("applied_lead_id: lead.id");
    expect(source.indexOf('from("hubspot_deal_projections")', appliedUpdate)).toBeGreaterThan(appliedUpdate);
    expect(source.indexOf('rpc("queue_google_data_manager_event"', appliedUpdate)).toBeGreaterThan(appliedUpdate);
  });
});
