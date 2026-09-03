import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const workflow = readFileSync(
  fileURLToPath(new URL("../../../.github/workflows/google-ads-runtime-acceptance.yml", import.meta.url)),
  "utf8",
);
const healthSource = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
const authSource = readFileSync(fileURLToPath(new URL("../_shared/google-ads-auth.ts", import.meta.url)), "utf8");

describe("Google Ads runtime acceptance orchestration", () => {
  it("treats an expected skipped deploy as not-applicable instead of a false runtime failure", () => {
    expect(workflow).toContain("job.get('conclusion') == 'skipped'");
    expect(workflow).toContain("not_applicable = True");
    expect(workflow).toContain("no Production Edge mutation occurred and runtime acceptance is not applicable");
    expect(workflow).toContain("if not_applicable:\n              print(reason)\n              sys.exit(0)");
    expect(workflow).toContain("if not accept:\n              print(f\"::error::{reason}\")\n              sys.exit(1)");
  });

  it("proves provider auth read-only before any credential convergence", () => {
    const preflight = workflow.indexOf("Preflight Google Ads provider authentication");
    const mutationGuard = workflow.indexOf("Reverify remote main immediately before Google Ads acceptance");
    const provision = workflow.indexOf("Converge and accept Google Ads credential through deployed runtime");
    expect(preflight).toBeGreaterThan(-1);
    expect(mutationGuard).toBeGreaterThan(preflight);
    expect(provision).toBeGreaterThan(mutationGuard);
    expect(workflow).toContain("node scripts/google-ads-auth-preflight.js");
    expect(workflow).toContain("GOOGLE_ADS_CLIENT_ID: ${{ secrets.GOOGLE_ADS_CLIENT_ID }}");
    expect(workflow).toContain("GOOGLE_ADS_CLIENT_SECRET: ${{ secrets.GOOGLE_ADS_CLIENT_SECRET }}");
    expect(workflow).toContain("GOOGLE_ADS_REFRESH_TOKEN: ${{ secrets.GOOGLE_ADS_REFRESH_TOKEN }}");
    expect(workflow).toContain("GOOGLE_ADS_SERVICE_ACCOUNT: ${{ secrets.GOOGLE_ADS_SERVICE_ACCOUNT }}");
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
