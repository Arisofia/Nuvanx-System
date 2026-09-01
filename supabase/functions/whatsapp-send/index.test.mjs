import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
const worker = readFileSync(fileURLToPath(new URL("../whatsapp-outbound-worker/index.ts", import.meta.url)), "utf8");
const slaMigration = readFileSync(
  fileURLToPath(new URL("../../migrations/20260819185655_sla_human_first_response.sql", import.meta.url)),
  "utf8",
);
const deliveryMigration = readFileSync(
  fileURLToPath(new URL("../../migrations/20260830090000_harden_whatsapp_outbound_delivery.sql", import.meta.url)),
  "utf8",
);
const gateMigration = readFileSync(
  fileURLToPath(new URL("../../migrations/20260830090500_gate_whatsapp_direct_until_acceptance.sql", import.meta.url)),
  "utf8",
);
const asyncMigration = readFileSync(
  fileURLToPath(new URL("../../migrations/20260901113000_async_whatsapp_encrypted_outbox.sql", import.meta.url)),
  "utf8",
);

function ordered(sourceText, ...anchors) {
  let previous = -1;
  for (const anchor of anchors) {
    const current = sourceText.indexOf(anchor);
    expect(current, `missing anchor: ${anchor}`).toBeGreaterThan(-1);
    expect(current, `out-of-order anchor: ${anchor}`).toBeGreaterThan(previous);
    previous = current;
  }
}

describe("WhatsApp encrypted asynchronous outbound safety contract", () => {
  it("authenticates and atomically enqueues the owned lead before returning", () => {
    ordered(source, "const auth = await authenticatedContext(req)", "const prepared = await prepareSendAsync", "return json({\n    success: true,\n    queued: true");
    expect(source).toContain('rpc("nvx_prepare_whatsapp_send_async"');
    expect(source).toContain("encryptMessage(message, leadId, messageSha256)");
    expect(source).not.toContain("waRes = await fetch");
    expect(deliveryMigration).toContain("and l.user_id = p_user_id");
    expect(deliveryMigration).toContain("recipient_does_not_match_lead_phone");
    expect(source).toContain('code === "42501"');
    expect(source).toContain('code === "23505"');
  });

  it("is fail-closed per clinic until controlled delivery acceptance explicitly enables sending", () => {
    expect(gateMigration).toContain("send_enabled boolean not null default false");
    expect(gateMigration).toContain("raise exception 'whatsapp_direct_disabled'");
    expect(gateMigration).toContain("before insert on public.whatsapp_send_requests");
    expect(gateMigration).toContain("coalesce(v_enabled, false) is not true");
  });

  it("requires a client idempotency key and never re-sends a reserved or unknown intent", () => {
    expect(source).toContain("idempotency_key");
    expect(source).toContain('decision === "duplicate"');
    expect(source).toContain('requestStatus === "reserved"');
    expect(source).toContain('requestStatus === "unknown"');
    expect(source).toContain("idempotentReplay: true");
    expect(source).toContain("will not be sent again automatically");
    expect(deliveryMigration).toContain("whatsapp_send_requests_clinic_idempotency_uidx");
    expect(deliveryMigration).toContain("'duplicate'::text");
  });

  it("enforces atomic per-lead, per-user and per-clinic rate limits before queue insertion", () => {
    expect(deliveryMigration).toContain("'nvx-whatsapp-clinic:' || v_clinic_id::text");
    expect(deliveryMigration).toContain("'nvx-whatsapp:' || p_user_id::text || ':' || p_lead_id::text");
    expect(deliveryMigration).toContain("max_per_lead_10m");
    expect(deliveryMigration).toContain("max_per_lead_24h");
    expect(deliveryMigration).toContain("max_per_user_1m");
    expect(deliveryMigration).toContain("max_per_clinic_1m");
    expect(deliveryMigration).toContain("'whatsapp_rate_limited'");
    expect(source).toContain('decision === "rate_limited"');
    expect(source).toContain('"Retry-After"');
  });

  it("keeps payloads encrypted at rest and binds them to a versioned external keyring", () => {
    expect(source).toContain("WHATSAPP_QUEUE_KEYRING");
    expect(source).toContain("WHATSAPP_QUEUE_ACTIVE_KEY_VERSION");
    expect(source).toContain('name: "AES-GCM"');
    expect(source).toContain("messageSha256");
    expect(asyncMigration).toContain("ciphertext text");
    expect(asyncMigration).toContain("key_version text not null");
    expect(asyncMigration).not.toMatch(/message_body\s+text/i);
    expect(asyncMigration).not.toMatch(/body\s+text/i);
  });

  it("claims with SKIP LOCKED and purges ciphertext before the irreversible provider attempt", () => {
    expect(asyncMigration).toContain("for update of p skip locked");
    expect(asyncMigration).toContain("ciphertext = null");
    ordered(worker, "const { data: claimed, error: claimError } = await admin.rpc(\"nvx_claim_whatsapp_outbound_payload\"", "message = await decryptMessage", "if (!(await markSending(admin, row)))", "waRes = await fetch");
    expect(worker).toContain("AbortSignal.timeout(PROVIDER_TIMEOUT_MS)");
    expect(worker).toContain("manual_review");
    expect(worker).toContain("Meta provider outcome is unknown after transport failure");
  });

  it("does not automatically retry an ambiguous provider outcome", () => {
    expect(worker).toContain('finalizeSend(admin, row, "unknown"');
    expect(worker).toContain("finishPayload(admin, row, true)");
    expect(worker).toContain("waRes.status >= 500");
    expect(worker).toContain("provider outcome is unknown");
  });

  it("preserves historical rows while making new conversation/status writes idempotent", () => {
    expect(deliveryMigration).not.toContain("whatsapp_conversations_wa_message_id_uidx");
    expect(deliveryMigration).not.toContain("lead_events_whatsapp_message_status_uidx");
    expect(deliveryMigration).toContain("whatsapp_conversations_wa_message_id_idx");
    expect(deliveryMigration).toContain("lead_events_whatsapp_message_status_idx");
    expect(deliveryMigration).toContain("pg_catalog.hashtextextended('nvx-whatsapp-provider:'");
    expect(deliveryMigration).toContain("if not exists (");
  });

  it("keeps the persisted outbound ledger free of raw message bodies", () => {
    expect(asyncMigration).toContain("p_message_sha256 text");
    expect(asyncMigration).not.toMatch(/message_body\s+text/i);
    expect(asyncMigration).not.toMatch(/body\s+text/i);
    expect(source).not.toContain("body: message");
    expect(source).not.toContain("message,\n");
  });

  it("preserves first-outbound and first-human-response semantics for terminal provider evidence", () => {
    expect(slaMigration).toContain("first_outbound_at = coalesce(l.first_outbound_at, p_sent_at)");
    expect(slaMigration).toContain("first_response_at = coalesce(l.first_response_at, l.first_outbound_at, p_sent_at)");
    expect(slaMigration).toContain("and l.user_id = p_user_id");
    expect(slaMigration).toContain("grant execute on function public.mark_lead_human_first_response(uuid,uuid,timestamptz) to service_role");
    expect(asyncMigration).toContain("provider_message_id");
  });
});
