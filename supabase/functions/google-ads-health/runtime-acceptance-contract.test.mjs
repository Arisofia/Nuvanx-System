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
const provenanceQualifier = readFileSync(
  fileURLToPath(new URL("../../../scripts/qualify-governed-edge-deployment.py", import.meta.url)),
  "utf8",
);
const healthSource = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
const edgePreflightSource = readFileSync(
  fileURLToPath(new URL("../google-ads-auth-preflight/index.ts", import.meta.url)),
  "utf8",
);
const coreApiSource = readFileSync(
  fileURLToPath(new URL("../api/index.ts", import.meta.url)),
  "utf8",
);
const dataManagerSource = readFileSync(
  fileURLToPath(new URL("../google-data-manager-export/index.ts", import.meta.url)),
  "utf8",
);
const runtimePreflightScript = readFileSync(
  fileURLToPath(new URL("../../../scripts/preflight-google-ads-runtime.js", import.meta.url)),
  "utf8",
);
const convergenceScript = readFileSync(
  fileURLToPath(new URL("../../../scripts/converge-google-ads-edge-auth.js", import.meta.url)),
  "utf8",
);
const authSource = readFileSync(fileURLToPath(new URL("../_shared/google-ads-auth.ts", import.meta.url)), "utf8");

describe("Google Ads runtime acceptance orchestration", () => {
  it("keeps skipped-deploy handling and provenance decisions in a versioned executable qualifier", () => {
    expect(workflow).toContain("Qualify trusted upstream envelope");
    expect(workflow).toContain("python3 -m py_compile scripts/qualify-governed-edge-deployment.py");
    expect(workflow).toContain("python3 scripts/qualify-governed-edge-deployment.py");
    expect(workflow).not.toContain("python3 - <<'PY'");
    expect(provenanceQualifier).toContain('upstream_conclusion == "skipped"');
    expect(provenanceQualifier).toContain("not_applicable = True");
    expect(provenanceQualifier).toContain("no Production Edge mutation occurred");
    expect(provenanceQualifier.indexOf('upstream_event != "workflow_run"')).toBeLessThan(
      provenanceQualifier.indexOf('upstream_conclusion == "skipped"'),
    );
    expect(provenanceQualifier.indexOf('upstream_branch != "main"')).toBeLessThan(
      provenanceQualifier.indexOf('upstream_conclusion == "skipped"'),
    );
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

  it("declares service-account as the governed Production identity instead of inferring from partial OAuth", () => {
    expect(deployWorkflow).toContain("GOOGLE_ADS_AUTH_MODE: service_account");
    expect(deployWorkflow).toContain('[[ "$GOOGLE_ADS_AUTH_MODE" == "service_account" ]]');
    expect(deployWorkflow).toContain("GOOGLE_ADS_SERVICE_ACCOUNT: ${{ secrets.GOOGLE_ADS_SERVICE_ACCOUNT }}");
    expect(deployWorkflow).toContain("GOOGLE_ADS_CLIENT_ID: ${{ secrets.GOOGLE_ADS_CLIENT_ID }}");
    expect(deployWorkflow).toContain("GOOGLE_ADS_CLIENT_SECRET: ${{ secrets.GOOGLE_ADS_CLIENT_SECRET }}");
    expect(deployWorkflow).toContain("GOOGLE_ADS_REFRESH_TOKEN: ${{ secrets.GOOGLE_ADS_REFRESH_TOKEN }}");
    expect(deployWorkflow).toContain("node scripts/converge-google-ads-edge-auth.js --validate-only");
    expect(deployWorkflow).toContain("node scripts/converge-google-ads-edge-auth.js");
    expect(deployWorkflow).not.toContain("GOOGLE_ADS_DEVELOPER_TOKEN");

    expect(convergenceScript).toContain("clean(env[AUTH_MODE_KEY]) || 'service_account'");
    expect(convergenceScript).toContain("`${AUTH_MODE_KEY}=service_account`");
    expect(convergenceScript).toContain("required: new Set([AUTH_MODE_KEY, SERVICE_ACCOUNT_KEY])");
    expect(convergenceScript).not.toContain("secrets', 'unset'");
    expect(convergenceScript).toContain("verifySecretShape(after, identity)");
    expect(convergenceScript).not.toContain("GOOGLE_ADS_DEVELOPER_TOKEN");

    const secretConvergence = deployWorkflow.indexOf("node scripts/converge-google-ads-edge-auth.js\n");
    const preflightDeploy = deployWorkflow.indexOf("supabase functions deploy google-ads-auth-preflight");
    expect(secretConvergence).toBeGreaterThan(-1);
    expect(preflightDeploy).toBeGreaterThan(secretConvergence);
  });

  it("isolates Ads principal selection without deleting shared OAuth used by Data Manager", () => {
    expect(coreApiSource).toContain("Deno.env.get('GOOGLE_ADS_SERVICE_ACCOUNT')");
    expect(dataManagerSource).toContain('Deno.env.get("GOOGLE_ADS_CLIENT_ID")');
    expect(dataManagerSource).toContain('Deno.env.get("GOOGLE_ADS_CLIENT_SECRET")');
    expect(dataManagerSource).toContain('Deno.env.get("GOOGLE_ADS_REFRESH_TOKEN")');
    expect(convergenceScript).not.toContain("oauth_refresh_cleanup");
    expect(authSource).toContain('Deno.env.get("GOOGLE_ADS_AUTH_MODE")');
    expect(authSource).toContain('requestedMode === "service_account"');
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
