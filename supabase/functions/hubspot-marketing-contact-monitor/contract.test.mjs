import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { persistFailureState } from "./state.ts";

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

function failureStateAdmin({ data = [{ monitor_key: "hubspot_marketing_contacts" }], error = null } = {}) {
  const updates = [];
  const admin = {
    from: (table) => {
      expect(table).toBe("hubspot_marketing_contact_monitor_state");
      return {
        update: (payload) => {
          updates.push(payload);
          return {
            eq: (column, value) => {
              expect(column).toBe("monitor_key");
              expect(value).toBe("hubspot_marketing_contacts");
              return {
                select: async (projection) => {
                  expect(projection).toBe("monitor_key");
                  return { data, error };
                },
              };
            },
          };
        },
      };
    },
  };
  return { admin, updates };
}

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

  it("persists bounded failure state and surfaces database write errors", async () => {
    const { admin, updates } = failureStateAdmin({ error: new Error("write failed") });

    await expect(persistFailureState(
      admin,
      "hubspot_marketing_contacts",
      { code: "hubspot_unauthorized" },
      "2026-09-03T14:00:00.000Z",
    )).rejects.toThrow("write failed");

    expect(updates).toEqual([{
      last_error_code: "hubspot_unauthorized",
      last_error_at: "2026-09-03T14:00:00.000Z",
      updated_at: "2026-09-03T14:00:00.000Z",
    }]);
    expect(updates[0]).not.toHaveProperty("last_count");
    expect(updates[0]).not.toHaveProperty("last_checked_at");
  });

  it("requires failure-state persistence to affect exactly the canonical monitor row", async () => {
    const missing = failureStateAdmin({ data: [] });
    await expect(persistFailureState(
      missing.admin,
      "hubspot_marketing_contacts",
      { code: "hubspot_unauthorized" },
      "2026-09-03T14:00:00.000Z",
    )).rejects.toThrow("unexpected row count");

    const duplicate = failureStateAdmin({
      data: [
        { monitor_key: "hubspot_marketing_contacts" },
        { monitor_key: "hubspot_marketing_contacts" },
      ],
    });
    await expect(persistFailureState(
      duplicate.admin,
      "hubspot_marketing_contacts",
      { code: "hubspot_unauthorized" },
      "2026-09-03T14:00:00.000Z",
    )).rejects.toThrow("unexpected row count");

    const canonical = failureStateAdmin();
    await expect(persistFailureState(
      canonical.admin,
      "hubspot_marketing_contacts",
      { code: "hubspot_unauthorized" },
      "2026-09-03T14:00:00.000Z",
    )).resolves.toBeUndefined();
  });

  it("commits successful observations through one transactional RPC", () => {
    expect(edgeSource).toContain('"nvx_commit_hubspot_marketing_contact_monitor"');
    expect(edgeSource).toContain("{ p_count: count }");
    expect(edgeSource).not.toContain('.select("threshold,above_threshold,last_triggered_at")');
    expect(edgeSource).not.toContain("last_count: count");
    expect(migrationSource).toContain("for update;");
    expect(migrationSource).toContain("v_transition := p_count >= v_threshold and not v_was_above");
    expect(migrationSource).toContain("last_triggered_at = case when v_transition then v_checked_at else s.last_triggered_at end");
  });

  it("preserves the private-definer/public-invoker trust boundary", () => {
    expect(migrationSource).toMatch(/create function private\.nvx_get_hubspot_marketing_contact_monitor\(\)[\s\S]*?security definer/i);
    expect(migrationSource).toMatch(/create function public\.nvx_get_hubspot_marketing_contact_monitor\(\)[\s\S]*?security invoker/i);
    expect(migrationSource).toContain("revoke all on function public.nvx_get_hubspot_marketing_contact_monitor() from public, anon");
    expect(migrationSource).toMatch(/create function private\.nvx_commit_hubspot_marketing_contact_monitor\(p_count integer\)[\s\S]*?security definer/i);
    expect(migrationSource).toMatch(/create function public\.nvx_commit_hubspot_marketing_contact_monitor\(p_count integer\)[\s\S]*?security invoker/i);
    expect(migrationSource).toContain("revoke all on function public.nvx_commit_hubspot_marketing_contact_monitor(integer) from public, anon, authenticated");
  });

  it("publishes freshness/error state and uses an independent governed cadence", () => {
    expect(migrationSource).toContain("add column if not exists last_error_code text");
    expect(migrationSource).toContain("add column if not exists last_error_at timestamptz");
    expect(migrationSource).toContain("age_seconds bigint");
    expect(workflowSource).toContain("name: HubSpot Marketing Contact Monitor");
    expect(workflowSource).toContain("cron: '20 6 * * *'");
    expect(workflowSource).toContain("environment:\n      name: Production");
    expect(workflowSource).toContain("node scripts/refresh-hubspot-marketing-contact-monitor.js");
    expect(deployWorkflow).toContain("find supabase/migrations -maxdepth 1 -type f -name '*.sql' -print | sort");
    expect(deployWorkflow).toContain('LOCAL_MIGRATIONS+=("$MIGRATION_VERSION")');
    expect(deployWorkflow).toContain("supabase/functions/hubspot-marketing-contact-monitor/index.ts");
    expect(deployWorkflow).toContain('supabase functions deploy hubspot-marketing-contact-monitor --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt');
  });
});
