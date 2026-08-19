import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");

describe("lead-captured canonical contract", () => {
  it("requires a dedicated runtime secret and fails closed", () => {
    expect(source).toContain('Deno.env.get("NUVANX_LEAD_CAPTURE_SECRET") || ""');
    expect(source).toContain("if (!SHARED_SECRET || !SUPABASE_URL || !SERVICE_ROLE)");
    expect(source).not.toMatch(/NUVANX_LEAD_CAPTURE_SECRET[^\n]+\|\|\s*["'][^"']{16,}["']/);
  });

  it("requires UUID v4 lineage and the canonical HubSpot form", () => {
    expect(source).toContain("function uuidV4");
    expect(source).toContain('throw new ValidationError("Valid nvx_lead_id is required")');
    expect(source).toContain('const CANONICAL_FORM_ID = "5042522a-0bc5-4381-ac3e-5aee8649b69c"');
    expect(source).toContain('throw new ValidationError("Unsupported form_id")');
  });

  it("keeps QA identity server-oriented and deterministic", () => {
    expect(source).toContain("nvx_is_test_lead");
    expect(source).toContain('testRunId.startsWith("staging2-")');
    expect(source).toContain('throw new ValidationError("Production lead cannot carry test_run_id")');
  });

  it("persists explicit marketing consent with a fail-closed missing-value path", () => {
    expect(source).toContain("const marketingConsent = booleanValue((body as any).marketing_consent)");
    expect(source).toContain("marketing_consent: marketingConsent");
    expect(source).toContain("Missing/legacy senders are deliberately fail-closed as false");
    expect(source).toContain("metadata: { schema_version: 2 }");
  });

  it("stores only allowlisted non-clinical attribution", () => {
    const attrStart = source.indexOf("const ATTR_KEYS");
    const handlerStart = source.indexOf("Deno.serve");
    const contract = source.slice(attrStart, handlerStart);
    expect(contract).not.toMatch(/treatment|condition|procedure|diagnosis|body_area/i);
    expect(contract).toMatch(/gclid/);
    expect(contract).toMatch(/utm_source/);
    expect(contract).toMatch(/landing_url/);
  });

  it("is idempotent by nvx_lead_id and contains no downstream execution endpoint", () => {
    expect(source).toContain('.upsert(row, { onConflict: "nvx_lead_id" })');
    expect(source).not.toMatch(/graph\.facebook\.com|functions\/v1\/web-events|googleads\.|crm\/v3\/objects\/deals/i);
  });
});
