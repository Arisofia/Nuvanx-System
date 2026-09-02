import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { HealthFailure, parseServiceAccount } from "./parse-service-account.ts";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
const provisionScript = readFileSync(
  fileURLToPath(new URL("../../../scripts/provision-google-ads-developer-token.js", import.meta.url)),
  "utf8",
);
const deployWorkflow = readFileSync(
  fileURLToPath(new URL("../../../.github/workflows/deploy-standalone-edge-functions.yml", import.meta.url)),
  "utf8",
);
const credentialWorkflow = readFileSync(
  fileURLToPath(new URL("../../../.github/workflows/google-ads-credential-provision.yml", import.meta.url)),
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
    expect(source).toContain('const LOCAL_CONVERSION_ACTION_ID = "7717850116"');
    expect(source).toContain("conversion_action.primary_for_goal");
    expect(source).toContain('new HealthFailure("validation", 424, "Canonical Google Ads conversion action missing")');
    expect(source).toContain('new HealthFailure("validation", 424, "Canonical Google Ads conversion is not primary_for_goal")');
    expect(source).toContain('String(conversion.status || "").toUpperCase() !== "ENABLED"');
    expect(source).not.toContain("conversion_action.include_in_conversions_metric");
  });

  it("bounds request bodies and provider pagination", () => {
    expect(source).toContain("const MAX_BODY_BYTES = 8192");
    expect(source).toContain("new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES");
    expect(source).toContain("const MAX_PROVIDER_PAGES = 20");
    expect(source).toContain("const MAX_PROVIDER_ROWS = 10_000");
    expect(source).toContain("const seenPageTokens = new Set<string>()");
    expect(source).toContain("Google Ads repeated a pagination token");
  });

  it("requires exactly one selector and keeps non-id health selectors connected-only", () => {
    expect(source).toContain('["integration_id", cleanSelector(body.integration_id)]');
    expect(source).toContain('["user_id", cleanSelector(body.user_id)]');
    expect(source).toContain('["clinic_id", cleanSelector(body.clinic_id)]');
    expect(source).toContain("Exactly one of integration_id, user_id or clinic_id is required");
    expect(source).toContain("Google Ads integration selector did not resolve exactly one eligible integration");
    expect(source).not.toContain('.order("updated_at", { ascending: false })');
    expect(source).toContain('if (selectorKey === "integration_id") {\n      integrationQuery = integrationQuery.eq("id", selectorValue);\n    } else {\n      integrationQuery = integrationQuery.eq("status", "connected");');
  });

  it("supports exact-id provisioning without requiring a decryptable stored credential", () => {
    expect(source).toContain('const operation = cleanSelector(body.operation) || "health"');
    expect(source).toContain('operation === "provision" && selectors[0][0] !== "integration_id"');
    expect(source).toContain('developerToken = validateDeveloperToken(body.developer_token)');
    const provisionBranch = source.indexOf('if (operation === "provision") {\n      developerToken = validateDeveloperToken(body.developer_token);');
    const storedLookup = source.indexOf('.from("credentials")', provisionBranch);
    expect(provisionBranch).toBeGreaterThan(-1);
    expect(storedLookup).toBeGreaterThan(provisionBranch);
  });

  it("does not send pageSize to Google Ads Search API", () => {
    expect(source).toContain("const requestBody: Record<string, unknown> = { query };");
    expect(source).not.toMatch(/pageSize/);
  });

  it("classifies local, OAuth, provider and validation failures separately", () => {
    expect(source).toContain('type FailureKind = "request" | "configuration" | "oauth" | "provider" | "validation" | "persistence"');
    expect(source).toContain('new HealthFailure("oauth", 424');
    expect(source).toContain('"provider",\n    502');
    expect(source).toContain('new HealthFailure("configuration", 500');
    expect(source).toContain('new HealthFailure("validation", 424');
  });

  it("proves provider identity before runtime encryption and credential overwrite", () => {
    const providerRead = source.indexOf("const [customerRows, campaignRows, performanceRows, conversionRows]");
    const conversionGate = source.indexOf('Canonical Google Ads conversion is not enabled');
    const encryptIndex = source.indexOf('const encryptedKey = await encryptCredential(developerToken)');
    const upsertIndex = source.indexOf('.upsert({', encryptIndex);
    const connectedIndex = source.indexOf('status: "connected"', upsertIndex);
    const successIndex = source.indexOf("return reply(200", connectedIndex);
    expect(providerRead).toBeGreaterThan(-1);
    expect(conversionGate).toBeGreaterThan(providerRead);
    expect(encryptIndex).toBeGreaterThan(conversionGate);
    expect(upsertIndex).toBeGreaterThan(encryptIndex);
    expect(connectedIndex).toBeGreaterThan(upsertIndex);
    expect(successIndex).toBeGreaterThan(connectedIndex);
  });

  it("makes the Edge runtime the sole Google Ads cryptographic owner", () => {
    expect(source).toContain('const ENCRYPTION_KEY = (Deno.env.get("ENCRYPTION_KEY") || "").trim()');
    expect(source).toContain('async function encryptCredential(secret: string)');
    expect(source).toContain('provisioned_by: "google_ads_health_runtime"');
    expect(provisionScript).not.toContain("ENCRYPTION_KEY");
    expect(provisionScript).not.toContain("encryptCredential");
    expect(provisionScript).not.toContain("/rest/v1/credentials");
    expect(provisionScript).toContain("operation: 'provision'");
  });

  it("has one governed automatic post-deploy provisioning owner", () => {
    expect(deployWorkflow).toContain("Reverify remote main immediately before Production mutation");
    expect(deployWorkflow).toContain("Provision Google Ads credential through deployed runtime");
    expect(deployWorkflow).toContain("steps.post_deploy_guard.outputs.provision == 'true'");
    expect(deployWorkflow).toContain('supabase functions deploy google-ads-health --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
    expect(credentialWorkflow).toContain("workflow_dispatch:");
    expect(credentialWorkflow).not.toContain("push:");
    expect(credentialWorkflow).not.toContain("ENCRYPTION_KEY");
  });

  it("normalizes service account representations via parseServiceAccount", () => {
    expect(source).toContain("parseServiceAccount(SERVICE_ACCOUNT_RAW)");

    const expected = {
      client_email: "test-sa@project-123.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQD...\n-----END PRIVATE KEY-----\n",
    };
    const json = JSON.stringify(expected);

    expect(parseServiceAccount(json)).toEqual(expected);
    expect(parseServiceAccount(`'${json}'`)).toEqual(expected);
    expect(parseServiceAccount(`"${json.replaceAll('"', '\\"')}"`)).toEqual(expected);
    expect(parseServiceAccount(`GOOGLE_ADS_SERVICE_ACCOUNT=${json}`)).toEqual(expected);

    const b64 = Buffer.from(json).toString("base64");
    expect(parseServiceAccount(b64)).toEqual(expected);
    expect(parseServiceAccount(`base64:${b64}`)).toEqual(expected);
    expect(parseServiceAccount(`b64:${b64}`)).toEqual(expected);
    expect(parseServiceAccount(json.replaceAll('"', '\\"'))).toEqual(expected);
    expect(parseServiceAccount(JSON.stringify(json))).toEqual(expected);

    expect(() => parseServiceAccount("")).toThrowError(HealthFailure);
    expect(() => parseServiceAccount("")).toThrow("Google Ads service account not configured");
    expect(() => parseServiceAccount("not-valid-json")).toThrowError(HealthFailure);
    expect(() => parseServiceAccount("not-valid-json")).toThrow("Google Ads service account is malformed");
    expect(() => parseServiceAccount(JSON.stringify({ client_email: "missing_private_key" }))).toThrowError(
      HealthFailure,
    );
    expect(() => parseServiceAccount(JSON.stringify({ client_email: "missing_private_key" }))).toThrow(
      "Google Ads service account is malformed",
    );
  });
});
