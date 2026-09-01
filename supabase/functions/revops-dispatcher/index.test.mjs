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
const baseMigration = readFileSync(
  fileURLToPath(new URL("../../migrations/20260819193000_consolidate_web_capture_revops.sql", import.meta.url)),
  "utf8",
);
const capiMigration = readFileSync(
  fileURLToPath(new URL("../../migrations/20260830070000_add_durable_meta_capi_outbox.sql", import.meta.url)),
  "utf8",
);
const whatsappAsyncMigration = readFileSync(
  fileURLToPath(new URL("../../migrations/20260901113000_async_whatsapp_encrypted_outbox.sql", import.meta.url)),
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

  it("allowlists only governed RevOps workers including durable Meta CAPI and async WhatsApp", () => {
    const match = source.match(/const ALLOWED_WORKERS = new Set\(\[([^\]]+)\]\)/);
    expect(match).not.toBeNull();
    const workers = match[1].split(",").map(s => s.trim().replace(/"/g, ''));
    expect(workers).toEqual([
      "web-lead-reconcile",
      "deal-factory",
      "google-data-manager-export",
      "meta-capi-dispatch",
      "whatsapp-outbound-worker"
    ]);
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
    expect(capiMigration).not.toContain("ssvvuuysgxyqvmovrlvk.supabase.co");
    expect(whatsappAsyncMigration).not.toContain("ssvvuuysgxyqvmovrlvk.supabase.co");
    expect(routingMigration).toContain("REVOPS_PROJECT_URL");
    expect(routingMigration).toContain("nvx_set_revops_project_url");
    expect(routingMigration).toContain("v_project_url || '/functions/v1/revops-dispatcher'");
  });

  it("preserves non-blocking transaction wakeups and routes the WhatsApp worker through the same owner", () => {
    expect(hotfixMigration).toContain("create or replace function public.nvx_try_dispatch_revops_worker");
    expect(hotfixMigration).toContain("exception\n  when others then");
    expect(hotfixMigration).toContain("return null;");
    expect(capiMigration).toContain("perform public.nvx_try_dispatch_revops_worker('meta-capi-dispatch', 25, null)");
    expect(whatsappAsyncMigration).toContain("public.nvx_try_dispatch_revops_worker('whatsapp-outbound-worker', 25, null)");
  });

  it("keeps Meta CAPI delivery consent-gated and atomically queued", () => {
    expect(capiMigration).toContain("if v_capture.marketing_consent then");
    expect(capiMigration).toContain("insert into public.meta_capi_outbox (lead_id, event_name, event_id)");
    expect(capiMigration).toContain("'lead:' || v_capture.nvx_lead_id::text");
    expect(capiMigration).toContain("if v_capture.is_test_lead then raise exception 'QA capture cannot be reconciled'; end if;");
  });
});
