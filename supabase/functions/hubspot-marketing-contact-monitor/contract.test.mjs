import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  classifyFailure,
  refreshHubSpotMarketingContactMonitor,
} = require("../../../scripts/refresh-hubspot-marketing-contact-monitor.js");

const edgeSource = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
const workflowSource = readFileSync(
  fileURLToPath(new URL("../../../.github/workflows/hubspot-marketing-contact-monitor.yml", import.meta.url)),
  "utf8",
);
const deployWorkflow = readFileSync(
  fileURLToPath(new URL("../../../.github/workflows/deploy-standalone-edge-functions.yml", import.meta.url)),
  "utf8",
);
const migrationSource = readFileSync(
  fileURLToPath(new URL("../../migrations/20260903142000_hubspot_marketing_contact_monitor_runtime_state.sql", import.meta.url)),
  "utf8",
);

describe("HubSpot marketing-contact monitor", () => {
  it("accepts a valid live count through the internal Edge boundary", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), init });
      if (calls.length === 1) {
        return new Response(JSON.stringify("internal-secret"), { status: 200 });
      }
      return new Response(JSON.stringify({
        success: true,
        count: 417,
        threshold: 900,
        above_threshold: false,
        threshold_transition: false,
        checked_at: "2026-09-03T14:00:00.000Z",
      }), { status: 200 });
    };

    const result = await refreshHubSpotMarketingContactMonitor({
      base: "https://abcdefghijklmnopqrst.supabase.co",
      serviceRole: "service-role-value",
      fetchImpl,
    });

    expect(result).toEqual({
      success: true,
      count: 417,
      threshold: 900,
      above_threshold: false,
      threshold_transition: false,
      checked_at: "2026-09-03T14:00:00.000Z",
    });
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain("/functions/v1/hubspot-marketing-contact-monitor");
    expect(calls[1].init.headers["x-nvx-internal-secret"]).toBe("internal-secret");
  });

  it("surfaces only allowlisted provider failure codes", async () => {
    let call = 0;
    const fetchImpl = async () => {
      call += 1;
      if (call === 1) return new Response(JSON.stringify("internal-secret"), { status: 200 });
      return new Response(JSON.stringify({
        success: false,
        code: "hubspot_unauthorized",
        provider_payload: "must-not-leak",
      }), { status: 502 });
    };

    await expect(refreshHubSpotMarketingContactMonitor({
      base: "https://abcdefghijklmnopqrst.supabase.co",
      serviceRole: "service-role-value",
      fetchImpl,
    })).rejects.toThrow("code=hubspot_unauthorized");

    expect(classifyFailure({ code: "untrusted-secret-bearing-code" })).toBe("unknown_failure");
  });

  it("keeps failed refreshes stale instead of overwriting the last valid count", () => {
    const failurePersistence = edgeSource
      .split("async function persistFailureState")[1]
      .split("Deno.serve")[0];
    expect(failurePersistence).toContain("last_error_code: failure.code");
    expect(failurePersistence).toContain("last_error_at: now");
    expect(failurePersistence).not.toContain("last_count");
    expect(failurePersistence).not.toContain("last_checked_at");
    expect(edgeSource).toContain('propertyName: "hs_marketable_status"');
    expect(edgeSource).toContain('value: "true"');
  });

  it("publishes freshness/error state and uses an independent governed cadence", () => {
    expect(migrationSource).toContain("add column if not exists last_error_code text");
    expect(migrationSource).toContain("add column if not exists last_error_at timestamptz");
    expect(migrationSource).toContain("age_seconds bigint");
    expect(workflowSource).toContain("name: HubSpot Marketing Contact Monitor");
    expect(workflowSource).toContain("cron: '20 6 * * *'");
    expect(workflowSource).toContain("environment:\n      name: Production");
    expect(workflowSource).toContain("node scripts/refresh-hubspot-marketing-contact-monitor.js");
    expect(deployWorkflow).toContain("supabase/functions/hubspot-marketing-contact-monitor/index.ts");
    expect(deployWorkflow).toContain('supabase functions deploy hubspot-marketing-contact-monitor --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
  });
});
