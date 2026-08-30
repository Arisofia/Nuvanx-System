import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
const migration = readFileSync(
  fileURLToPath(new URL("../../migrations/20260830090000_harden_whatsapp_outbound_delivery.sql", import.meta.url)),
  "utf8",
);

describe("WhatsApp delivery status webhook contract", () => {
  it("supports Meta verification without exposing the verify token", () => {
    expect(source).toContain('hub.mode');
    expect(source).toContain('hub.verify_token');
    expect(source).toContain('hub.challenge');
    expect(source).toContain('META_WEBHOOK_VERIFY_TOKEN');
    expect(source).not.toContain('verify_token: VERIFY_TOKEN');
  });

  it("requires the raw-body Meta HMAC before parsing or applying status updates", () => {
    const readBody = source.indexOf('const rawBody = await req.text()');
    const signatureCheck = source.indexOf('verifyMetaSignature(req, rawBody)');
    const parse = source.indexOf('JSON.parse(rawBody)');
    const rpc = source.indexOf('rpc("nvx_apply_whatsapp_status"');
    expect(readBody).toBeGreaterThan(-1);
    expect(signatureCheck).toBeGreaterThan(readBody);
    expect(parse).toBeGreaterThan(signatureCheck);
    expect(rpc).toBeGreaterThan(parse);
    expect(source).toContain('x-hub-signature-256');
    expect(source).toContain('timingSafeEqualHex');
  });

  it("processes only provider delivery states and caps one callback batch", () => {
    expect(source).toContain('["sent", "delivered", "read", "failed"]');
    expect(source).toContain('statuses.slice(0, 100)');
    expect(source).toContain('p_provider_message_id: messageId');
    expect(source).toContain('p_event_at: eventTime');
  });

  it("persists delivered/read/failed as idempotent lead events correlated by provider message id", () => {
    expect(migration).toContain('lead_events_whatsapp_message_status_uidx');
    expect(migration).toContain("raw_payload ->> 'message_id'");
    expect(migration).toContain("p_status not in ('sent', 'delivered', 'read', 'failed')");
    expect(migration).toContain('whatsapp_conversations_wa_message_id_uidx');
    expect(migration).toContain("v_event_type := 'whatsapp_' || p_status");
    expect(migration).toContain('on conflict do nothing');
  });
});
