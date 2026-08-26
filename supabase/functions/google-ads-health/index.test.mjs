import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");

describe("Google Ads provider health contract", () => {
  it("uses a currently supported Google Ads API version and never v17", () => {
    expect(source).toContain('const API_VERSION = "v25"');
    expect(source).toContain('https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}/googleAds:search');
    expect(source).toContain('api_version: API_VERSION');
    expect(source).not.toContain("googleads.googleapis.com/v17");
  });

  it("is internal-only and does not use public JWT auth as its trust boundary", () => {
    expect(source).toContain('Deno.env.get("REVOPS_INTERNAL_SECRET")');
    expect(source).toContain('req.headers.get("x-nvx-internal-secret")');
    expect(source).toContain('secretMatches(receivedSecret, INTERNAL_SECRET)');
    expect(source).toContain('message: "Forbidden"');
  });

  it("reads Google Ads with adwords scope and never mutates provider resources", () => {
    expect(source).toContain('scope: "https://www.googleapis.com/auth/adwords"');
    expect(source).toContain("googleAds:search");
    expect(source).not.toMatch(/googleAds:mutate|mutateCampaigns|mutateConversionActions/);
  });

  it("validates the canonical conversion with primary_for_goal", () => {
    expect(source).toContain('const CANONICAL_CONVERSION_ACTION_ID = "7713427085"');
    expect(source).toContain("conversion_action.primary_for_goal");
    expect(source).not.toContain("conversion_action.include_in_conversions_metric");
  });

  it("persists provider proof only after the GAQL reads succeed", () => {
    const readIndex = source.indexOf("const [customerRows, campaignRows, performanceRows, conversionRows]");
    const usedIndex = source.indexOf('update({ last_used: now })');
    const syncIndex = source.indexOf('update({ last_sync: now, last_error: null, updated_at: now })');
    expect(readIndex).toBeGreaterThan(-1);
    expect(usedIndex).toBeGreaterThan(readIndex);
    expect(syncIndex).toBeGreaterThan(readIndex);
  });
});
