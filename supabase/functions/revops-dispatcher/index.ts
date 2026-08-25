import { createClient } from "jsr:@supabase/supabase-js@2";

declare const Deno: any;

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").trim();
const SERVICE_ROLE = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
const ALLOWED_WORKERS = new Set(["web-lead-reconcile", "deal-factory", "google-data-manager-export"]);

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function sha256Bytes(raw: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)));
}

async function secretMatches(received: string, expected: string): Promise<boolean> {
  const normalizedReceived = String(received || "").trim();
  const normalizedExpected = String(expected || "").trim();
  if (!normalizedReceived || !normalizedExpected) return false;
  const a = await sha256Bytes(normalizedReceived);
  const b = await sha256Bytes(normalizedExpected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply(405, { success: false, message: "Method not allowed" });

  // Reject anonymous/malformed calls before creating a privileged client or
  // touching Vault. Wrong-but-present secrets still use the constant-time
  // comparison below so the authentication contract is unchanged.
  const received = String(req.headers.get("x-nvx-internal-secret") || "").trim();
  if (!received) return reply(403, { success: false, message: "Forbidden" });

  if (!SUPABASE_URL || !SERVICE_ROLE) return reply(500, { success: false, message: "Server configuration error" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data: expected, error: secretError } = await admin.rpc("nvx_get_runtime_secret", {
    p_name: "REVOPS_INTERNAL_SECRET",
  });
  if (secretError || !expected) return reply(500, { success: false, message: "Server configuration error" });

  if (!(await secretMatches(received, String(expected)))) return reply(403, { success: false, message: "Forbidden" });

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
