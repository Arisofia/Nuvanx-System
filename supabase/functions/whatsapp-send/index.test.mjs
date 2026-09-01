import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
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

function ordered(sourceText, ...anchors) {
  let previous = -1;
  for (const anchor of anchors) {
    const current = sourceText.indexOf(anchor);
    expect(current, `missing anchor: ${anchor}`).toBeGreaterThan(-1);
    expect(current, `out-of-order anchor: ${anchor}`).toBeGreaterThan(previous);
    previous = current;
  }
}

function boundedSlice(sourceText, startAnchor, endAnchor) {
  const start = sourceText.indexOf(startAnchor);
  const end = sourceText.indexOf(endAnchor, Math.max(0, start + startAnchor.length));
  expect(start, `missing start anchor: ${startAnchor}`).toBeGreaterThan(-1);
  expect(end, `missing end anchor: ${endAnchor}`).toBeGreaterThan(start);
  return sourceText.slice(start, end);
}

describe("WhatsApp outbound safety contract", () => {
  it("authenticates and reserves the owned lead before the irreversible provider send", () => {
    ordered(
      source,
      "const auth = await authenticatedContext(req)",
      "const prepared = await prepareSend",
      "waRes = await fetch",
    );
    expect(source).toContain('rpc("nvx_prepare_whatsapp_send"');
    expect(deliveryMigration).toContain("and l.user_id = p_user_id");
    expect(deliveryMigration).toContain("recipient_does_not_match_lead_phone");
    expect(source).toContain('code === "42501"');
    expect(source).toContain('code === "23505"');
  });

  it("is fail-closed per clinic until controlled delivery acceptance explicitly enables sending", () => {
    expect(gateMigration).toContain('send_enabled boolean not null default false');
    expect(gateMigration).toContain("raise exception 'whatsapp_direct_disabled'");
    expect(gateMigration).toContain('before insert on public.whatsapp_send_requests');
    expect(gateMigration).toContain('coalesce(v_enabled, false) is not true');
  });

  it("requires a client idempotency key and never re-sends a reserved or unknown intent", () => {
    expect(source).toContain('idempotency_key');
    expect(source).toContain('decision === "duplicate"');
    expect(source).toContain('requestStatus === "reserved"');
    expect(source).toContain('requestStatus === "unknown"');
    expect(source).toContain('idempotentReplay: true');
    expect(source).toContain('will not be sent again automatically');
    expect(deliveryMigration).toContain('whatsapp_send_requests_clinic_idempotency_uidx');
    expect(deliveryMigration).toContain("'duplicate'::text");
  });

  it("enforces atomic per-lead, per-user and per-clinic rate limits before Meta", () => {
    expect(deliveryMigration).toContain("'nvx-whatsapp-clinic:' || v_clinic_id::text");
    expect(deliveryMigration).toContain("'nvx-whatsapp:' || p_user_id::text || ':' || p_lead_id::text");
    expect(deliveryMigration).toContain('max_per_lead_10m');
    expect(deliveryMigration).toContain('max_per_lead_24h');
    expect(deliveryMigration).toContain('max_per_user_1m');
    expect(deliveryMigration).toContain('max_per_clinic_1m');
    expect(deliveryMigration).toContain("'whatsapp_rate_limited'");
    expect(source).toContain('decision === "rate_limited"');
    expect(source).toContain('"Retry-After"');
  });

  it("bounds the provider call and persists timeout or provider 5xx as UNKNOWN without replay", () => {
    expect(source).toContain('const PROVIDER_TIMEOUT_MS = 10_000');
    expect(source).toContain('AbortSignal.timeout(PROVIDER_TIMEOUT_MS)');
    expect(source).toContain('providerStatus: "unknown"');
    const catchBlock = boundedSlice(source, '} catch (error: unknown) {', 'const explicitProviderError');
    expect(catchBlock).toContain('finalizeSend(auth.admin, auth.userId, requestId, "unknown"');
    expect(catchBlock).toContain('will not be resent automatically');
    expect(source).toContain('const ambiguous = waRes.status >= 500');
    expect(deliveryMigration).toContain("status in ('reserved', 'unknown', 'accepted', 'sent', 'delivered', 'read', 'failed')");
    expect(deliveryMigration).toContain("'whatsapp_provider_unknown'");
  });

  it("does not accept a semantic provider failure or a 2xx response without a Meta message id", () => {
    expect(source).toContain('waData?.success === false');
    expect(source).toContain('waData?.messages?.[0]?.id');
    expect(source).toContain('if (!messageId)');
    expect(source).toContain('Meta returned success without a message id');
    expect(source).toContain('"missing_provider_message_id"');
    expect(source).toContain('ambiguous ? "unknown" : "failed"');
  });

  it("records Meta acceptance separately from delivery confirmation", () => {
    expect(source).toContain('providerStatus: "accepted"');
    expect(source).toContain('delivered: false');
    expect(source).toContain('delivery status is pending webhook confirmation');
    expect(deliveryMigration).toContain("'whatsapp_meta_accepted'");
    expect(deliveryMigration).toContain("p_status not in ('sent', 'delivered', 'read', 'failed')");
    expect(deliveryMigration).toContain("v_event_type := 'whatsapp_' || p_status");
  });

  it("preserves historical rows while making new conversation/status writes idempotent", () => {
    expect(deliveryMigration).not.toContain('whatsapp_conversations_wa_message_id_uidx');
    expect(deliveryMigration).not.toContain('lead_events_whatsapp_message_status_uidx');
    expect(deliveryMigration).toContain('whatsapp_conversations_wa_message_id_idx');
    expect(deliveryMigration).toContain('lead_events_whatsapp_message_status_idx');
    expect(deliveryMigration).toContain("pg_catalog.hashtextextended('nvx-whatsapp-provider:'");
    expect(deliveryMigration).toContain('if not exists (');
    expect(deliveryMigration).toContain("when p_status = 'delivered' and c.conversation_status <> 'read' then 'delivered'");
    expect(deliveryMigration).toContain("when p_status = 'sent' and coalesce(c.conversation_status, 'accepted') in ('reserved', 'accepted', 'sent') then 'sent'");
  });

  it("keeps the persisted outbound ledger free of raw message bodies", () => {
    expect(deliveryMigration).toContain('message_sha256 text not null');
    expect(deliveryMigration).not.toMatch(/message_body\s+text/i);
    expect(deliveryMigration).not.toMatch(/body\s+text/i);
    const eventBlock = boundedSlice(source, '.from("lead_events").insert', 'if (eventError)');
    expect(eventBlock).not.toContain('body: message');
    expect(eventBlock).not.toContain('message,');
  });

  it("tracks first human response only after Meta returned a durable message id", () => {
    ordered(
      source,
      'if (!messageId)',
      'const ledgerTracked = await finalizeSend',
      'const sla = await trackFirstHumanResponse',
    );
    expect(source).toContain('type: "text"');
  });

  it("atomically preserves first outbound and first human response", () => {
    expect(slaMigration).toContain("first_outbound_at = coalesce(l.first_outbound_at, p_sent_at)");
    expect(slaMigration).toContain("first_response_at = coalesce(l.first_response_at, l.first_outbound_at, p_sent_at)");
    expect(slaMigration).toContain("and l.user_id = p_user_id");
    expect(slaMigration).toContain("grant execute on function public.mark_lead_human_first_response(uuid,uuid,timestamptz) to service_role");
  });

  it("never converts accepted provider delivery into a resend instruction when telemetry fails", () => {
    const trackerCall = source.indexOf('const sla = await trackFirstHumanResponse');
    const successResponse = source.indexOf('success: true', trackerCall);
    expect(trackerCall).toBeGreaterThan(-1);
    expect(successResponse).toBeGreaterThan(trackerCall);
    expect(source).toContain('ledger persistence needs reconciliation; do not resend');
    expect(source).toContain('slaTrackingReason');
  });
});
