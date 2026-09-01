import { createClient } from "jsr:@supabase/supabase-js@2";
import { ALLOWED_CORS_ORIGINS } from "../_shared/config.ts";

const corsBase = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const PROVIDER_TIMEOUT_MS = 10_000;

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

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function providerError(data: any): { code: string | null; message: string } {
  const error = data?.error || data?.errors?.[0] || null;
  return {
    code: error?.code === undefined || error?.code === null ? null : String(error.code),
    message: String(error?.message || data?.message || "WhatsApp provider error").slice(0, 500),
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

async function prepareSend(
  admin: any,
  userId: string,
  leadId: string,
  normalizedTo: string,
  idempotencyKey: string,
  messageSha256: string,
): Promise<{ ok: true; row: any } | { ok: false; status: number; message: string }> {
  // Use read-only idempotency lookup instead of reserving during precheck
  // This allows replays to work when encryption is unavailable and prevents
  // the async preparation from seeing a "duplicate" reservation
  const { data, error } = await admin.rpc("nvx_check_whatsapp_idempotency", {
    p_user_id: userId,
    p_idempotency_key: idempotencyKey,
  });

  if (error) {
    const code = String(error.code || "");
    const message = String(error.message || "WhatsApp idempotency check failed");
    if (code === "42501" || message.includes("lead_not_owned")) {
      return { ok: false, status: 403, message: "Lead is not available to this user" };
    }
    if (code === "23505" || message.includes("idempotency_key_conflict")) {
      return { ok: false, status: 409, message: "Idempotency key was already used for another send intent" };
    }
    return { ok: false, status: 500, message };
  }

  // If idempotency key exists, return the existing result for replay
  if (data && data.request_id) {
    return { ok: true, row: data };
  }

  // No existing idempotency key - proceed with async preparation which will reserve and insert
  return { ok: true, row: null };
    // SQLSTATE 22023 is shared by multiple validation failures, so preserve the specific message check.
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

async function finalizeSend(
  admin: any,
  userId: string,
  requestId: string,
  status: "accepted" | "failed" | "unknown",
  providerMessageId: string | null,
  providerHttpStatus: number | null,
  errorCode: string | null,
  errorMessage: string | null,
): Promise<boolean> {
  const { data, error } = await admin.rpc("nvx_finalize_whatsapp_send", {
    p_request_id: requestId,
    p_user_id: userId,
    p_status: status,
    p_provider_message_id: providerMessageId,
    p_provider_http_status: providerHttpStatus,
    p_provider_error_code: errorCode,
    p_provider_error_message: errorMessage,
  });
  return !error && data === true;
}

async function trackFirstHumanResponse(admin: any, userId: string, leadId: string, messageId: string) {
  try {
    const sentAt = new Date().toISOString();
    const { data: slaRows, error: slaError } = await admin.rpc("mark_lead_human_first_response", {
      p_lead_id: leadId,
      p_user_id: userId,
      p_sent_at: sentAt,
    });
    if (slaError || !Array.isArray(slaRows) || slaRows.length !== 1) {
      return { tracked: false, reason: "lead_update_failed" };
    }

    const firstResponseAt = String(slaRows[0]?.first_response_at || "") || null;
    const { error: eventError } = await admin.from("lead_events").insert({
      lead_id: leadId,
      source_platform: "whatsapp",
      source_channel: "direct",
      channel_label: "WhatsApp",
      event_type: "outbound_response",
      event_created_at: sentAt,
      captured_at: sentAt,
      resolution_status: "accepted",
      raw_payload: {
        message_id: messageId,
        actor: "human_authenticated",
        provider_status: "accepted",
        sla_first_response_at: firstResponseAt,
      },
    });

    if (eventError) {
      return { tracked: true, event_recorded: false, reason: "event_insert_failed", first_response_at: firstResponseAt };
    }
    return { tracked: true, event_recorded: true, first_response_at: firstResponseAt };
  } catch {
    return { tracked: false, reason: "tracking_failed" };
  }
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
    if (isDisallowedBrowserOrigin(origin)) {
      return json({ success: false, message: "Origin not allowed" }, 403);
    }
    return new Response(null, { status: 204, headers: cors });
  }

  if (isDisallowedBrowserOrigin(origin)) {
    return json({ success: false, message: "Origin not allowed" }, 403);
  }

  if (req.method !== "POST") return json({ success: false, message: "POST required" }, 405);

  const body = await req.json().catch(() => ({}));
  const normalizedTo = normalizePhone(body?.to);
  const message = String(body?.message || "").trim();
  const leadId = cleanUuid(body?.lead_id);
  const idempotencyKey = String(body?.idempotency_key || "").trim();

  if (!normalizedTo || !message) return json({ success: false, message: "to and message are required" }, 400);
  if (!leadId) return json({ success: false, message: "lead_id is required and must be a UUID" }, 400);
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) {
    return json({ success: false, message: "idempotency_key is required" }, 400);
  }
  if (message.length > 4096) return json({ success: false, message: "message is too long" }, 400);
  if (!/^\+?[1-9]\d{7,14}$/.test(normalizedTo)) {
    return json({ success: false, message: "to must be a valid phone number in E.164 format (+34XXXXXXXXX)" }, 400);
  }

  const auth = await authenticatedContext(req);
  if (!auth.ok) return json({ success: false, message: auth.message }, auth.status);

  const messageSha256 = await sha256Hex(message);
  const prepared = await prepareSend(auth.admin, auth.userId, leadId, normalizedTo, idempotencyKey, messageSha256);
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
    if (["reserved", "unknown"].includes(requestStatus)) {
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

  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
  const graphVersion = Deno.env.get("META_GRAPH_VERSION") ?? "v22.0";

  if (!accessToken || !phoneNumberId) {
    await finalizeSend(auth.admin, auth.userId, requestId, "failed", null, null, "configuration_required", "WhatsApp not configured");
    return json({ success: false, requestId, message: "WhatsApp not configured" }, 503);
  }

  let waRes: Response;
  let waData: any = {};
  try {
    waRes = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: normalizedTo,
        type: "text",
        text: { preview_url: false, body: message },
      }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    waData = await waRes.json().catch(() => ({}));
  } catch (error: unknown) {
    // A transport failure is ambiguous: persist UNKNOWN and never automatically replay this intent.
    const reason = error instanceof Error ? error.name : "provider_transport_error";
    await finalizeSend(auth.admin, auth.userId, requestId, "unknown", null, null, reason, "Meta provider outcome is unknown after transport failure");
    return json({
      success: false,
      pending: true,
      requestId,
      providerStatus: "unknown",
      message: `Meta provider outcome is unknown (${reason}); this send intent will not be resent automatically`,
    }, 504);
  }

  const explicitProviderError = Boolean(waData?.error || waData?.success === false);
  const messageId = String(waData?.messages?.[0]?.id || "").trim() || null;

  if (!waRes.ok || explicitProviderError) {
    const provider = providerError(waData);
    const ambiguous = waRes.status >= 500;
    await finalizeSend(
      auth.admin,
      auth.userId,
      requestId,
      ambiguous ? "unknown" : "failed",
      null,
      waRes.status,
      provider.code,
      provider.message,
    );
    return json({
      success: false,
      pending: ambiguous,
      requestId,
      providerStatus: ambiguous ? "unknown" : "failed",
      providerHttpStatus: waRes.status,
      providerErrorCode: provider.code,
      message: ambiguous
        ? "Meta returned a server error; provider outcome is unknown and this send intent will not be resent automatically"
        : provider.message,
    }, ambiguous ? 502 : Math.max(400, waRes.status));
  }

  if (!messageId) {
    // A 2xx without a provider message id is not proof of acceptance and must not become replayable.
    await finalizeSend(auth.admin, auth.userId, requestId, "unknown", null, waRes.status, "missing_provider_message_id", "Meta returned success without a message id");
    return json({
      success: false,
      pending: true,
      requestId,
      providerStatus: "unknown",
      message: "Meta returned success without a message id; provider outcome is unknown and this send intent will not be resent automatically",
    }, 502);
  }

  const ledgerTracked = await finalizeSend(auth.admin, auth.userId, requestId, "accepted", messageId, waRes.status, null, null);
  const sla = await trackFirstHumanResponse(auth.admin, auth.userId, leadId, messageId);

  return json({
    success: true,
    requestId,
    messageId,
    to: normalizedTo,
    providerStatus: "accepted",
    delivered: false,
    ledgerTracked,
    slaTracked: sla.tracked,
    slaEventRecorded: sla.event_recorded === true,
    slaFirstResponseAt: sla.first_response_at || null,
    slaTrackingReason: sla.tracked && sla.event_recorded !== false ? null : sla.reason || null,
    message: ledgerTracked
      ? "Message accepted by Meta; delivery status is pending webhook confirmation"
      : "Message accepted by Meta, but ledger persistence needs reconciliation; do not resend",
  });
});
