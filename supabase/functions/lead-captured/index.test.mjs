import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");

describe("lead-captured canonical contract", () => {
  it("authenticates timestamp.body with HubSpot-backed HMAC and fails closed before bootstrap", () => {
    expect(source).toContain('req.headers.get("x-nvx-timestamp")');
    expect(source).toContain('req.headers.get("x-nvx-signature")');
    expect(source).toContain("SIGNATURE_MAX_SKEW_SECONDS = 300");
    expect(source).toContain('rpc("nvx_get_runtime_secret", { p_name: "HUBSPOT_ACCESS_TOKEN" })');
    expect(source).toContain('throw new ValidationError("Runtime bootstrap required", 503)');
    expect(source).toContain('await hmacHex(token, `${timestampRaw}.${rawBody}`)');
    expect(source).not.toContain("NUVANX_LEAD_CAPTURE_SECRET");
  });

  it("requires UUID v4 lineage and the canonical HubSpot form", () => {
    expect(source).toContain("function uuidV4");
    expect(source).toContain('throw new ValidationError("Valid nvx_lead_id is required")');
    expect(source).toContain('const CANONICAL_FORM_ID = "5042522a-0bc5-4381-ac3e-5aee8649b69c"');
    expect(source).toContain('throw new ValidationError("Unsupported form_id")');
  });

  it("keeps QA identity deterministic", () => {
    expect(source).toContain("nvx_is_test_lead");
    expect(source).toContain('testRunId.startsWith("staging2-")');
    expect(source).toContain('throw new ValidationError("Production lead cannot carry test_run_id")');
  });

  it("stores only allowlisted non-clinical attribution", () => {
    const attrStart = source.indexOf("const ATTR_KEYS");
    const triggerStart = source.indexOf("function triggerReconciliation");
    const contract = source.slice(attrStart, triggerStart);
    expect(contract).not.toMatch(/treatment|condition|procedure|diagnosis|body_area/i);
    expect(contract).toMatch(/gclid/);
    expect(contract).toMatch(/utm_source/);
    expect(contract).toMatch(/landing_url/);
  });

  it("is idempotent by nvx_lead_id and wakes only the governed reconciliation worker", () => {
    expect(source).toContain('.upsert(row, { onConflict: "nvx_lead_id" })');
    expect(source).toContain("/functions/v1/web-lead-reconcile");
    expect(source).toContain('Authorization: `Bearer ${SERVICE_ROLE}`');
    expect(source).not.toMatch(/graph\.facebook\.com|functions\/v1\/web-events|googleads\.|crm\/v3\/objects\/deals/i);
  });

  it("keeps downstream trigger asynchronous after durable capture", () => {
    const upsert = source.indexOf('.upsert(row, { onConflict: "nvx_lead_id" })');
    const trigger = source.indexOf("triggerReconciliation();", upsert);
    expect(upsert).toBeGreaterThan(-1);
    expect(trigger).toBeGreaterThan(upsert);
    expect(source).toContain("EdgeRuntime.waitUntil(request)");
  });
});
