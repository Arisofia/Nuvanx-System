import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
const migration = readFileSync(
  fileURLToPath(new URL("../../migrations/20260830090000_harden_whatsapp_outbound_delivery.sql", import.meta.url)),
  "utf8",
);
const acceptanceMigration = readFileSync(
  fileURLToPath(new URL("../../migrations/20260905173500_whatsapp_test_waba_acceptance.sql", import.meta.url)),
  "utf8",
);

describe("WhatsApp delivery status webhook contract", () => {
  it("supports canonical and Test WABA verification without exposing verify tokens", () => {
    expect(source).toContain('hub.mode');
    expect(source).toContain('hub.verify_token');
    expect(source).toContain('hub.challenge');
    expect(source).toContain('META_WEBHOOK_VERIFY_TOKEN');
    expect(source).toContain('WHATSAPP_TEST_WEBHOOK_VERIFY_TOKEN');
    expect(source).not.toContain('verify_token: VERIFY_TOKEN');
  });

  it("requires a raw-body Meta HMAC before parsing or applying status updates", () => {
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

  it("isolates a distinct Test WABA app signature from patient delivery state", () => {
    expect(source).toContain('type SignatureScope = "production" | "test"');
    expect(source).toContain('WHATSAPP_TEST_APP_SECRET');
    expect(source).toContain('if (signatureScope === "production")');
    expect(source).toContain('rpc("nvx_apply_whatsapp_status"');
    expect(source).toContain('rpc("nvx_apply_whatsapp_provider_acceptance_status"');
    expect(source.indexOf('if (signatureScope === "production")')).toBeLessThan(
      source.indexOf('rpc("nvx_apply_whatsapp_status"'),
    );
  });

  it("processes the complete signed provider batch and retries persistence failures", () => {
    expect(source).toContain('["sent", "delivered", "read", "failed"]');
    expect(source).toContain('for (const item of statuses)');
    expect(source).not.toContain('statuses.slice(0, 100)');
    expect(source).toContain('p_provider_message_id: messageId');
    expect(source).toContain('p_event_at: eventTime');
    expect(source).toContain('if (persistenceFailed) failed += 1');
    expect(source).toContain('if (failed > 0)');
    expect(source).toContain('}, 503)');
  });

  it("bounds provider timestamps before converting them to ISO", () => {
    expect(source).toContain('seconds > 8.64e12');
    expect(source).toContain('return new Date().toISOString()');
  });

  it("persists delivered/read/failed idempotently without deleting historical duplicates", () => {
    expect(migration).toContain('lead_events_whatsapp_message_status_idx');
    expect(migration).toContain("raw_payload ->> 'message_id'");
    expect(migration).toContain("p_status not in ('sent', 'delivered', 'read', 'failed')");
    expect(migration).toContain('whatsapp_conversations_wa_message_id_idx');
    expect(migration).toContain("v_event_type := 'whatsapp_' || p_status");
    expect(migration).toContain('if not exists (');
    expect(migration).not.toContain('lead_events_whatsapp_message_status_uidx');
    expect(migration).not.toContain('whatsapp_conversations_wa_message_id_uidx');
  });

  it("keeps Test WABA evidence outside lead and patient tables", () => {
    expect(acceptanceMigration).toContain('create table if not exists public.whatsapp_provider_acceptance_runs');
    expect(acceptanceMigration).toContain('recipient_sha256 text not null');
    expect(acceptanceMigration).toContain('message_sha256 text not null');
    expect(acceptanceMigration).not.toContain('lead_id');
    expect(acceptanceMigration).not.toContain('normalized_phone');
    expect(acceptanceMigration).not.toContain('whatsapp_rate_limit_config');
  });

  it("never regresses conversation delivery state when callbacks arrive out of order", () => {
    expect(migration).toContain("when p_status = 'read' then 'read'");
    expect(migration).toContain("when p_status = 'delivered' and c.conversation_status <> 'read' then 'delivered'");
    expect(migration).toContain("when p_status = 'sent' and coalesce(c.conversation_status, 'accepted') in ('reserved', 'accepted', 'sent') then 'sent'");
    expect(migration).toContain("when p_status = 'failed' and coalesce(c.conversation_status, 'accepted') in ('reserved', 'accepted', 'failed') then 'failed'");
  });
});
