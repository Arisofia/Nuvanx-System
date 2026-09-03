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

  it("proves the upstream deploy step before exposing Production Google Ads credentials", () => {
    expect(googleAdsAcceptanceWorkflow).toContain("name: Google Ads Runtime Acceptance");
    expect(googleAdsAcceptanceWorkflow).toContain("workflows: ['Deploy Standalone Edge Functions']");
    expect(googleAdsAcceptanceWorkflow).toContain("actions: read");
    expect(googleAdsAcceptanceWorkflow).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(googleAdsAcceptanceWorkflow).toContain("github.event.workflow_run.event == 'workflow_run'");
    expect(googleAdsAcceptanceWorkflow).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(googleAdsAcceptanceWorkflow).toContain("name: Qualify · governed Edge deployment");
    expect(googleAdsAcceptanceWorkflow).toContain("Prove governed Edge deployment actually ran");
    expect(googleAdsAcceptanceWorkflow).toContain("actions/runs/${UPSTREAM_RUN_ID}/jobs?per_page=100");
    expect(googleAdsAcceptanceWorkflow).toContain("Deploy · governed Edge Functions");
    expect(googleAdsAcceptanceWorkflow).toContain("Deploy governed functions");
    expect(googleAdsAcceptanceWorkflow).toContain("job.get('head_sha') != expected_sha");
    expect(googleAdsAcceptanceWorkflow).toContain("needs: provenance");
    expect(googleAdsAcceptanceWorkflow).toContain("needs.provenance.outputs.accept == 'true'");
    expect(googleAdsAcceptanceWorkflow).toContain("DEPLOYED_SHA: ${{ needs.provenance.outputs.deployed_sha }}");
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

  it("is executed by the canonical repository test command", () => {
    expect(packageJson.scripts.test).toContain("vitest run supabase/functions");
  });
});