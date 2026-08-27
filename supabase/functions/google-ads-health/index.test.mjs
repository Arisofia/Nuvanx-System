import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
const deployWorkflow = readFileSync(
  fileURLToPath(new URL("../../../.github/workflows/deploy-standalone-edge-functions.yml", import.meta.url)),
  "utf8",
);

describe("Google Ads provider health contract", () => {
  it("uses a currently supported Google Ads API version and never v17", () => {
    expect(source).toContain('const API_VERSION = "v25"');
    expect(source).toContain('https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}/googleAds:search');
    expect(source).toContain('api_version: API_VERSION');
    expect(source).not.toContain("googleads.googleapis.com/v17");
  });

  it("uses the canonical Vault-backed internal-secret trust boundary", () => {
    expect(source).toContain('admin.rpc("nvx_get_runtime_secret"');
    expect(source).toContain('p_name: "REVOPS_INTERNAL_SECRET"');
    expect(source).toContain('req.headers.get("x-nvx-internal-secret")');
    expect(source).toContain('secretMatches(receivedSecret, String(expectedSecret))');
    expect(source).toContain('message: "Forbidden"');
    expect(source).not.toContain('Deno.env.get("REVOPS_INTERNAL_SECRET")');
  });

  it("reads Google Ads with adwords scope and never mutates provider resources", () => {
    expect(source).toContain('scope: "https://www.googleapis.com/auth/adwords"');
    expect(source).toContain("googleAds:search");
    expect(source).not.toMatch(/googleAds:mutate|mutateCampaigns|mutateConversionActions/);
  });

  it("fails closed unless the canonical conversion exists, is enabled, and is primary for goal", () => {
    expect(source).toContain('const CANONICAL_CONVERSION_ACTION_ID = "7713427085"');
    expect(source).toContain("conversion_action.primary_for_goal");
    expect(source).toContain('if (conversionRows.length !== 1) throw new Error("Canonical Google Ads conversion action missing")');
    expect(source).toContain('if (conversion.primaryForGoal !== true) throw new Error("Canonical Google Ads conversion is not primary_for_goal")');
    expect(source).toContain('String(conversion.status || "").toUpperCase() !== "ENABLED"');
    expect(source).not.toContain("conversion_action.include_in_conversions_metric");
  });

  it("returns success only after both provider-proof timestamps persist", () => {
    const readIndex = source.indexOf("const [customerRows, campaignRows, performanceRows, conversionRows]");
    const usedIndex = source.indexOf('update({ last_used: now })');
    const syncIndex = source.indexOf('update({ last_sync: now, last_error: null, updated_at: now })');
    const persistenceGate = source.indexOf("if (credentialUpdate.error || integrationUpdate.error)");
    const successIndex = source.indexOf("return reply(200");
    expect(readIndex).toBeGreaterThan(-1);
    expect(usedIndex).toBeGreaterThan(readIndex);
    expect(syncIndex).toBeGreaterThan(readIndex);
    expect(persistenceGate).toBeGreaterThan(syncIndex);
    expect(successIndex).toBeGreaterThan(persistenceGate);
  });

  it("has one governed automatic deployment owner with gateway JWT disabled", () => {
    expect(deployWorkflow).toContain("supabase/functions/google-ads-health/index.ts");
    expect(deployWorkflow).toContain(
      'supabase functions deploy google-ads-health --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt',
    );
  });
});
