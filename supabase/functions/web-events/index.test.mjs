import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");

describe("web-events P0 contract", () => {
  it("requires the Supabase service-role bearer token and no bespoke relay secret", () => {
    expect(source).toContain('Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")');
    expect(source).toContain("async function requireServiceRole");
    expect(source).toContain('req.headers.get("authorization")');
    expect(source).toContain("constantTimeMatch(token, SUPABASE_SERVICE_ROLE_KEY)");
    expect(source).not.toContain("NUVANX_WEB_EVENT_SECRET");
    expect(source).not.toContain("NUVANX_LEAD_CAPTURE_SECRET");
    expect(source).not.toContain("x-nvx-web-event-secret");
  });

  it("requires clinic tenant context and scopes both integration and credential lookup", () => {
    const resolvedOwnerStart = source.indexOf('let rows: any[] = []');
    const credentialStart = source.indexOf('const { data: cred } = await admin', resolvedOwnerStart);
    const resolvedOwnerQuery = source.slice(resolvedOwnerStart, credentialStart);
    const credentialEnd = source.indexOf('if (!cred?.encrypted_key)', credentialStart);
    const credentialQuery = source.slice(credentialStart, credentialEnd);

    expect(source).toContain("function sanitizeClinicId");
    expect(source).toContain('throw new RequestValidationError("Valid clinic_id is required")');
    expect(source).toContain("const clinicId = sanitizeClinicId(body.clinic_id || body.clinicId)");
    expect(source).toContain("resolveOwnerAndMeta(admin, clinicId)");

    expect(resolvedOwnerStart).toBeGreaterThan(-1);
    expect(resolvedOwnerQuery).toContain('.eq("clinic_id", clinicId)');
    expect(resolvedOwnerQuery).toContain('.in("service", ["meta_ads", "meta"])');
    expect(resolvedOwnerQuery).toContain('.eq("status", "connected")');
    expect(source).toContain('row?.service === "meta_ads" && metadata?.canonical === true');
    expect(source).toContain('const service = integration.service === "meta_ads" ? "meta_ads" : "meta"');
    expect(source).toContain('throw new Error("Connected Meta integration not found for clinic")');

    expect(credentialQuery).toContain('.eq("user_id", userId)');
    expect(credentialQuery).toContain('.eq("clinic_id", clinicId)');
    expect(credentialQuery).toContain('.eq("service", service)');
    expect(source).toContain('throw new Error("Meta credential not found for clinic")');
  });

  it("suppresses QA before tenant or Meta resolution", () => {
    expect(source).toContain("function isTestLead");
    expect(source).toContain('reason: "qa_lead"');
    const qaGuard = source.indexOf("if (isTestLead(body))");
    const tenantResolution = source.indexOf("sanitizeClinicId(body.clinic_id || body.clinicId)");
    const metaResolution = source.indexOf("resolveOwnerAndMeta(admin, clinicId)");
    expect(qaGuard).toBeGreaterThan(-1);
    expect(tenantResolution).toBeGreaterThan(qaGuard);
    expect(metaResolution).toBeGreaterThan(tenantResolution);
  });

  it("does not propagate treatment or page-level clinical semantics", () => {
    const customDataStart = source.indexOf("function safeCustomData()");
    const sendStart = source.indexOf("async function sendMetaCapi");
    const customData = source.slice(customDataStart, sendStart);
    expect(customData).not.toMatch(/treatment|condition|procedure|diagnosis|body_area/i);
    expect(customData).not.toMatch(/page_url|page_title|click_target|event_type/i);
    expect(source).toContain('const CANONICAL_EVENT_SOURCE_URL = "https://nuvanx.com/"');
    expect(source).not.toContain("body.event_source_url");
    expect(source).not.toContain("body.page_url");
  });

  it("requires a caller-owned event_id and never creates a random fallback", () => {
    expect(source).toContain("function sanitizeEventId");
    expect(source).toContain('throw new RequestValidationError("Valid event_id is required")');
    expect(source).not.toMatch(/eventId\s*=.*crypto\.randomUUID/);
  });

  it("maps caller contract violations to 4xx while keeping internal failures generic", () => {
    expect(source).toContain("class RequestValidationError extends Error");
    expect(source).toContain("constructor(message: string, status = 422)");
    expect(source).toContain('throw new RequestValidationError("Unsupported event_name")');
    expect(source).toContain('throw new RequestValidationError("Valid event_id is required")');
    expect(source).toContain('throw new RequestValidationError("Valid clinic_id is required")');
    expect(source).toContain('throw new RequestValidationError("No user_data available for CAPI event")');
    expect(source).toContain("const status = error instanceof RequestValidationError ? error.status : 500");
    expect(source).toContain('const message = status >= 500 ? "Internal error"');
  });

  it("does not allow the request body to select Meta test mode", () => {
    expect(source).toContain('Deno.env.get("META_TEST_EVENT_CODE")');
    expect(source).not.toContain("body.test_event_code");
    expect(source).not.toContain("body._meta?.test_event_code");
  });
});
