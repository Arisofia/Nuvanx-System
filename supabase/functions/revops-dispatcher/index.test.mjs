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
const capiMigration = readFileSync(
  fileURLToPath(new URL("../../migrations/20260830070000_add_durable_meta_capi_outbox.sql", import.meta.url)),
  "utf8",
);
const whatsappMigration = readFileSync(
  fileURLToPath(new URL("../../migrations/20260901190000_async_whatsapp_encrypted_outbox.sql", import.meta.url)),
  "utf8",
);

describe("RevOps dispatcher contract", () => {
  it("authenticates only with the Vault-generated internal secret", () => {
    expect(source).toContain("authenticateDispatcherRequest(req, async () =>");
    expect(authSource).toContain('req.headers.get("x-nvx-internal-secret")');
    expect(source).toContain('p_name: "REVOPS_INTERNAL_SECRET"');
    expect(authSource).toContain("secretMatches(received, expected)");
    expect(authSource).toContain('message: "Forbidden"');
  });

  it("uses the database registry as the single worker allowlist", () => {
    expect(source).toContain('.from("revops_worker_registry")');
    expect(source).toContain('.eq("worker", worker)');
    expect(source).toContain('.eq("enabled", true)');
    expect(source).not.toContain("ALLOWED_WORKERS");
    for (const worker of [
      "web-lead-reconcile",
      "deal-factory",
      "google-data-manager-export",
      "meta-capi-dispatch",
      "whatsapp-outbound-worker",
    ]) {
      expect(whatsappMigration).toContain(`('${worker}', true`);
    }
  });

  it("moves the SQL dispatcher away from a copied hard-coded worker list", () => {
    expect(whatsappMigration).toContain("create table if not exists public.revops_worker_registry");
    expect(whatsappMigration).toContain("from public.revops_worker_registry r");
    expect(whatsappMigration).toContain("where r.worker = p_worker");
    expect(whatsappMigration).not.toContain("p_worker not in ('web-lead-reconcile'");
  });

  it("upgrades the narrow dispatch credential to service-role only inside Edge Runtime", () => {
    expect(source).toContain('Authorization: `Bearer ${SERVICE_ROLE}`');
    expect(source).toContain('fetch(`${SUPABASE_URL}/functions/v1/${worker}`');
  });

  it("permits mode only for registry-enabled workers and validates Data Manager modes", () => {
    expect(source).toContain("workerConfig.allows_mode !== true");
    expect(source).toContain('worker === "google-data-manager-export"');
    expect(source).toContain('mode !== "deliver" && mode !== "poll"');
    expect(source).toContain("workerBody.mode = mode");
    expect(whatsappMigration).toContain("('google-data-manager-export', true, true)");
    expect(whatsappMigration).toContain("('whatsapp-outbound-worker', true, false)");
  });

  it("does not expose credentials or worker response bodies", () => {
    expect(source).not.toMatch(/console\.(?:log|error)\([^\n]*(?:expected|SERVICE_ROLE)/);
    expect(source).not.toContain("await response.text()");
    expect(source).not.toContain("await response.json()");
  });

  it("preserves environment-local dispatch and non-blocking wakeups", () => {
    expect(routingMigration).toContain("REVOPS_PROJECT_URL");
    expect(routingMigration).toContain("v_project_url || '/functions/v1/revops-dispatcher'");
    expect(hotfixMigration).toContain("create or replace function public.nvx_try_dispatch_revops_worker");
    expect(hotfixMigration).toContain("exception\n  when others then");
    expect(capiMigration).toContain("perform public.nvx_try_dispatch_revops_worker('meta-capi-dispatch', 25, null)");
    expect(whatsappMigration).toContain("public.nvx_try_dispatch_revops_worker('whatsapp-outbound-worker', 3, null)");

    expect(source).toContain("const WORKER_TIMEOUT_MS = 30_000;");
    expect(source).toContain("signal: AbortSignal.timeout(WORKER_TIMEOUT_MS)");
    expect(source).toContain("const workerRequest = invokeWorker(worker, workerBody)");
    expect(source).toContain("EdgeRuntime.waitUntil(workerRequest)");
    expect(source).toContain("await workerRequest");

    const waitUntil = source.indexOf("EdgeRuntime.waitUntil(workerRequest)");
    const accepted = source.indexOf("return reply(202, { success: true, worker, mode, dispatched: true })");
    expect(waitUntil).toBeGreaterThan(-1);
    expect(accepted).toBeGreaterThan(waitUntil);
    expect(source).not.toContain("return reply(502, { success: false, worker, worker_status: response.status })");
  });
});
