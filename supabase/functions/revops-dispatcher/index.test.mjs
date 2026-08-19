import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
const routingMigration = readFileSync(
  fileURLToPath(new URL("../../migrations/20260819193100_route_revops_dispatcher.sql", import.meta.url)),
  "utf8",
);
const baseMigration = readFileSync(
  fileURLToPath(new URL("../../migrations/20260819193000_consolidate_web_capture_revops.sql", import.meta.url)),
  "utf8",
);

describe("RevOps dispatcher contract", () => {
  it("authenticates only with the Vault-generated internal secret", () => {
    expect(source).toContain('req.headers.get("x-nvx-internal-secret")');
    expect(source).toContain('p_name: "REVOPS_INTERNAL_SECRET"');
    expect(source).toContain("secretMatches(received, String(expected))");
    expect(source).toContain('message: "Forbidden"');
    expect(source).toContain('SUPABASE_SERVICE_ROLE_KEY") || "").trim()');
  });

  it("allowlists only governed RevOps workers", () => {
    expect(source).toContain('new Set(["web-lead-reconcile", "deal-factory", "google-data-manager-export"])');
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
    expect(source).not.toMatch(/console\.(?:log|error)\([^\n]*(?:received|expected|SERVICE_ROLE)/);
    expect(source).not.toContain("await response.text()");
    expect(source).not.toContain("await response.json()");
  });

  it("never hardcodes the production Supabase project into migrations", () => {
    expect(baseMigration).not.toContain("ssvvuuysgxyqvmovrlvk.supabase.co");
    expect(routingMigration).not.toContain("ssvvuuysgxyqvmovrlvk.supabase.co");
    expect(routingMigration).toContain("REVOPS_PROJECT_URL");
    expect(routingMigration).toContain("nvx_set_revops_project_url");
    expect(routingMigration).toContain("v_project_url || '/functions/v1/revops-dispatcher'");
  });

  it("schedules both Google delivery and provider-status polling", () => {
    expect(routingMigration).toContain("nvx-google-data-manager-deliver");
    expect(routingMigration).toContain("nvx-google-data-manager-poll");
    expect(routingMigration).toContain("'google-data-manager-export', 50, 'deliver'");
    expect(routingMigration).toContain("'google-data-manager-export', 50, 'poll'");
    expect(routingMigration).toContain("google_data_manager_outbox_wake_worker");
  });
});
