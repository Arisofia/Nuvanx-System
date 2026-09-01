import { createClient } from "jsr:@supabase/supabase-js@2";
import { authenticateDispatcherRequest } from "./auth.ts";

declare const Deno: any;

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").trim();
const SERVICE_ROLE = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
const ALLOWED_WORKERS = new Set([
  "web-lead-reconcile",
  "deal-factory",
  "google-data-manager-export",
  "meta-capi-dispatch",
  "whatsapp-outbound-worker",
]);

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply(405, { success: false, message: "Method not allowed" });

  const auth = await authenticateDispatcherRequest(req, async () => {
    if (!SUPABASE_URL || !SERVICE_ROLE) throw new Error("runtime configuration unavailable");

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const { data: expected, error: secretError } = await admin.rpc("nvx_get_runtime_secret", {
      p_name: "REVOPS_INTERNAL_SECRET",
    });
    if (secretError || !expected) throw new Error("runtime secret unavailable");
    return String(expected);
  });
  if (!auth.ok) return reply(auth.status, { success: false, message: auth.message });

  const body = await req.json().catch(() => ({}));
  const worker = String(body?.worker || "").trim();
  if (!ALLOWED_WORKERS.has(worker)) return reply(422, { success: false, message: "Unsupported worker" });
  const requestedLimit = Number(body?.limit || 25);
  const limit = Math.max(1, Math.min(100, Number.isFinite(requestedLimit) ? Math.trunc(requestedLimit) : 25));

  const mode = body?.mode === undefined || body?.mode === null || body?.mode === ""
    ? null
    : String(body.mode).trim();
  if (worker === "google-data-manager-export") {
    if (mode !== null && mode !== "deliver" && mode !== "poll") {
      return reply(422, { success: false, message: "Unsupported Google Data Manager mode" });
    }
  } else if (mode !== null) {
    return reply(422, { success: false, message: "Worker mode is only valid for Google Data Manager" });
  }

  const workerBody: Record<string, unknown> = { limit };
  if (mode !== null) workerBody.mode = mode;

  const response = await fetch(`${SUPABASE_URL}/functions/v1/${worker}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(workerBody),
  });

  if (!response.ok) {
    console.error(`[revops-dispatcher] worker=${worker} status=${response.status}`);
    return reply(502, { success: false, worker, worker_status: response.status });
  }

  return reply(202, { success: true, worker, mode, dispatched: true });
});
