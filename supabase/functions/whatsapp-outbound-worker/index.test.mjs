import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
const migration = readFileSync(
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

describe("WhatsApp asynchronous encrypted outbound worker", () => {
  it("requires service-role authorization and never accepts a browser user token", () => {
    expect(source).toContain('bearerToken(req) !== SERVICE_ROLE');
    expect(source).toContain('Service-role authorization required');
  });

  it("requires an external keyring and decrypts only in worker memory", () => {
    expect(source).toContain('WHATSAPP_QUEUE_KEYRING');
    expect(source).toContain('crypto.subtle.decrypt');
    expect(source).toContain('AES-GCM');
    expect(source).toContain('queue_key_version_unavailable');
    expect(migration).toContain('ciphertext text');
    expect(migration).not.toMatch(/message_body\s+text/i);
    expect(migration).not.toMatch(/plaintext\s+text/i);
  });

  it("claims with SKIP LOCKED and supports only bounded pre-provider recovery", () => {
    expect(migration).toContain('for update of p skip locked');
    expect(migration).toContain('claim_attempts between 0 and 3');
    expect(migration).toContain("p.claim_attempts < 3");
    expect(migration).toContain("p.claim_attempts >= 3");
    expect(migration).toContain("'worker_claim_exhausted'");
  });

  it("purges ciphertext before the irreversible provider call", () => {
    ordered(
      source,
      'message = await decryptMessage',
      'await markSending(admin, row)',
      'waRes = await fetch',
    );
    expect(migration).toContain("set state = 'sending'");
    expect(migration).toContain('ciphertext = null');
    expect(migration).toContain('iv = null');
    expect(migration).toContain('provider_attempt_started_at');
  });

  it("never automatically retries an ambiguous provider outcome", () => {
    expect(source).toContain('finalizeSend(admin, row, "unknown"');
    expect(source).toContain('await finishPayload(admin, row, true)');
    expect(source).toContain('const ambiguous = waRes.status >= 500');
    expect(migration).toContain("state = 'manual_review'");
    expect(migration).toContain("'worker_interrupted_after_attempt_start'");
  });

  it("does not terminalize transport ambiguity unless the request ledger was finalized", () => {
    const providerCall = source.indexOf('waRes = await fetch');
    const catchStart = source.indexOf('} catch (error: unknown) {', providerCall);
    const catchEnd = source.indexOf('continue;', catchStart);
    expect(providerCall).toBeGreaterThan(-1);
    expect(catchStart).toBeGreaterThan(providerCall);
    expect(catchEnd).toBeGreaterThan(catchStart);

    const transportCatch = source.slice(catchStart, catchEnd);
    expect(transportCatch).toContain('const ledgerTracked = await finalizeSend');
    expect(transportCatch).toContain('if (ledgerTracked)');
    expect(transportCatch.indexOf('await finishPayload(admin, row, true)')).toBeGreaterThan(
      transportCatch.indexOf('if (ledgerTracked)'),
    );
  });

  it("keeps a recoverable keyring failure encrypted and pre-provider", () => {
    expect(source).toContain('deferred += 1');
    const decryptFailure = source.indexOf('// No provider attempt has started.');
    const attemptBoundary = source.indexOf('await markSending(admin, row)');
    expect(decryptFailure).toBeGreaterThan(-1);
    expect(attemptBoundary).toBeGreaterThan(decryptFailure);
  });

  it("verifies the decrypted message fingerprint before delivery", () => {
    expect(source).toContain('await sha256Hex(message) !== row.message_sha256');
    expect(source).toContain('message_fingerprint_mismatch');
  });

  it("has event wakeup plus one-minute safety-net dispatch", () => {
    expect(migration).toContain('trg_nvx_wake_whatsapp_outbound');
    expect(migration).toContain("public.nvx_try_dispatch_revops_worker('whatsapp-outbound-worker', 25, null)");
    expect(migration).toContain("'nvx-whatsapp-outbound-worker'");
    expect(migration).toContain("'* * * * *'");
  });

  it("exports bounded queue health without exposing message payloads", () => {
    expect(migration).toContain('nvx_get_whatsapp_outbound_queue_health');
    expect(migration).toContain("'manualReview'");
    expect(migration).toContain("'oldestQueuedAt'");
    expect(migration).not.toContain("'ciphertext', ciphertext");
  });
});
