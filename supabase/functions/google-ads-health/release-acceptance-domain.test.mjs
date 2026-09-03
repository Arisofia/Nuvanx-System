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

describe("Production release acceptance domains", () => {
  it("keeps governed Edge deployment exact-SHA while preventing Google Ads provider health from rewriting deploy success", () => {
    expect(deployWorkflow).toContain("Verify current main is the quality-approved candidate");
    expect(deployWorkflow).toContain("Reverify remote main immediately before Production mutation");
    expect(deployWorkflow).toContain("Reverify candidate after governed deployment");
    expect(deployWorkflow).toContain("Converge Google Ads credential through deployed runtime");
    expect(deployWorkflow).toMatch(
      /- name: Converge Google Ads credential through deployed runtime\n\s+if:.*\n\s+continue-on-error: true/,
    );
    expect(deployWorkflow).not.toContain("git diff --name-only");
  });

  it("emits Google Ads runtime readiness as a separate fail-closed workflow tied to the deployed SHA", () => {
    expect(googleAdsAcceptanceWorkflow).toContain("name: Google Ads Runtime Acceptance");
    expect(googleAdsAcceptanceWorkflow).toContain("workflows: ['Deploy Standalone Edge Functions']");
    expect(googleAdsAcceptanceWorkflow).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(googleAdsAcceptanceWorkflow).toContain("github.event.workflow_run.event == 'workflow_run'");
    expect(googleAdsAcceptanceWorkflow).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(googleAdsAcceptanceWorkflow).toContain("DEPLOYED_SHA: ${{ github.event.workflow_run.head_sha }}");
    expect(googleAdsAcceptanceWorkflow).toContain("group: manual-maintenance-deploy_edge");
    expect(googleAdsAcceptanceWorkflow).toContain("name: Production");
    expect(googleAdsAcceptanceWorkflow).toContain("Verify current main is the deployed candidate");
    expect(googleAdsAcceptanceWorkflow).toContain('if [[ "$CURRENT_SHA" != "$DEPLOYED_SHA" ]]');
    expect(googleAdsAcceptanceWorkflow).toContain("Reverify remote main immediately before Google Ads acceptance");
    expect(googleAdsAcceptanceWorkflow).toContain("Converge and accept Google Ads credential through deployed runtime");
    expect(googleAdsAcceptanceWorkflow).toContain("node scripts/provision-google-ads-developer-token.js");
    expect(googleAdsAcceptanceWorkflow).not.toContain("workflow_dispatch:");
    expect(googleAdsAcceptanceWorkflow).not.toContain("git diff --name-only");
  });
});
