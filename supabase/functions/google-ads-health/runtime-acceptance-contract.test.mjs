import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const workflow = readFileSync(
  fileURLToPath(new URL("../../../.github/workflows/google-ads-runtime-acceptance.yml", import.meta.url)),
  "utf8",
);
const deployWorkflow = readFileSync(
  fileURLToPath(new URL("../../../.github/workflows/deploy-standalone-edge-functions.yml", import.meta.url)),
  "utf8",
);
const healthSource = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
const edgePreflightSource = readFileSync(
  fileURLToPath(new URL("../google-ads-auth-preflight/index.ts", import.meta.url)),
  "utf8",
);
const runtimePreflightScript = readFileSync(
  fileURLToPath(new URL("../../../scripts/preflight-google-ads-runtime.js", import.meta.url)),
  "utf8",
);
const authSource = readFileSync(fileURLToPath(new URL("../_shared/google-ads-auth.ts", import.meta.url)), "utf8");

describe("Google Ads runtime acceptance orchestration", () => {
  it("treats an expected skipped deploy as not-applicable instead of a false runtime failure", () => {
    expect(workflow).toContain("job.get('conclusion') == 'skipped'");
    expect(workflow).toContain("not_applicable = True");
    expect(workflow).toContain("no Production Edge mutation occurred and runtime acceptance is not applicable");
    expect(workflow).toContain("if not_applicable:\n              print(reason)\n              sys.exit(0)");
    expect(workflow).toContain("if not accept:\n              print(f\"::error::{reason}\")\n              sys.exit(1)");
  });

  it("proves provider auth inside the deployed Edge control plane before credential convergence", () => {
    const preflight = workflow.indexOf("Preflight Google Ads authentication inside deployed Edge runtime");
    const mutationGuard = workflow.indexOf("Reverify remote main immediately before Google Ads acceptance");
    const provision = workflow.indexOf("Converge and accept Google Ads credential through deployed runtime");
    expect(preflight).toBeGreaterThan(-1);
    expect(mutationGuard).toBeGreaterThan(preflight);
    expect(provision).toBeGreaterThan(mutationGuard);
    expect(workflow).toContain("node scripts/preflight-google-ads-runtime.js");
    expect(workflow).not.toContain("node scripts/google-ads-auth-preflight.js");
    expect(workflow).not.toContain("GOOGLE_ADS_CLIENT_ID: ${{ secrets.GOOGLE_ADS_CLIENT_ID }}");
    expect(workflow).not.toContain("GOOGLE_ADS_CLIENT_SECRET: ${{ secrets.GOOGLE_ADS_CLIENT_SECRET }}");
    expect(workflow).not.toContain("GOOGLE_ADS_REFRESH_TOKEN: ${{ secrets.GOOGLE_ADS_REFRESH_TOKEN }}");
    expect(workflow).not.toContain("GOOGLE_ADS_SERVICE_ACCOUNT: ${{ secrets.GOOGLE_ADS_SERVICE_ACCOUNT }}");
    expect(runtimePreflightScript).toContain("/functions/v1/google-ads-auth-preflight");
    expect(runtimePreflightScript).toContain("persistence_performed !== false");
    expect(runtimePreflightScript).toContain("developer_token: token");
  });

  it("converges exactly one complete Google Ads identity into Edge before governed function deployment", () => {
    expect(deployWorkflow).toContain("GOOGLE_ADS_SERVICE_ACCOUNT: ${{ secrets.GOOGLE_ADS_SERVICE_ACCOUNT }}");
    expect(deployWorkflow).toContain("GOOGLE_ADS_CLIENT_ID: ${{ secrets.GOOGLE_ADS_CLIENT_ID }}");
    expect(deployWorkflow).toContain("GOOGLE_ADS_CLIENT_SECRET: ${{ secrets.GOOGLE_ADS_CLIENT_SECRET }}");
    expect(deployWorkflow).toContain("GOOGLE_ADS_REFRESH_TOKEN: ${{ secrets.GOOGLE_ADS_REFRESH_TOKEN }}");
    expect(deployWorkflow).toContain("oauth_count > 0 && oauth_count < 3");
    expect(deployWorkflow).toContain("Google Ads OAuth refresh identity is partial in GitHub Production");
    expect(deployWorkflow).toContain("No complete Google Ads runtime identity is configured in GitHub Production");
    expect(deployWorkflow).toContain("supabase secrets unset GOOGLE_ADS_SERVICE_ACCOUNT");
    expect(deployWorkflow).toContain("supabase secrets unset \\\n                GOOGLE_ADS_CLIENT_ID \\\n                GOOGLE_ADS_CLIENT_SECRET \\\n                GOOGLE_ADS_REFRESH_TOKEN");
    expect(deployWorkflow).toContain('GOOGLE_ADS_REFRESH_TOKEN="$GOOGLE_ADS_REFRESH_TOKEN"');
    expect(deployWorkflow).not.toContain("GOOGLE_ADS_DEVELOPER_TOKEN");

    const secretConvergence = deployWorkflow.indexOf('GOOGLE_ADS_REFRESH_TOKEN="$GOOGLE_ADS_REFRESH_TOKEN"');
    const preflightDeploy = deployWorkflow.indexOf("supabase functions deploy google-ads-auth-preflight");
    expect(secretConvergence).toBeGreaterThan(-1);
    expect(preflightDeploy).toBeGreaterThan(secretConvergence);
  });

  it("deploys the read-only auth preflight in the same governed Edge release as health and daily sync", () => {
    expect(deployWorkflow).toContain("supabase/functions/google-ads-auth-preflight/index.ts");
    expect(deployWorkflow).toContain("supabase functions deploy google-ads-auth-preflight");
    expect(deployWorkflow).toContain("supabase functions deploy google-ads-health");
    expect(deployWorkflow).toContain("supabase functions deploy google-ads-daily-sync");
  });

  it("keeps Edge runtime preflight read-only while using the same auth resolver", () => {
    expect(edgePreflightSource).toContain('resolveGoogleAdsAuth({');
    expect(edgePreflightSource).toContain('auth_mode: googleAuth.mode');
    expect(edgePreflightSource).toContain('persistence_performed: false');
    expect(edgePreflightSource).not.toContain('.update(');
    expect(edgePreflightSource).not.toContain('.upsert(');
    expect(edgePreflightSource).not.toContain('nvx_commit_google_ads_credential_provision');
    expect(edgePreflightSource).toContain('TARGET_CUSTOMER_IDS = ["9084540447", "8201489748"]');
  });

  it("keeps health runtime auth selection fail-closed and observable", () => {
    expect(healthSource).toContain("const googleAuth = await resolveGoogleAdsAuth({");
    expect(healthSource).toContain("auth_mode: googleAuth.mode");
    expect(authSource).toContain('refreshState === "partial"');
    expect(authSource).toContain("Google Ads OAuth refresh configuration is incomplete");
    expect(authSource).toContain('mode: "oauth_refresh"');
    expect(authSource).toContain('mode: "service_account"');
    expect(authSource).toContain('redirect: "error"');
  });
});
