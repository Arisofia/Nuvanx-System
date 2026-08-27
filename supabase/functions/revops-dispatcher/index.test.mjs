import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
const authSource = readFileSync(fileURLToPath(new URL("./auth.ts", import.meta.url)), "utf8");
const routingMigration = readFileSync(
  fileURLToPath(new URL("../../migrations/20260819193100_route_revops_dispatcher.sql", import.meta.url)),
  "utf8",
);
const hotfixMigration = readFileSync(
  fileURLToPath(new URL("../../migrations/20260819203000_nonblocking_revops_wakeups.sql", import.meta.url)),
  "utf8",
);
const metaRoutingMigration = readFileSync(
  fileURLToPath(new URL("../../migrations/20260827203500_meta_hubspot_commercial_reconciliation.sql", import.meta.url)),
  "utf8",
);
const baseMigration = readFileSync(
  fileURLToPath(new URL("../../migrations/20260819193000_consolidate_web_capture_revops.sql", import.meta.url)),
  "utf8",
);

describe("RevOps dispatcher contract", () => {
  it("authenticates only with the Vault-generated internal secret", () => {
    expect(source).toContain('authenticateDispatcherRequest(req, async () =>');
    expect(authSource).toContain('req.headers.get("x-nvx-internal-secret")');
    expect(source).toContain('p_name: "REVOPS_INTERNAL_SECRET"');
    expect(authSource).toContain("secretMatches(received, expected)");
    expect(authSource).toContain('message: "Forbidden"');
    expect(source).toContain('SUPABASE_SERVICE_ROLE_KEY") || "").trim()');
  });

  it("allowlists only governed RevOps workers", () => {
    expect(source).toContain('new Set(["web-lead-reconcile", "meta-hubspot-reconcile", "deal-factory", "google-data-manager-export"])');
    expect(source).toContain("if (!ALLOWED_WORKERS.has(worker))");
  });

  it("upgrades the narrow dispatch credential to service-role only inside Edge Runtime", () => {
    expect(source).toContain('Authorization: `Bearer ${SERVICE_ROLE}`');
    expect(source).toContain('fetch(`${SUPABASE_URL}/functions/v1/${worker}`');
  });

  it("passes only deliver/poll mode to Google Data Manager", () => {
    expect(source).toContain('worker === "google-data-manager-export"');
    expect(source).toContain('mode !== "deliver" && mode !== "poll"');
    expect(source).toContain("workerBody.mode = mode");
    expect(source).toContain('message: "Worker mode is only valid for Google Data Manager"');
  });

  it("does not expose credentials or worker response bodies", () => {
    expect(source).not.toMatch(/console\.(?:log|error)\([^\n]*(?:expected|SERVICE_ROLE)/);
    expect(source).not.toContain("await response.text()");
    expect(source).not.toContain("await response.json()");
  });

  it("never hardcodes the production Supabase project into migrations", () => {
    expect(baseMigration).not.toContain("ssvvuuysgxyqvmovrlvk.supabase.co");
    expect(routingMigration).not.toContain("ssvvuuysgxyqvmovrlvk.supabase.co");
    expect(hotfixMigration).not.toContain("ssvvuuysgxyqvmovrlvk.supabase.co");
    expect(metaRoutingMigration).not.toContain("ssvvuuysgxyqvmovrlvk.supabase.co");
    expect(routingMigration).toContain("REVOPS_PROJECT_URL");
    expect(routingMigration).toContain("nvx_set_revops_project_url");
    expect(routingMigration).toContain("v_project_url || '/functions/v1/revops-dispatcher'");
  });

  it("preserves the already-applied strict dispatcher migration and versions wakeup hardening separately", () => {
    expect(routingMigration).not.toContain("nvx_try_dispatch_revops_worker");
    expect(hotfixMigration).toContain("create or replace function public.nvx_try_dispatch_revops_worker");
    expect(hotfixMigration).toContain("exception\n  when others then");
    expect(hotfixMigration).toContain("return null;");
  });

  it("keeps trigger wakeups non-blocking before runtime bootstrap", () => {
    expect(hotfixMigration).toContain("perform public.nvx_try_dispatch_revops_worker('deal-factory', 20, null)");
    expect(hotfixMigration).toContain("perform public.nvx_try_dispatch_revops_worker('google-data-manager-export', 20, 'deliver')");
    expect(metaRoutingMigration).toContain("perform public.nvx_try_dispatch_revops_worker('meta-hubspot-reconcile', 25, null)");
    expect(hotfixMigration).not.toMatch(/perform public\.nvx_dispatch_revops_worker\('(?:deal-factory|google-data-manager-export)'/);
  });

  it("schedules both Google delivery and provider-status polling through the safe wakeup wrapper", () => {
    expect(hotfixMigration).toContain("nvx-google-data-manager-deliver");
    expect(hotfixMigration).toContain("nvx-google-data-manager-poll");
    expect(hotfixMigration).toContain("nvx_try_dispatch_revops_worker('google-data-manager-export', 50, 'deliver')");
    expect(hotfixMigration).toContain("nvx_try_dispatch_revops_worker('google-data-manager-export', 50, 'poll')");
    expect(hotfixMigration).toContain("nvx_try_dispatch_revops_worker('web-lead-reconcile', 50, null)");
    expect(hotfixMigration).toContain("nvx_try_dispatch_revops_worker('deal-factory', 50, null)");
  });

  it("keeps Meta reconciliation fallback idle-aware at the low-consumption 3x/day cadence", () => {
    expect(metaRoutingMigration).toContain("'nvx-meta-hubspot-reconcile'");
    expect(metaRoutingMigration).toContain("'0 4,12,20 * * *'");
    expect(metaRoutingMigration).toContain("nvx_dispatch_revops_worker('meta-hubspot-reconcile', 50, null)");
    expect(metaRoutingMigration).toContain("where status in ('pending', 'unmatched', 'failed')");
  });
});
