import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
const provider = readFileSync(fileURLToPath(new URL("../_shared/whatsapp-provider.ts", import.meta.url)), "utf8");
const migration = readFileSync(
  fileURLToPath(new URL("../../migrations/20260905173500_whatsapp_test_waba_acceptance.sql", import.meta.url)),
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

describe("controlled Meta Test WABA acceptance boundary", () => {
  it("uses only dedicated Test WABA provider configuration and a fixed recipient secret", () => {
    expect(source).toContain('WHATSAPP_TEST_ACCESS_TOKEN');
    expect(source).toContain('WHATSAPP_TEST_PHONE_NUMBER_ID');
    expect(source).toContain('WHATSAPP_TEST_RECIPIENT');
    expect(source).toContain('WHATSAPP_TEST_ACCEPTANCE_ENABLED');
    expect(source).not.toContain('Deno.env.get("WHATSAPP_ACCESS_TOKEN")');
    expect(source).not.toContain('Deno.env.get("WHATSAPP_PHONE_NUMBER_ID")');
    expect(source).not.toContain('normalized_phone');
  });

  it("requires internal authorization and literal operator confirmation", () => {
    expect(source).toContain('p_name: "REVOPS_INTERNAL_SECRET"');
    expect(source).toContain('x-nvx-internal-secret');
    expect(source).toContain('confirm !== "TEST_WABA"');
    expect(source).toContain('Test WABA acceptance is disabled');
  });

  it("never accepts a recipient or message body from the request", () => {
    expect(source).toContain('const ACCEPTANCE_MESSAGE =');
    expect(source).toContain('const normalizedRecipient = normalizeRecipient(TEST_RECIPIENT)');
    expect(source).not.toContain('body.recipient');
    expect(source).not.toContain('body.phone');
    expect(source).not.toContain('body.message');
    expect(source).not.toContain('lead_id');
  });

  it("stores only fingerprints and provider evidence outside clinical tables", () => {
    expect(migration).toContain('public.whatsapp_provider_acceptance_runs');
    expect(migration).toContain('recipient_sha256 text not null');
    expect(migration).toContain('message_sha256 text not null');
    expect(migration).toContain('provider_message_id text');
    expect(migration).not.toContain('lead_id');
    expect(migration).not.toContain('normalized_phone');
    expect(migration).not.toContain('whatsapp_rate_limit_config');
    expect(migration).not.toContain('lead_events');
    expect(migration).not.toContain('whatsapp_conversations');
  });

  it("persists an irreversible sending state before contacting Meta", () => {
    ordered(
      source,
      'rpc("nvx_prepare_whatsapp_provider_acceptance"',
      'rpc("nvx_mark_whatsapp_provider_acceptance_sending"',
      'const outcome = await sendWhatsAppText',
      'rpc("nvx_finalize_whatsapp_provider_acceptance"',
    );
    expect(migration).toContain("status = 'sending'");
    expect(migration).toContain('provider_attempt_started_at');
    expect(source).toContain('automatic resend is blocked');
  });

  it("returns duplicates without invoking the provider again", () => {
    const duplicate = source.indexOf('if (decision === "duplicate")');
    const providerCall = source.indexOf('const outcome = await sendWhatsAppText');
    expect(duplicate).toBeGreaterThan(-1);
    expect(providerCall).toBeGreaterThan(duplicate);
    expect(source.slice(duplicate, providerCall)).toContain('sent: false');
    expect(migration).toContain("'duplicate'::text");
    expect(migration).toContain('acceptance_idempotency_key_conflict');
  });

  it("uses the exact shared provider transport used by the production worker", () => {
    expect(source).toContain('import { sendWhatsAppText } from "../_shared/whatsapp-provider.ts"');
    expect(provider).toContain('export async function sendWhatsAppText');
    expect(provider).toContain('const ambiguous = response.status >= 500');
    expect(provider).toContain('missing_provider_message_id');
  });

  it("rate-limits acceptance independently of patient delivery", () => {
    expect(migration).toContain("requested_at >= pg_catalog.clock_timestamp() - interval '1 hour'");
    expect(migration).toContain('v_recent_count >= 3');
    expect(migration).toContain('whatsapp_provider_acceptance_hourly_limit');
  });
});
