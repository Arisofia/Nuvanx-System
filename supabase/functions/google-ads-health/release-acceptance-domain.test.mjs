import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const deployWorkflow = readFileSync(
  fileURLToPath(new URL("../../../.github/workflows/deploy-standalone-edge-functions.yml", import.meta.url)),
  "utf8",
);
const googleAdsAcceptanceWorkflow = readFileSync(
  fileURLToPath(new URL("../../../.github/workflows/google-ads-runtime-acceptance.yml", import.meta.url)),
  "utf8",
);
const provenanceQualifier = readFileSync(
  fileURLToPath(new URL("../../../scripts/qualify-governed-edge-deployment.py", import.meta.url)),
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
const packageJson = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../package.json", import.meta.url)), "utf8"),
);

describe("Production release acceptance domains", () => {
  it("keeps governed Edge deployment exact-SHA and free of Google Ads provider acceptance", () => {
    expect(deployWorkflow).toContain("Verify current main is the quality-approved candidate");
    expect(deployWorkflow).toContain("Revalidate governed Edge candidate");
    expect(deployWorkflow).toContain("Reverify remote main immediately before Production mutation");
    expect(deployWorkflow).toContain("Deploy governed functions");
    expect(deployWorkflow).not.toContain("Converge Google Ads credential through deployed runtime");
    expect(deployWorkflow).not.toContain("GOOGLE_ADS_DEVELOPER_TOKEN");
    expect(deployWorkflow).not.toContain("continue-on-error: true");
    expect(deployWorkflow).not.toContain("git diff --name-only");
  });

  it("converges normalized Google Ads runtime identity without moving provider acceptance into the deploy domain", () => {
    expect(deployWorkflow).toContain("GOOGLE_ADS_SERVICE_ACCOUNT: ${{ secrets.GOOGLE_ADS_SERVICE_ACCOUNT }}");
    expect(deployWorkflow).toContain("GOOGLE_ADS_CLIENT_ID: ${{ secrets.GOOGLE_ADS_CLIENT_ID }}");
    expect(deployWorkflow).toContain("GOOGLE_ADS_CLIENT_SECRET: ${{ secrets.GOOGLE_ADS_CLIENT_SECRET }}");
    expect(deployWorkflow).toContain("GOOGLE_ADS_REFRESH_TOKEN: ${{ secrets.GOOGLE_ADS_REFRESH_TOKEN }}");
    expect(deployWorkflow).toContain("node scripts/converge-google-ads-edge-auth.js --validate-only");
    expect(deployWorkflow).toContain("node scripts/converge-google-ads-edge-auth.js");
    expect(deployWorkflow).not.toContain("scripts/google-ads-auth-preflight.js");
    expect(deployWorkflow).not.toContain("GOOGLE_ADS_DEVELOPER_TOKEN");
    expect(convergenceScript).toContain("String(value ?? '').trim()");
    expect(convergenceScript).toContain("verifySecretShape(after, identity)");
    expect(convergenceScript).not.toContain("GOOGLE_ADS_DEVELOPER_TOKEN");
  });

  it("proves the actual upstream deploy and fails closed when required provenance is absent", () => {
    expect(googleAdsAcceptanceWorkflow).toContain("name: Google Ads Runtime Acceptance");
    expect(googleAdsAcceptanceWorkflow).toContain("workflows: ['Deploy Standalone Edge Functions']");
    expect(googleAdsAcceptanceWorkflow).toContain("actions: read");
    expect(googleAdsAcceptanceWorkflow).toContain("UPSTREAM_CONCLUSION: ${{ github.event.workflow_run.conclusion }}");
    expect(googleAdsAcceptanceWorkflow).toContain("UPSTREAM_EVENT: ${{ github.event.workflow_run.event }}");
    expect(googleAdsAcceptanceWorkflow).toContain("UPSTREAM_BRANCH: ${{ github.event.workflow_run.head_branch }}");
    expect(googleAdsAcceptanceWorkflow).toContain("name: Qualify · governed Edge deployment");
    expect(googleAdsAcceptanceWorkflow).toContain("Qualify trusted upstream envelope");
    expect(googleAdsAcceptanceWorkflow).toContain("Prove governed Edge deployment actually ran");
    expect(googleAdsAcceptanceWorkflow).toContain("actions/runs/${UPSTREAM_RUN_ID}/jobs?per_page=100");
    expect(googleAdsAcceptanceWorkflow).toContain("python3 -m py_compile scripts/qualify-governed-edge-deployment.py");
    expect(googleAdsAcceptanceWorkflow).toContain("python3 scripts/qualify-governed-edge-deployment.py");
    expect(googleAdsAcceptanceWorkflow).not.toContain("python3 - <<'PY'");

    expect(provenanceQualifier).toContain('upstream_conclusion != "success"');
    expect(provenanceQualifier).toContain('upstream_event != "workflow_run"');
    expect(provenanceQualifier).toContain('upstream_branch != "main"');
    expect(provenanceQualifier).toContain('DEPLOY_JOB_NAME = "Deploy · governed Edge Functions"');
    expect(provenanceQualifier).toContain('"Deploy governed functions"');
    expect(provenanceQualifier).toContain('job.get("head_sha") != expected_sha');
    expect(provenanceQualifier).toContain('job.get("run_id") != expected_run_id');
    expect(provenanceQualifier).toContain("if not accept:");
    expect(provenanceQualifier).toContain("return 1");

    expect(googleAdsAcceptanceWorkflow).toContain("needs: provenance");
    expect(googleAdsAcceptanceWorkflow).toContain("needs.provenance.outputs.accept == 'true'");
    expect(googleAdsAcceptanceWorkflow).toContain("DEPLOYED_SHA: ${{ needs.provenance.outputs.deployed_sha }}");
  });

  it("treats a legitimately skipped deploy as not applicable instead of a false Google Ads failure", () => {
    expect(provenanceQualifier).toContain("not_applicable = False");
    expect(provenanceQualifier).toContain('job.get("conclusion") == "skipped"');
    expect(provenanceQualifier).toContain("not_applicable = True");
    expect(provenanceQualifier).toContain("no Production Edge mutation occurred");
    expect(provenanceQualifier).toContain("if not_applicable:");
    expect(provenanceQualifier).toContain("return 0");
    expect(provenanceQualifier).toContain("accept={'true' if accept else 'false'}");
    expect(googleAdsAcceptanceWorkflow).toContain('if [[ "${UPSTREAM_CONCLUSION:-}" == "skipped" ]]');
    expect(googleAdsAcceptanceWorkflow).toContain('echo "applicable=false" >> "$GITHUB_OUTPUT"');
  });

  it("proves auth inside the deployed Edge control plane before credential convergence", () => {
    expect(googleAdsAcceptanceWorkflow).not.toContain("GOOGLE_ADS_SERVICE_ACCOUNT: ${{ secrets.GOOGLE_ADS_SERVICE_ACCOUNT }}");
    expect(googleAdsAcceptanceWorkflow).not.toContain("GOOGLE_ADS_CLIENT_ID: ${{ secrets.GOOGLE_ADS_CLIENT_ID }}");
    expect(googleAdsAcceptanceWorkflow).not.toContain("GOOGLE_ADS_CLIENT_SECRET: ${{ secrets.GOOGLE_ADS_CLIENT_SECRET }}");
    expect(googleAdsAcceptanceWorkflow).not.toContain("GOOGLE_ADS_REFRESH_TOKEN: ${{ secrets.GOOGLE_ADS_REFRESH_TOKEN }}");
    const preflight = googleAdsAcceptanceWorkflow.indexOf("node scripts/preflight-google-ads-runtime.js");
    const mutation = googleAdsAcceptanceWorkflow.indexOf("node scripts/provision-google-ads-developer-token.js");
    expect(preflight).toBeGreaterThan(-1);
    expect(mutation).toBeGreaterThan(preflight);
    expect(googleAdsAcceptanceWorkflow).toContain("scripts/preflight-google-ads-runtime.test.js");
    expect(runtimePreflightScript).toContain("/functions/v1/google-ads-auth-preflight");
    expect(runtimePreflightScript).toContain("persistence_performed !== false");
  });

  it("deploys health, daily sync and auth preflight from one governed exact-SHA release", () => {
    expect(deployWorkflow).toContain("supabase functions deploy google-ads-auth-preflight");
    expect(deployWorkflow).toContain("supabase functions deploy google-ads-health");
    expect(deployWorkflow).toContain("supabase functions deploy google-ads-daily-sync");
  });

  it("keeps Google Ads runtime acceptance exact-SHA and fail-closed once qualified", () => {
    expect(googleAdsAcceptanceWorkflow).toContain("group: manual-maintenance-deploy_edge");
    expect(googleAdsAcceptanceWorkflow).toContain("name: Production");
    expect(googleAdsAcceptanceWorkflow).toContain("Verify current main is the deployed candidate");
    expect(googleAdsAcceptanceWorkflow).toContain('if [[ "$CURRENT_SHA" != "$DEPLOYED_SHA" ]]');
    expect(googleAdsAcceptanceWorkflow).toContain("refusing to report Google Ads runtime acceptance for a superseded candidate");
    expect(googleAdsAcceptanceWorkflow).toContain("Reverify remote main immediately before Google Ads acceptance");
    expect(googleAdsAcceptanceWorkflow).toContain("refusing stale Google Ads credential mutation");
    expect(googleAdsAcceptanceWorkflow).toContain("Converge and accept Google Ads credential through deployed runtime");
    expect(googleAdsAcceptanceWorkflow).toContain("node scripts/provision-google-ads-developer-token.js");
    expect(googleAdsAcceptanceWorkflow).not.toContain("continue-on-error: true");
    expect(googleAdsAcceptanceWorkflow).not.toContain("workflow_dispatch:");
    expect(googleAdsAcceptanceWorkflow).not.toContain("git diff --name-only");
  });

  it("executes both runtime acceptance and Edge auth convergence tests in the canonical suite", () => {
    expect(packageJson.scripts.test).toContain("node --test scripts/preflight-google-ads-runtime.test.js");
    expect(packageJson.scripts.test).toContain("node --test scripts/converge-google-ads-edge-auth.test.js");
    expect(packageJson.scripts.test).toContain("vitest run supabase/functions");
  });
});
