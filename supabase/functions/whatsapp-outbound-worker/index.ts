import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendWhatsAppText } from "../_shared/whatsapp-provider.ts";

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").trim();
const SERVICE_ROLE = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
const PROVIDER_TIMEOUT_MS = 10_000;
const MAX_CLAIM_LIMIT = 3;

type ClaimRow = {
  request_id: string;
  user_id: string;
  lead_id: string;
  normalized_phone: string;
  message_sha256: string;
  ciphertext: string;
  iv: string;
  key_version: string;
  claim_token: string;
  claim_attempts: number;
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function bearerToken(req: Request): string {
  const value = String(req.headers.get("Authorization") || "").trim();
  return value.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : "";
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

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function loadKeyring(): Record<string, string> {
  const raw = (Deno.env.get("WHATSAPP_QUEUE_KEYRING") || "").trim();
  if (!raw) throw new Error("queue_keyring_unavailable");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("queue_keyring_invalid");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("queue_keyring_invalid");
  }
  return parsed as Record<string, string>;
}

async function decryptMessage(row: ClaimRow, keyring: Record<string, string>): Promise<string> {
  const encodedKey = String(keyring[row.key_version] || "").trim();
  if (!encodedKey) throw new Error("queue_key_version_unavailable");

  const keyBytes = base64ToBytes(encodedKey);
  if (keyBytes.byteLength !== 32) throw new Error("queue_key_invalid_length");

  const key = await crypto.subtle.importKey(
    "raw",
    ownedArrayBuffer(keyBytes),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const iv = base64ToBytes(row.iv);
  if (iv.byteLength !== 12) throw new Error("queue_iv_invalid");

  const aad = new TextEncoder().encode(`nvx-whatsapp-v1:${row.lead_id}:${row.message_sha256}`);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ownedArrayBuffer(iv), additionalData: ownedArrayBuffer(aad), tagLength: 128 },
    key,
    ownedArrayBuffer(base64ToBytes(row.ciphertext)),
  );
  const decoded = new TextDecoder().decode(plaintext);
  if (!decoded || decoded.length > 4096) throw new Error("queue_payload_invalid");
  return decoded;
}

async function finalizeSend(
  admin: any,
  row: ClaimRow,
  status: "accepted" | "failed" | "unknown",
  providerMessageId: string | null,
  providerHttpStatus: number | null,
  errorCode: string | null,
  errorMessage: string | null,
): Promise<boolean> {
  const { data, error } = await admin.rpc("nvx_finalize_whatsapp_send", {
    p_request_id: row.request_id,
    p_user_id: row.user_id,
    p_status: status,
    p_provider_message_id: providerMessageId,
    p_provider_http_status: providerHttpStatus,
    p_provider_error_code: errorCode,
    p_provider_error_message: errorMessage,
  });
  return !error && data === true;
}

async function finishPayload(admin: any, row: ClaimRow, manualReview: boolean): Promise<boolean> {
  const { data, error } = await admin.rpc("nvx_finish_whatsapp_outbound_payload", {
    p_request_id: row.request_id,
    p_claim_token: row.claim_token,
    p_manual_review: manualReview,
  });
  return !error && data === true;
}

async function markSending(admin: any, row: ClaimRow): Promise<boolean> {
  const { data, error } = await admin.rpc("nvx_mark_whatsapp_payload_sending", {
    p_request_id: row.request_id,
    p_claim_token: row.claim_token,
  });
  return !error && data === true;
}

async function trackFirstHumanResponse(admin: any, row: ClaimRow, messageId: string) {
  try {
    const sentAt = new Date().toISOString();
    const { data: slaRows, error: slaError } = await admin.rpc("mark_lead_human_first_response", {
      p_lead_id: row.lead_id,
      p_user_id: row.user_id,
      p_sent_at: sentAt,
    });
    if (slaError || !Array.isArray(slaRows) || slaRows.length !== 1) return;

    const firstResponseAt = String(slaRows[0]?.first_response_at || "") || null;
    await admin.from("lead_events").insert({
      lead_id: row.lead_id,
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
  } catch {
    // Provider acceptance is authoritative. Telemetry failure must never trigger a resend.
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply(405, { success: false, message: "POST required" });
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return reply(500, { success: false, message: "Worker runtime configuration unavailable" });
  }
  if (bearerToken(req) !== SERVICE_ROLE) {
    return reply(401, { success: false, message: "Service-role authorization required" });
  }

  const accessToken = (Deno.env.get("WHATSAPP_ACCESS_TOKEN") || "").trim();
  const phoneNumberId = (Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "").trim();
  const graphVersion = (Deno.env.get("META_GRAPH_VERSION") || "v22.0").trim();
  if (!accessToken || !phoneNumberId) {
    return reply(503, { success: false, message: "WhatsApp provider configuration unavailable" });
  }

  let keyring: Record<string, string>;
  try {
    keyring = loadKeyring();
  } catch {
    return reply(503, { success: false, message: "WhatsApp queue encryption configuration unavailable" });
  }

  const body = await req.json().catch(() => ({}));
  const requestedLimit = Number(body?.limit || MAX_CLAIM_LIMIT);
  const limit = Math.max(
    1,
    Math.min(MAX_CLAIM_LIMIT, Number.isFinite(requestedLimit) ? Math.trunc(requestedLimit) : MAX_CLAIM_LIMIT),
  );

  const admin: any = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: claimed, error: claimError } = await admin.rpc("nvx_claim_whatsapp_outbound_payload", {
    p_limit: limit,
  });
  if (claimError) return reply(500, { success: false, message: "WhatsApp queue claim failed" });

  const rows = (Array.isArray(claimed) ? claimed : []) as ClaimRow[];
  let accepted = 0;
  let failed = 0;
  let unknown = 0;
  let deferred = 0;

  for (const row of rows) {
    let message: string;
    try {
      message = await decryptMessage(row, keyring);
      if (await sha256Hex(message) !== row.message_sha256) {
        throw new Error("message_fingerprint_mismatch");
      }
    } catch {
      // No provider attempt has started. Keep the encrypted claim for bounded stale-claim recovery.
      deferred += 1;
      continue;
    }

    // Once this succeeds, provider delivery is authorized for this claim token. A
    // later stale-sending manual-review transition is not cancellation and can be
    // reconciled by the same claim, but it can never authorize an automatic resend.
    if (!(await markSending(admin, row))) {
      deferred += 1;
      continue;
    }

    const outcome = await sendWhatsAppText({
      accessToken,
      phoneNumberId,
      graphVersion,
      to: row.normalized_phone,
      message,
      timeoutMs: PROVIDER_TIMEOUT_MS,
    });

    if (outcome.status !== "accepted") {
      const manualReview = outcome.status === "unknown";
      const ledgerTracked = await finalizeSend(
        admin,
        row,
        outcome.status,
        outcome.providerMessageId,
        outcome.providerHttpStatus,
        outcome.errorCode,
        outcome.errorMessage,
      );
      if (ledgerTracked) {
        const payloadTracked = await finishPayload(admin, row, manualReview);
        if (!payloadTracked) {
          console.error(`[whatsapp-outbound-worker] payload finalization deferred request=${row.request_id}`);
        }
      }
      if (manualReview) unknown += 1;
      else failed += 1;
      continue;
    }

    const messageId = outcome.providerMessageId;
    if (!messageId) {
      // Shared provider transport classifies this as unknown, but retain a final
      // fail-closed guard in case that contract is changed incorrectly.
      const ledgerTracked = await finalizeSend(
        admin,
        row,
        "unknown",
        null,
        outcome.providerHttpStatus,
        "missing_provider_message_id",
        "Meta returned success without a message id",
      );
      if (ledgerTracked) await finishPayload(admin, row, true);
      unknown += 1;
      continue;
    }

    const ledgerTracked = await finalizeSend(
      admin,
      row,
      "accepted",
      messageId,
      outcome.providerHttpStatus,
      null,
      null,
    );
    if (ledgerTracked) {
      const payloadTracked = await finishPayload(admin, row, false);
      if (!payloadTracked) {
        console.error(`[whatsapp-outbound-worker] late payload reconciliation pending request=${row.request_id}`);
      }
      accepted += 1;
      await trackFirstHumanResponse(admin, row, messageId);
    } else {
      // Provider may have accepted the send. Keep the sending row for stale/manual reconciliation.
      unknown += 1;
    }
  }

  return reply(200, {
    success: true,
    claimed: rows.length,
    accepted,
    failed,
    unknown,
    deferred,
  });
});
