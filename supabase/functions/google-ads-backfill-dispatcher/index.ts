import { createClient } from "jsr:@supabase/supabase-js@2";
import { authenticateInternalRequest } from "./auth.ts";

declare const Deno: any;

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").trim();
const SERVICE_ROLE = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
const MAX_RANGE_DAYS = 92;

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function validDate(value: unknown): value is string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function rangeDays(from: string, to: string): number {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply(405, { success: false, message: "Method not allowed" });
  if (!SUPABASE_URL || !SERVICE_ROLE) return reply(500, { success: false, message: "Server configuration error" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const auth = await authenticateInternalRequest(req, async () => {
    const { data, error } = await admin.rpc("nvx_get_runtime_secret", { p_name: "REVOPS_INTERNAL_SECRET" });
    if (error || !data) throw new Error("runtime secret unavailable");
    return String(data);
  });
  if (!auth.ok) return reply(auth.status, { success: false, message: auth.message });

  const body = await req.json().catch(() => ({}));
  const from = String(body?.from || "");
  const to = String(body?.to || "");
  if (!validDate(from) || !validDate(to)) {
    return reply(422, { success: false, message: "Invalid Google Ads date range" });
  }
  const days = rangeDays(from, to);
  if (!Number.isFinite(days) || days < 1 || days > MAX_RANGE_DAYS) {
    return reply(422, { success: false, message: "Invalid Google Ads date range" });
  }

  const response = await fetch(`${SUPABASE_URL}/functions/v1/google-ads-daily-sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to }),
    signal: AbortSignal.timeout(110_000),
  });

  const raw = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(raw);
    payload = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return reply(502, { success: false, message: `Google Ads worker returned non-JSON (HTTP ${response.status})` });
  }

  if (!response.ok || payload.success !== true) {
    return reply(502, {
      success: false,
      provider: payload.provider || "google_ads",
      kind: payload.kind || null,
      message: payload.message || `Google Ads worker failed (HTTP ${response.status})`,
      failures: Array.isArray(payload.failures) ? payload.failures : [],
    });
  }

  return reply(200, payload);
});