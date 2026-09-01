import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
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

describe("WhatsApp encrypted asynchronous enqueue contract", () => {
  it("authenticates the user and validates the owned lead before queuing", () => {
    ordered(source, "const auth = await authenticatedContext(req)", "const messageSha256 = await sha256Hex", "await prepareSendAsync");
    expect(source).toContain('rpc("nvx_prepare_whatsapp_send_async"');
    expect(deliveryMigration).toContain("and l.user_id = p_user_id");
    expect(deliveryMigration).toContain("recipient_does_not_match_lead_phone");
  });

  it("remains fail-closed per clinic until controlled WhatsApp acceptance enables sending", () => {
    expect(gateMigration).toContain('send_enabled boolean not null default false');
    expect(gateMigration).toContain("raise exception 'whatsapp_direct_disabled'");
    expect(source).toContain('message.includes("whatsapp_direct_disabled")');
  });

  it("requires a client idempotency key and preserves it across queued replays", () => {
    expect(source).toContain('idempotency_key');
    expect(source).toContain('decision === "duplicate"');
    expect(source).toContain('requestStatus === "reserved"');
    expect(source).toContain('idempotentReplay: true');
    expect(source).toContain('already queued for asynchronous delivery');
    expect(deliveryMigration).toContain('whatsapp_send_requests_clinic_idempotency_uidx');
  });

  it("encrypts the message with AES-GCM before the database reservation", () => {
    ordered(source, "await encryptMessage(message, leadId, messageSha256)", "await prepareSendAsync");
    expect(source).toContain('WHATSAPP_QUEUE_KEYRING');
    expect(source).toContain('WHATSAPP_QUEUE_ACTIVE_KEY_VERSION');
    expect(source).toContain('AES-GCM');
    expect(source).toContain('additionalData: aad');
    expect(source).toContain('keyBytes.byteLength !== 32');
  });

  it("fails closed when queue encryption is unavailable", () => {
    expect(source).toContain('queue_encryption_unavailable');
    expect(source).toContain('WhatsApp queue encryption is not configured');
    expect(source).toContain('}, 503)');
  });

  it("never calls Meta directly from the browser-facing function", () => {
    expect(source).not.toContain('graph.facebook.com');
    expect(source).not.toContain('WHATSAPP_ACCESS_TOKEN');
    expect(source).not.toContain('WHATSAPP_PHONE_NUMBER_ID');
    expect(source).not.toContain('AbortSignal.timeout');
  });

  it("returns a queued 202 instead of waiting for provider acceptance", () => {
    expect(source).toContain('queued: true');
    expect(source).toContain('providerStatus: "queued"');
    expect(source).toContain('Solicitud cifrada y en cola');
    expect(source).toContain('}, 202)');
  });

  it("persists only ciphertext metadata and never a plaintext message body", () => {
    expect(asyncMigration).toContain('ciphertext text');
    expect(asyncMigration).toContain('iv text');
    expect(asyncMigration).toContain('key_version text not null');
    expect(asyncMigration).not.toMatch(/message_body\s+text/i);
    expect(asyncMigration).not.toMatch(/plaintext\s+text/i);
    expect(asyncMigration).toContain('revoke all on table public.whatsapp_outbound_payloads from public, anon, authenticated');
  });

  it("keeps rate limiting and reservation ownership in the existing atomic contract", () => {
    expect(asyncMigration).toContain('from public.nvx_prepare_whatsapp_send(');
    expect(deliveryMigration).toContain('max_per_lead_10m');
    expect(deliveryMigration).toContain('max_per_lead_24h');
    expect(deliveryMigration).toContain('max_per_user_1m');
    expect(deliveryMigration).toContain('max_per_clinic_1m');
  });
});
