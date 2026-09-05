import { createClient } from "jsr:@supabase/supabase-js@2";
import { authenticateDispatcherRequest } from "./auth.ts";

declare const Deno: any;
declare const EdgeRuntime: any;

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").trim();
const SERVICE_ROLE = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
const WORKER_TIMEOUT_MS = 30_000;

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function invokeWorker(worker: string, workerBody: Record<string, unknown>): Promise<void> {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/${worker}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(workerBody),
      signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error(`[revops-dispatcher] worker=${worker} status=${response.status}`);
    }
  } catch (error: any) {
    const kind = String(error?.name || "worker_dispatch_error").slice(0, 80);
    console.error(`[revops-dispatcher] worker=${worker} dispatch_error=${kind}`);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply(405, { success: false, message: "Method not allowed" });
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return reply(500, { success: false, message: "Dispatcher runtime configuration unavailable" });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const auth = await authenticateDispatcherRequest(req, async () => {
    const { data: expected, error: secretError } = await admin.rpc("nvx_get_runtime_secret", {
      p_name: "REVOPS_INTERNAL_SECRET",
    });
    if (secretError || !expected) throw new Error("runtime secret unavailable");
    return String(expected);
  });
  if (!auth.ok) return reply(auth.status, { success: false, message: auth.message });

  const body = await req.json().catch(() => ({}));
  const worker = String(body?.worker || "").trim();

  const { data: workerConfig, error: workerError } = await admin
    .from("revops_worker_registry")
    .select("worker, allows_mode")
    .eq("worker", worker)
    .eq("enabled", true)
    .maybeSingle();

  if (workerError) {
    console.error(`[revops-dispatcher] worker registry unavailable code=${String(workerError.code || "unknown")}`);
    return reply(503, { success: false, message: "Worker registry unavailable" });
  }
  if (!workerConfig) return reply(422, { success: false, message: "Unsupported worker" });

  const requestedLimit = Number(body?.limit || 25);
  const limit = Math.max(1, Math.min(100, Number.isFinite(requestedLimit) ? Math.trunc(requestedLimit) : 25));

  const mode = body?.mode === undefined || body?.mode === null || body?.mode === ""
    ? null
    : String(body.mode).trim();
  if (mode !== null && workerConfig.allows_mode !== true) {
    return reply(422, { success: false, message: "Worker mode is not supported for this worker" });
  }
  if (worker === "google-data-manager-export" && mode !== null && mode !== "deliver" && mode !== "poll") {
    return reply(422, { success: false, message: "Unsupported Google Data Manager mode" });
  }

  const workerBody: Record<string, unknown> = { limit };
  if (mode !== null) workerBody.mode = mode;

  const workerRequest = invokeWorker(worker, workerBody);
  if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime?.waitUntil === "function") {
    EdgeRuntime.waitUntil(workerRequest);
  } else {
    await workerRequest;
  }

  return reply(202, { success: true, worker, mode, dispatched: true });
});
