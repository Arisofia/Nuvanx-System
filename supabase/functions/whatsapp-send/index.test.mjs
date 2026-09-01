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
  fileURLToPath(new URL("../../migrations/20260901190000_async_whatsapp_encrypted_outbox.sql", import.meta.url)),
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
  it("authenticates, fingerprints and encrypts before the async reservation", () => {
    ordered(
      source,
      "const auth = await authenticatedContext(req)",
      "const messageSha256 = await sha256Hex(message)",
      "encrypted = await encryptMessage(message, leadId, messageSha256)",
      "const prepared = await prepareSendAsync(",
    );
    expect(source).toContain('rpc("nvx_prepare_whatsapp_send_async"');
    expect(deliveryMigration).toContain("and l.user_id = p_user_id");
    expect(deliveryMigration).toContain("recipient_does_not_match_lead_phone");
  });

  it("uses a read-only idempotency preflight and leaves reservation to the async RPC", () => {
    const preflightStart = source.indexOf("// Read-only replay lookup");
    const encryptionStart = source.indexOf("encrypted = await encryptMessage");
    expect(preflightStart, "read-only replay anchor missing").toBeGreaterThan(-1);
    expect(encryptionStart, "encryption anchor missing").toBeGreaterThan(preflightStart);
    const preflight = source.slice(preflightStart, encryptionStart);
    expect(preflight).toContain('.from("whatsapp_send_requests")');
    expect(preflight).toContain('.eq("idempotency_key", idempotencyKey)');
    expect(preflight).not.toContain('rpc("nvx_prepare_whatsapp_send"');
    expect(asyncMigration).toContain("from public.nvx_prepare_whatsapp_send(");
  });

  it("reports the actual encrypted payload state instead of relabeling active/manual states as queued", () => {
    expect(source).toContain('.select("state")');
    expect(source).toContain('return { ok: true, state: null }');
    expect(source).toContain('providerStatus: "queued"');
    expect(source).toContain('providerStatus: "claimed"');
    expect(source).toContain('providerStatus: "sending"');
    expect(source).toContain('providerStatus: "manual_review"');
    expect(source).toContain('providerStatus: "reconciliation_required"');
    expect(source).toContain("WhatsApp encrypted queue state is unavailable");
    expect(source).not.toContain("message: error.message");
  });

  it("remains fail-closed per clinic until controlled delivery acceptance enables sending", () => {
    expect(gateMigration).toContain("send_enabled boolean not null default false");
    expect(gateMigration).toContain("raise exception 'whatsapp_direct_disabled'");
    expect(source).toContain('message.includes("whatsapp_direct_disabled")');
  });

  it("encrypts with AES-GCM and never persists plaintext", () => {
    expect(source).toContain("WHATSAPP_QUEUE_KEYRING");
    expect(source).toContain("WHATSAPP_QUEUE_ACTIVE_KEY_VERSION");
    expect(source).toContain("AES-GCM");
    expect(source).toContain("additionalData: aad");
    expect(source).toContain("keyBytes.byteLength !== 32");
    expect(asyncMigration).toContain("ciphertext text");
    expect(asyncMigration).toContain("iv text");
    expect(asyncMigration).toContain("pg_catalog.length(ciphertext) between 16 and 32768");
    expect(asyncMigration).toContain("pg_catalog.length(p_ciphertext) > 32768");
    expect(asyncMigration).not.toMatch(/message_body\s+text/i);
    expect(asyncMigration).not.toMatch(/plaintext\s+text/i);
  });

  it("never calls Meta or loads provider credentials in the browser-facing function", () => {
    expect(source).not.toContain("graph.facebook.com");
    expect(source).not.toContain("WHATSAPP_ACCESS_TOKEN");
    expect(source).not.toContain("WHATSAPP_PHONE_NUMBER_ID");
    expect(source).not.toContain("AbortSignal.timeout");
    expect(source).not.toContain("nvx_finalize_whatsapp_send");
  });

  it("returns HTTP 202 only with queue/process state and never claims provider acceptance", () => {
    expect(source).toContain("queued: true");
    expect(source).toContain("pending: true");
    expect(source).toContain('providerStatus: "queued"');
    expect(source).toContain("Solicitud cifrada y en cola");
    expect(source).not.toContain("Aceptado por Meta. Entrega pendiente");
  });

  it("keeps request ledger and encrypted payload in one transactional RPC", () => {
    expect(asyncMigration).toContain("create or replace function public.nvx_prepare_whatsapp_send_async");
    expect(asyncMigration).toContain("from public.nvx_prepare_whatsapp_send(");
    expect(asyncMigration).toContain("insert into public.whatsapp_outbound_payloads");
    expect(asyncMigration).toContain("on conflict (request_id) do nothing");
    expect(asyncMigration).toContain("v_decision = 'duplicate' and v_request_status = 'reserved'");
  });
});
