import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");

describe("Google Data Manager exporter contract", () => {
  it("requires the exact Supabase service-role credential before outbox access", () => {
    expect(source).toContain("async function requireServiceRole");
    expect(source).toContain("secretMatches(match[1], SERVICE_ROLE)");
    expect(source).toContain('message: "Forbidden"');
    const guard = source.indexOf("await requireServiceRole(req)");
    const outbox = source.indexOf('from("google_data_manager_outbox")', guard);
    expect(guard).toBeGreaterThan(-1);
    expect(outbox).toBeGreaterThan(guard);
  });

  it("uses the v1 event ingestion and request-status APIs", () => {
    expect(source).toContain('const INGEST_URL = "https://datamanager.googleapis.com/v1/events:ingest"');
    expect(source).toContain('const STATUS_URL = "https://datamanager.googleapis.com/v1/requestStatus:retrieve"');
    expect(source).toContain('const DATA_MANAGER_SCOPE = "https://www.googleapis.com/auth/datamanager"');
  });

  it("supports a non-mutating auth_check that validates scope without putting the token in a URL", () => {
    expect(source).toContain('requestedMode === "poll" || requestedMode === "auth_check"');
    expect(source).toContain('if (mode === "auth_check")');
    expect(source).toContain('fetch("https://oauth2.googleapis.com/tokeninfo", {');
    expect(source).toContain('method: "POST"');
    expect(source).toContain('body: new URLSearchParams({ access_token: token }).toString()');
    expect(source).not.toContain('tokeninfo?access_token=');
    expect(source).toContain('scopes.includes(DATA_MANAGER_SCOPE)');
    expect(source).toContain('auth_ready: true');
    expect(source).toContain('scope_ok: auth.scopeOk');
    const authBranch = source.indexOf('if (mode === "auth_check")');
    const firstOutboxRead = source.indexOf('from("google_data_manager_outbox")', authBranch);
    const authReturn = source.indexOf('auth_ready: true', authBranch);
    expect(authReturn).toBeGreaterThan(authBranch);
    expect(firstOutboxRead).toBeGreaterThan(authReturn);
  });

  it("never sends QA rows", () => {
    const qaGuard = source.indexOf("if (row.is_test_lead === true)");
    const ingest = source.indexOf("fetch(INGEST_URL", qaGuard);
    expect(qaGuard).toBeGreaterThan(-1);
    expect(ingest).toBeGreaterThan(qaGuard);
    expect(source).toContain('delivery_status: "suppressed"');
  });

  it("maps click identifiers and hashed user identifiers using HEX encoding", () => {
    expect(source).toContain("if (row.gclid) result.gclid");
    expect(source).toContain("if (row.gbraid) result.gbraid");
    expect(source).toContain("if (row.wbraid) result.wbraid");
    expect(source).toContain("emailAddress");
    expect(source).toContain("phoneNumber");
    expect(source).toContain('payload.encoding = "HEX"');
  });

  it("uses an operating Google Ads account and a conversion-action destination", () => {
    expect(source).toContain('accountType: "GOOGLE_ADS"');
    expect(source).toContain("operatingAccount");
    expect(source).toContain("productDestinationId: actionId");
    expect(source).toContain('destinationReferences: ["google_ads_conversion"]');
  });

  it("does not mark an accepted ingestion as finally delivered until requestStatus SUCCESS", () => {
    const accepted = source.indexOf('delivery_status: "sent"');
    const delivered = source.indexOf("delivered_at: new Date().toISOString()", accepted);
    const successCheck = source.indexOf('status === "SUCCESS"');
    expect(accepted).toBeGreaterThan(-1);
    expect(successCheck).toBeGreaterThan(accepted);
    expect(delivered).toBeGreaterThan(successCheck);
  });

  it("fails closed when OAuth or conversion-action configuration is missing", () => {
    expect(source).toContain("Data Manager OAuth configuration missing");
    expect(source).toContain('delivery_status: "configuration_required"');
    expect(source).toContain("Conversion action not configured");
  });
});
