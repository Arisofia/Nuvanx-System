import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendWhatsAppText } from "../_shared/whatsapp-provider.ts";

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").trim();
const SERVICE_ROLE = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
const TEST_ACCESS_TOKEN = (Deno.env.get("WHATSAPP_TEST_ACCESS_TOKEN") || "").trim();
const TEST_PHONE_NUMBER_ID = (Deno.env.get("WHATSAPP_TEST_PHONE_NUMBER_ID") || "").trim();
const TEST_RECIPIENT = (Deno.env.get("WHATSAPP_TEST_RECIPIENT") || "").trim();
const TEST_GRAPH_VERSION = (Deno.env.get("WHATSAPP_TEST_GRAPH_VERSION") || Deno.env.get("META_GRAPH_VERSION") || "v22.0").trim();
const ACCEPTANCE_ENABLED = (Deno.env.get("WHATSAPP_TEST_ACCEPTANCE_ENABLED") || "").trim().toLowerCase() === "true";
const ACCEPTANCE_MESSAGE = "NUVANX WhatsApp provider acceptance - controlled test message. No patient data.";

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function normalizeRecipient(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

async function secretMatches(received: string, expected: string): Promise<boolean> {
  const left = String(received || "").trim();
  const right = String(expected || "").trim();
  if (!left || !right) return false;
  const [a, b] = await Promise.all([sha256Hex(left), sha256Hex(right)]);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply(405, { success: false, message: "POST required" });
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return reply(500, { success: false, message: "Server configuration unavailable" });
  }

  const admin: any = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const receivedInternalSecret = String(req.headers.get("x-nvx-internal-secret") || "").trim();
  const { data: expectedInternalSecret, error: internalSecretError } = await admin.rpc("nvx_get_runtime_secret", {
    p_name: "REVOPS_INTERNAL_SECRET",
  });
  if (internalSecretError || !expectedInternalSecret) {
    return reply(500, { success: false, message: "Internal authorization configuration unavailable" });
  }
  if (!(await secretMatches(receivedInternalSecret, String(expectedInternalSecret)))) {
    return reply(401, { success: false, message: "Unauthorized" });
  }

  if (!ACCEPTANCE_ENABLED) {
    return reply(503, { success: false, message: "Test WABA acceptance is disabled" });
  }
  if (!TEST_ACCESS_TOKEN || !TEST_PHONE_NUMBER_ID || !TEST_RECIPIENT) {
    return reply(503, { success: false, message: "Test WABA provider configuration unavailable" });
  }

  const normalizedRecipient = normalizeRecipient(TEST_RECIPIENT);
  if (!/^\d{8,15}$/.test(normalizedRecipient)) {
    return reply(503, { success: false, message: "Controlled Test WABA recipient configuration is invalid" });
  }

  const body: unknown = await req.json().catch(() => ({}));
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return reply(400, { success: false, message: "Invalid request body" });
  }
  const { confirm, idempotencyKey } = body as Record<string, unknown>;
  if (confirm !== "TEST_WABA") {
    return reply(400, { success: false, message: "Literal TEST_WABA confirmation required" });
  }
  if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) {
    return reply(400, { success: false, message: "Valid idempotencyKey required" });
  }

  const [recipientSha256, messageSha256] = await Promise.all([
    sha256Hex(normalizedRecipient),
    sha256Hex(ACCEPTANCE_MESSAGE),
  ]);

  const { data: prepared, error: prepareError } = await admin.rpc("nvx_prepare_whatsapp_provider_acceptance", {
    p_idempotency_key: idempotencyKey,
    p_recipient_sha256: recipientSha256,
    p_message_sha256: messageSha256,
  });
  if (prepareError || !Array.isArray(prepared) || prepared.length !== 1) {
    return reply(prepareError?.code === "55000" ? 429 : 500, {
      success: false,
      message: prepareError?.code === "55000" ? "Test WABA acceptance rate limited" : "Acceptance reservation failed",
    });
  }

  const row = prepared[0] || {};
  const runId = String(row.run_id || "");
  const decision = String(row.decision || "");
  const priorStatus = String(row.run_status || "");
  const priorProviderMessageId = String(row.provider_message_id || "") || null;

  if (!runId) return reply(500, { success: false, message: "Acceptance reservation returned no run id" });

  if (decision === "duplicate") {
    return reply(200, {
      success: ["accepted", "sent", "delivered", "read"].includes(priorStatus),
      sent: false,
      duplicate: true,
      runId,
      status: priorStatus,
      providerMessageId: priorProviderMessageId,
    });
  }

  const { data: markedSending, error: markError } = await admin.rpc("nvx_mark_whatsapp_provider_acceptance_sending", {
    p_run_id: runId,
  });
  if (markError || markedSending !== true) {
    return reply(409, {
      success: false,
      sent: false,
      runId,
      message: "Acceptance run could not enter irreversible sending state",
    });
  }

  const outcome = await sendWhatsAppText({
    accessToken: TEST_ACCESS_TOKEN,
    phoneNumberId: TEST_PHONE_NUMBER_ID,
    graphVersion: TEST_GRAPH_VERSION,
    to: normalizedRecipient,
    message: ACCEPTANCE_MESSAGE,
  });

  const { data: finalized, error: finalizeError } = await admin.rpc("nvx_finalize_whatsapp_provider_acceptance", {
    p_run_id: runId,
    p_status: outcome.status,
    p_provider_message_id: outcome.providerMessageId,
    p_provider_http_status: outcome.providerHttpStatus,
    p_provider_error_code: outcome.errorCode,
    p_provider_error_message: outcome.errorMessage,
  });

  if (finalizeError || finalized !== true) {
    // The provider may already have accepted the send. `sending` is deliberately
    // non-replayable, so a retry with the same idempotency key cannot double-send.
    return reply(503, {
      success: false,
      sent: outcome.status === "accepted",
      runId,
      status: "unknown",
      message: "Provider outcome requires manual reconciliation; automatic resend is blocked",
    });
  }

  return reply(outcome.status === "accepted" ? 200 : 502, {
    success: outcome.status === "accepted",
    sent: outcome.status === "accepted",
    duplicate: false,
    runId,
    status: outcome.status,
    providerMessageId: outcome.providerMessageId,
    providerHttpStatus: outcome.providerHttpStatus,
    errorCode: outcome.errorCode,
  });
});
