import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const workflow = readFileSync(
  fileURLToPath(new URL("../../.github/workflows/manual-maintenance.yml", import.meta.url)),
  "utf8",
);

const residualTempFunctions = [
  "meta-asset-audit-temp",
  "meta-legacy-retire-temp",
  "google-gtm-audit-temp",
  "google-gtm-sa-audit-temp",
  "google-sa-shape-temp",
  "google-gtm-enable-temp",
  "meta-qa-suppression-proof-temp",
];

describe("manual maintenance retired Edge inventory", () => {
  it("keeps every verified residual temp function in the governed prune whitelist", () => {
    const retiredBlock = workflow.match(/retired=\(\n([\s\S]*?)\n\s*\)/)?.[1] ?? "";
    for (const functionName of residualTempFunctions) {
      expect(retiredBlock).toContain(functionName);
    }
  });

  it("keeps destructive cleanup exact-SHA gated and verifies deletion", () => {
    expect(workflow).toContain('test "$TRUSTED_SHA" = "$GITHUB_SHA"');
    expect(workflow).toContain('supabase functions delete "$function_name"');
    expect(workflow).toContain('Retired Edge Function still registered');
  });
});
