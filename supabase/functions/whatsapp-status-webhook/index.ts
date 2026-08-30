import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const VERIFY_TOKEN = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN") || Deno.env.get("WHATSAPP_WEBHOOK_VERIFY_TOKEN") || "";
const APP_SECRET = Deno.env.get("META_CANONICAL_APP_SECRET")
  || Deno.env.get("META_REPORTING_APP_SECRET")
  || Deno.env.get("META_APP_SECRET")
  || "";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256Hex(secret: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  return bytesToHex(new Uint8Array(signature));
}

function timingSafeEqualHex(left: string, right: string): boolean {
  if (left.length !== right.length || !/^[0-9a-f]+$/i.test(left) || !/^[0-9a-f]+$/i.test(right)) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

async function verifyMetaSignature(req: Request, rawBody: string): Promise<boolean> {
  if (!APP_SECRET) return false;
  const header = String(req.headers.get("x-hub-signature-256") || "").trim();
  if (!header.startsWith("sha256=")) return false;
  const received = header.slice(7).toLowerCase();
  const expected = await hmacSha256Hex(APP_SECRET, rawBody);
  return timingSafeEqualHex(received, expected);
}

function eventTime(timestamp: unknown): string {
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || seconds <= 0) return new Date().toISOString();
  return new Date(seconds * 1000).toISOString();
}

function extractStatuses(payload: any): any[] {
  const statuses: any[] = [];
  for (const entry of Array.isArray(payload?.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const valueStatuses = Array.isArray(change?.value?.statuses) ? change.value.statuses : [];
      statuses.push(...valueStatuses);
    }
  }
  return statuses;
}

Deno.serve(async (req: Request) => {
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode") || "";
    const token = url.searchParams.get("hub.verify_token") || "";
    const challenge = url.searchParams.get("hub.challenge") || "";
    if (mode === "subscribe" && VERIFY_TOKEN && token === VERIFY_TOKEN && challenge) {
      return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
    }
    return new Response("verification failed", { status: 403, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
  }

  if (req.method !== "POST") return json({ success: false, message: "GET or POST required" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE || !APP_SECRET) {
    return json({ success: false, message: "Webhook runtime configuration incomplete" }, 503);
  }

  const rawBody = await req.text();
  if (!(await verifyMetaSignature(req, rawBody))) {
    return json({ success: false, message: "Invalid Meta webhook signature" }, 401);
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ success: false, message: "Invalid JSON" }, 400);
  }

  const statuses = extractStatuses(payload);
  if (statuses.length === 0) return json({ success: true, received: 0, applied: 0, ignored: 0 });

  const admin: any = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let applied = 0;
  let ignored = 0;

  for (const item of statuses.slice(0, 100)) {
    const messageId = String(item?.id || "").trim();
    const status = String(item?.status || "").trim().toLowerCase();
    if (!messageId || !["sent", "delivered", "read", "failed"].includes(status)) {
      ignored += 1;
      continue;
    }

    const providerError = Array.isArray(item?.errors) ? item.errors[0] : null;
    const { data, error } = await admin.rpc("nvx_apply_whatsapp_status", {
      p_provider_message_id: messageId,
      p_status: status,
      p_event_at: eventTime(item?.timestamp),
      p_error_code: providerError?.code === undefined || providerError?.code === null ? null : String(providerError.code),
      p_error_message: providerError?.title || providerError?.message || providerError?.error_data?.details || null,
    });

    if (error || data !== true) ignored += 1;
    else applied += 1;
  }

  return json({ success: true, received: Math.min(statuses.length, 100), applied, ignored });
});
