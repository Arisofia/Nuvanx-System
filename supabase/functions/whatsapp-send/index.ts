import { createClient } from "jsr:@supabase/supabase-js@2";
import { ALLOWED_CORS_ORIGINS } from "../_shared/config.ts";

const corsBase = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function corsHeaders(origin: string | null): Record<string, string> {
  return origin && ALLOWED_CORS_ORIGINS.has(origin)
    ? { ...corsBase, "Access-Control-Allow-Origin": origin }
    : { ...corsBase };
}

function isDisallowedBrowserOrigin(origin: string | null): boolean {
  return Boolean(origin && !ALLOWED_CORS_ORIGINS.has(origin));
}

function cleanUuid(value: unknown): string | null {
  const v = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v) ? v : null;
}

function normalizePhone(value: unknown): string {
  const raw = String(value || "").trim();
  const hasLeadingPlus = raw.startsWith("+");
  const digits = raw.replace(/\D/g, "");
  return `${hasLeadingPlus ? "+" : ""}${digits}`;
}

function bearerToken(req: Request): string | null {
  const header = String(req.headers.get("Authorization") || "").trim();
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  return token || null;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((value) => value.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const normalized = value.trim().replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function loadActiveQueueKey(): { version: string; keyBytes: Uint8Array } {
  const raw = (Deno.env.get("WHATSAPP_QUEUE_KEYRING") || "").trim();
  const activeVersion = (Deno.env.get("WHATSAPP_QUEUE_ACTIVE_KEY_VERSION") || "").trim();
  if (!raw || !/^[A-Za-z0-9._-]{1,64}$/.test(activeVersion)) throw new Error("queue_encryption_unavailable");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("queue_encryption_unavailable");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("queue_encryption_unavailable");

  const encoded = String((parsed as Record<string, unknown>)[activeVersion] || "").trim();
  if (!encoded) throw new Error("queue_encryption_unavailable");
  const keyBytes = base64ToBytes(encoded);
  if (keyBytes.byteLength !== 32) throw new Error("queue_encryption_unavailable");
  return { version: activeVersion, keyBytes };
}

async function encryptMessage(message: string, leadId: string, messageSha256: string) {
  const active = loadActiveQueueKey();
  const key = await crypto.subtle.importKey("raw", ownedArrayBuffer(active.keyBytes), { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(`nvx-whatsapp-v1:${leadId}:${messageSha256}`);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
    key,
    new TextEncoder().encode(message),
  );
  return {
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    iv: bytesToBase64(iv),
    keyVersion: active.version,
  };
}

async function authenticatedContext(req: Request): Promise<{ ok: true; admin: any; userId: string } | { ok: false; status: number; message: string }> {
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return { ok: false, status: 500, message: "WhatsApp authorization is not configured" };
  }

  const token = bearerToken(req);
  if (!token) return { ok: false, status: 401, message: "Authenticated user context is required" };

  try {
    const admin: any = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    const userId = String(authData?.user?.id || "");
    if (authError || !userId) return { ok: false, status: 401, message: "Authenticated user context is invalid" };
    return { ok: true, admin, userId };
  } catch {
    return { ok: false, status: 500, message: "WhatsApp authorization failed" };
  }
}

async function prepareSendAsync(
  admin: any,
  userId: string,
  leadId: string,
  normalizedTo: string,
  idempotencyKey: string,
  messageSha256: string,
  ciphertext: string,
  iv: string,
  keyVersion: string,
): Promise<{ ok: true; row: any } | { ok: false; status: number; message: string }> {
  const { data, error } = await admin.rpc("nvx_prepare_whatsapp_send_async", {
    p_user_id: userId,
    p_lead_id: leadId,
    p_normalized_phone: normalizedTo,
    p_idempotency_key: idempotencyKey,
    p_message_sha256: messageSha256,
    p_ciphertext: ciphertext,
    p_iv: iv,
    p_key_version: keyVersion,
  });

  if (error) {
    const code = String(error.code || "");
    const message = String(error.message || "WhatsApp send reservation failed");
    if (code === "42501" || message.includes("lead_not_owned")) {
      return { ok: false, status: 403, message: "Lead is not available to this user" };
    }
    if (code === "23505" || message.includes("idempotency_key_conflict")) {
      return { ok: false, status: 409, message: "Idempotency key was already used for another send intent" };
    }
    if (message.includes("recipient_does_not_match_lead_phone")) {
      return { ok: false, status: 403, message: "Recipient does not match the lead phone" };
    }
    if (message.includes("whatsapp_direct_disabled")) {
      return { ok: false, status: 503, message: "Direct WhatsApp is disabled until controlled delivery acceptance is complete" };
    }
    return { ok: false, status: 500, message: "WhatsApp send reservation failed" };
  }

  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return { ok: false, status: 500, message: "WhatsApp send reservation returned no decision" };
  return { ok: true, row };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const cors = corsHeaders(origin);
  const json = (data: unknown, status = 200, extraHeaders: Record<string, string> = {}) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store", ...extraHeaders },
    });

  if (req.method === "OPTIONS") {
    if (isDisallowedBrowserOrigin(origin)) return json({ success: false, message: "Origin not allowed" }, 403);
    return new Response(null, { status: 204, headers: cors });
  }
  if (isDisallowedBrowserOrigin(origin)) return json({ success: false, message: "Origin not allowed" }, 403);
  if (req.method !== "POST") return json({ success: false, message: "POST required" }, 405);

  const body = await req.json().catch(() => ({}));
  const normalizedTo = normalizePhone(body?.to);
  const message = String(body?.message || "").trim();
  const leadId = cleanUuid(body?.lead_id);
  const idempotencyKey = String(body?.idempotency_key || "").trim();

  if (!normalizedTo || !message) return json({ success: false, message: "to and message are required" }, 400);
  if (!leadId) return json({ success: false, message: "lead_id is required and must be a UUID" }, 400);
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) return json({ success: false, message: "idempotency_key is required" }, 400);
  if (message.length > 4096) return json({ success: false, message: "message is too long" }, 400);
  if (!/^\+?[1-9]\d{7,14}$/.test(normalizedTo)) {
    return json({ success: false, message: "to must be a valid phone number in E.164 format (+34XXXXXXXXX)" }, 400);
  }

  const auth = await authenticatedContext(req);
  if (!auth.ok) return json({ success: false, message: auth.message }, auth.status);

  const messageSha256 = await sha256Hex(message);

  // Read-only replay lookup: never consumes a reservation before ciphertext is ready.
  // Scope the service-role query to the authenticated user and verify the original
  // recipient/message fingerprint before returning an idempotent result.
  const { data: idempotencyRows, error: idempotencyError } = await auth.admin
    .from("whatsapp_send_requests")
    .select("id, status, provider_message_id, message_sha256, normalized_phone")
    .eq("user_id", auth.userId)
    .eq("idempotency_key", idempotencyKey)
    .eq("lead_id", leadId)
    .limit(1);

  if (idempotencyError) {
    return json({ success: false, message: "WhatsApp idempotency lookup failed" }, 500);
  }

  if (Array.isArray(idempotencyRows) && idempotencyRows.length > 0) {
    const row = idempotencyRows[0];
    if (String(row.message_sha256 || "") !== messageSha256 || normalizePhone(row.normalized_phone) !== normalizedTo) {
      return json({ success: false, message: "Idempotency key was already used for another send intent" }, 409);
    }

    const requestStatus = String(row.status || "");
    const requestId = String(row.id || "");
    const priorMessageId = String(row.provider_message_id || "") || null;

    if (["accepted", "sent", "delivered", "read"].includes(requestStatus)) {
      return json({
        success: true,
        idempotentReplay: true,
        requestId,
        messageId: priorMessageId,
        providerStatus: requestStatus,
        message: "This send intent was already accepted by Meta",
      });
    }
    if (requestStatus === "reserved") {
      return json({
        success: true,
        queued: true,
        pending: true,
        idempotentReplay: true,
        requestId,
        providerStatus: "queued",
        message: "This send intent is already queued for asynchronous delivery",
      }, 202);
    }
    if (requestStatus === "unknown") {
      return json({
        success: true,
        pending: true,
        idempotentReplay: true,
        requestId,
        providerStatus: "unknown",
        message: "This send intent has an unresolved provider outcome; it will not be sent again automatically",
      }, 202);
    }
    return json({
      success: false,
      idempotentReplay: true,
      requestId,
      providerStatus: requestStatus || "failed",
      message: "This send intent already failed. Create a new send intent only after reviewing the failure.",
    }, 409);
  }

  let encrypted: { ciphertext: string; iv: string; keyVersion: string };
  try {
    encrypted = await encryptMessage(message, leadId, messageSha256);
  } catch {
    return json({ success: false, message: "WhatsApp queue encryption is not configured" }, 503);
  }

  const prepared = await prepareSendAsync(
    auth.admin,
    auth.userId,
    leadId,
    normalizedTo,
    idempotencyKey,
    messageSha256,
    encrypted.ciphertext,
    encrypted.iv,
    encrypted.keyVersion,
  );
  if (!prepared.ok) return json({ success: false, message: prepared.message }, prepared.status);

  const decision = String(prepared.row?.decision || "");
  const requestStatus = String(prepared.row?.request_status || "");
  const requestId = String(prepared.row?.request_id || "");
  const priorMessageId = String(prepared.row?.provider_message_id || "") || null;
  const retryAfter = Math.max(0, Number(prepared.row?.retry_after_seconds || 0));

  if (decision === "rate_limited") {
    return json(
      { success: false, rateLimited: true, retryAfterSeconds: retryAfter, message: "WhatsApp rate limit reached for this lead or clinic" },
      429,
      { "Retry-After": String(retryAfter || 60) },
    );
  }

  if (decision === "duplicate") {
    if (["accepted", "sent", "delivered", "read"].includes(requestStatus)) {
      return json({
        success: true,
        idempotentReplay: true,
        requestId,
        messageId: priorMessageId,
        providerStatus: requestStatus,
        message: "This send intent was already accepted by Meta",
      });
    }
    if (requestStatus === "reserved") {
      // Check if this reserved request has an encrypted payload for the async worker.
      // Pre-existing reserved requests from the synchronous implementation may not have
      // a payload row and should be marked for reconciliation instead of reported as queued.
      let hasPayload = false;
      try {
        const { data: payloadRows, error: payloadError } = await auth.admin
          .from("whatsapp_outbound_payloads")
          .select("state")
          .eq("request_id", requestId)
          .limit(1);

        if (!payloadError) {
          hasPayload = Array.isArray(payloadRows) && payloadRows.length > 0;
        } else if (payloadError.code === "42P01" || payloadError.message?.includes("does not exist")) {
          // Table doesn't exist yet (fresh or pre-migration deployment)
          hasPayload = false;
        } else {
          return json({ success: false, message: `Database error checking outbound payload: ${payloadError.message}` }, 500);
        }
      } catch (error: any) {
        if (error?.code === "42P01" || error?.message?.includes("does not exist")) {
          hasPayload = false;
        } else {
          return json({ success: false, message: "Unexpected error checking outbound payload" }, 500);
        }
      }

      if (!hasPayload) {
        return json({
          success: false,
          idempotentReplay: true,
          requestId,
          providerStatus: "reconciliation_required",
          message: "This send intent is reserved but has no encrypted payload for async delivery. Manual reconciliation is required.",
        }, 503);
      }

      return json({
        success: true,
        queued: true,
        pending: true,
        idempotentReplay: true,
        requestId,
        providerStatus: "queued",
        message: "This send intent is already queued for asynchronous delivery",
      }, 202);
    }
    if (requestStatus === "unknown") {
      return json({
        success: true,
        pending: true,
        idempotentReplay: true,
        requestId,
        providerStatus: "unknown",
        message: "This send intent has an unresolved provider outcome; it will not be sent again automatically",
      }, 202);
    }
    return json({
      success: false,
      idempotentReplay: true,
      requestId,
      providerStatus: requestStatus || "failed",
      message: "This send intent already failed. Create a new send intent only after reviewing the failure.",
    }, 409);
  }

  if (!requestId) return json({ success: false, message: "WhatsApp request ledger did not return a request id" }, 500);

  return json({
    success: true,
    queued: true,
    pending: true,
    requestId,
    providerStatus: "queued",
    message: "Solicitud cifrada y en cola. La aceptación y la entrega de Meta se confirmarán de forma asíncrona.",
  }, 202);
});