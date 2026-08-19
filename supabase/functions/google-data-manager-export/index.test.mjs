import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");

describe("Google Data Manager exporter contract", () => {
  it("uses the v1 event ingestion and request-status APIs", () => {
    expect(source).toContain('const INGEST_URL = "https://datamanager.googleapis.com/v1/events:ingest"');
    expect(source).toContain('const STATUS_URL = "https://datamanager.googleapis.com/v1/requestStatus:retrieve"');
    expect(source).toContain('const DATA_MANAGER_SCOPE = "https://www.googleapis.com/auth/datamanager"');
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
