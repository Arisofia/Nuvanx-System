import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const VERIFY_TOKEN = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN") || Deno.env.get("WHATSAPP_WEBHOOK_VERIFY_TOKEN") || "";
const TEST_VERIFY_TOKEN = Deno.env.get("WHATSAPP_TEST_WEBHOOK_VERIFY_TOKEN") || "";
const APP_SECRET = Deno.env.get("META_CANONICAL_APP_SECRET")
  || Deno.env.get("META_REPORTING_APP_SECRET")
  || Deno.env.get("META_APP_SECRET")
  || "";
const TEST_APP_SECRET = Deno.env.get("WHATSAPP_TEST_APP_SECRET") || "";

type SignatureScope = "production" | "test";

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

async function verifyMetaSignature(req: Request, rawBody: string): Promise<SignatureScope | null> {
  const header = String(req.headers.get("x-hub-signature-256") || "").trim();
  if (!header.startsWith("sha256=")) return null;
  const received = header.slice(7).toLowerCase();

  if (APP_SECRET) {
    const expectedProduction = await hmacSha256Hex(APP_SECRET, rawBody);
    if (timingSafeEqualHex(received, expectedProduction)) return "production";
  }
  if (TEST_APP_SECRET) {
    const expectedTest = await hmacSha256Hex(TEST_APP_SECRET, rawBody);
    if (timingSafeEqualHex(received, expectedTest)) return "test";
  }
  return null;
}

function eventTime(timestamp: unknown): string {
  const seconds = Number(timestamp);
  // Date supports ±8.64e15 milliseconds. Reject out-of-range provider values before toISOString().
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 8.64e12) return new Date().toISOString();
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
    const verifiedToken = (VERIFY_TOKEN && token === VERIFY_TOKEN)
      || (TEST_VERIFY_TOKEN && token === TEST_VERIFY_TOKEN);
    if (mode === "subscribe" && verifiedToken && challenge) {
      return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
    }
    return new Response("verification failed", { status: 403, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
  }

  if (req.method !== "POST") return json({ success: false, message: "GET or POST required" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE || (!APP_SECRET && !TEST_APP_SECRET)) {
    return json({ success: false, message: "Webhook runtime configuration incomplete" }, 503);
  }

  const rawBody = await req.text();
  const signatureScope = await verifyMetaSignature(req, rawBody);
  if (!signatureScope) {
    return json({ success: false, message: "Invalid Meta webhook signature" }, 401);
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ success: false, message: "Invalid JSON" }, 400);
  }

  const statuses = extractStatuses(payload);
  if (statuses.length === 0) return json({ success: true, received: 0, applied: 0, ignored: 0, failed: 0 });

  const admin: any = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let applied = 0;
  let ignored = 0;
  let failed = 0;

  // Process the complete signed Meta batch. Production signatures may reconcile
  // either namespace because Test WABA can share the canonical Meta app. A distinct
  // test-app signature is intentionally restricted to the acceptance namespace and
  // can never mutate patient delivery state.
  for (const item of statuses) {
    const messageId = String(item?.id || "").trim();
    const status = String(item?.status || "").trim().toLowerCase();
    if (!messageId || !["sent", "delivered", "read", "failed"].includes(status)) {
      ignored += 1;
      continue;
    }

    const providerError = Array.isArray(item?.errors) ? item.errors[0] : null;
    const args = {
      p_provider_message_id: messageId,
      p_status: status,
      p_event_at: eventTime(item?.timestamp),
      p_error_code: providerError?.code === undefined || providerError?.code === null ? null : String(providerError.code),
      p_error_message: providerError?.title || providerError?.message || providerError?.error_data?.details || null,
    };

    let persisted = false;
    let persistenceFailed = false;

    if (signatureScope === "production") {
      const { data, error } = await admin.rpc("nvx_apply_whatsapp_status", args);
      if (error) persistenceFailed = true;
      else if (data === true) persisted = true;
    }

    if (!persisted && !persistenceFailed) {
      const { data, error } = await admin.rpc("nvx_apply_whatsapp_provider_acceptance_status", args);
      if (error) persistenceFailed = true;
      else if (data === true) persisted = true;
    }

    if (persistenceFailed) failed += 1;
    else if (persisted) applied += 1;
    else ignored += 1;
  }

  if (failed > 0) {
    return json({
      success: false,
      received: statuses.length,
      applied,
      ignored,
      failed,
      message: "One or more delivery statuses could not be persisted; Meta should retry the signed batch",
    }, 503);
  }

  return json({ success: true, received: statuses.length, applied, ignored, failed: 0 });
});
