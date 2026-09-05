import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
const provider = readFileSync(fileURLToPath(new URL("../_shared/whatsapp-provider.ts", import.meta.url)), "utf8");
const migration = readFileSync(
  fileURLToPath(new URL("../../migrations/20260901190000_async_whatsapp_encrypted_outbox.sql", import.meta.url)),
  "utf8",
);
const wakeupMigration = readFileSync(
  fileURLToPath(new URL("../../migrations/20260901190100_whatsapp_insert_only_wakeup.sql", import.meta.url)),
  "utf8",
);
const lateAttemptMigration = readFileSync(
  fileURLToPath(new URL("../../migrations/20260901190200_whatsapp_late_attempt_reconciliation.sql", import.meta.url)),
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
  it("requires service-role authorization and cannot be called with a browser user token", () => {
    expect(source).toContain("bearerToken(req) !== SERVICE_ROLE");
    expect(source).toContain("Service-role authorization required");
  });

  it("loads an external AES-GCM keyring and decrypts only in worker memory", () => {
    expect(source).toContain("WHATSAPP_QUEUE_KEYRING");
    expect(source).toContain("crypto.subtle.decrypt");
    expect(source).toContain("AES-GCM");
    expect(source).toContain("queue_key_version_unavailable");
    expect(migration).toContain("ciphertext text");
    expect(migration).not.toMatch(/message_body\s+text/i);
    expect(migration).not.toMatch(/plaintext\s+text/i);
  });

  it("claims with SKIP LOCKED and clamps every worker batch to three rows", () => {
    expect(migration).toContain("for update of p skip locked");
    expect(migration).toContain("least(coalesce(p_limit, 3), 3)");
    expect(source).toContain("const MAX_CLAIM_LIMIT = 3");
    expect(source).toContain("Math.min(MAX_CLAIM_LIMIT");
    expect(migration).toContain("claim_attempts between 0 and 3");
  });

  it("purges ciphertext before the irreversible shared provider request", () => {
    ordered(
      source,
      "message = await decryptMessage(row, keyring)",
      "await markSending(admin, row)",
      "const outcome = await sendWhatsAppText",
    );
    expect(source).toContain('import { sendWhatsAppText } from "../_shared/whatsapp-provider.ts"');
    expect(migration).toContain("set state = 'sending'");
    expect(migration).toContain("ciphertext = null");
    expect(migration).toContain("provider_attempt_started_at = pg_catalog.clock_timestamp()");
  });

  it("centralizes the irreversible Meta transport for production and Test WABA acceptance", () => {
    expect(provider).toContain("https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages");
    expect(provider).toContain('Authorization: `Bearer ${accessToken}`');
    expect(provider).toContain('recipient_type: "individual"');
    expect(provider).toContain('type: "text"');
    expect(source).not.toContain("https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages");
  });

  it("never auto-retries ambiguous provider outcomes", () => {
    expect(source).toContain('const manualReview = outcome.status === "unknown"');
    expect(source).toContain("await finishPayload(admin, row, manualReview)");
    expect(provider).toContain('status: "unknown"');
    expect(provider).toContain("Meta provider outcome is unknown after transport failure");
    expect(provider).toContain("const ambiguous = response.status >= 500");
    expect(provider).toContain('status: ambiguous ? "unknown" : "failed"');
    expect(migration).toContain("Worker outcome requires manual review; automatic resend is blocked");
    expect(migration).toContain("p.state = 'sending'");
    expect(migration).toContain("else 'manual_review'");
  });

  it("terminalizes a payload only after the request ledger finalization succeeds", () => {
    const nonAcceptedStart = source.indexOf('if (outcome.status !== "accepted")');
    const acceptedStart = source.lastIndexOf("const ledgerTracked = await finalizeSend(");
    expect(nonAcceptedStart).toBeGreaterThan(-1);
    expect(acceptedStart).toBeGreaterThan(nonAcceptedStart);
    const nonAccepted = source.slice(nonAcceptedStart, acceptedStart);
    expect(nonAccepted).toContain("const ledgerTracked = await finalizeSend(");
    expect(nonAccepted).toContain("if (ledgerTracked)");
    expect(nonAccepted).toContain("await finishPayload(admin, row, manualReview)");
    const accepted = source.slice(acceptedStart);
    expect(accepted).toContain("if (ledgerTracked)");
    expect(accepted).toContain("await finishPayload(admin, row, false)");
  });

  it("allows the same claim to reconcile a late provider outcome after stale manual review", () => {
    expect(source).toContain("provider delivery is authorized for this claim token");
    expect(lateAttemptMigration).toContain("p.claim_token = p_claim_token");
    expect(lateAttemptMigration).toContain("p.state in ('claimed', 'sending', 'manual_review')");
    expect(lateAttemptMigration).toContain("r.status in ('accepted', 'sent', 'delivered', 'read', 'failed')");
    expect(lateAttemptMigration).toContain("r.status = 'unknown'");
    expect(lateAttemptMigration).not.toContain("state = 'queued'");
  });

  it("treats HTTP 5xx and success-without-message-id as ambiguous in the shared provider", () => {
    expect(provider).toContain("const ambiguous = response.status >= 500");
    expect(provider).toContain('status: ambiguous ? "unknown" : "failed"');
    expect(provider).toContain("if (!providerMessageId)");
    expect(provider).toContain("missing_provider_message_id");
    expect(source).toContain("Shared provider transport classifies this as unknown");
  });

  it("preserves SLA telemetry as non-authoritative after provider acceptance", () => {
    ordered(
      source,
      '"accepted",\n      messageId',
      "await finishPayload(admin, row, false)",
      "await trackFirstHumanResponse(admin, row, messageId)",
    );
    expect(source).toContain("Telemetry failure must never trigger a resend");
  });

  it("uses insert-only event wakeup plus one-minute safety scheduling", () => {
    expect(wakeupMigration).toContain("after insert on public.whatsapp_outbound_payloads");
    expect(wakeupMigration).not.toContain("update of state");
    expect(wakeupMigration).toContain("for each statement execute function public.nvx_wake_whatsapp_outbound_on_queue()");
    expect(migration).toContain("public.nvx_try_dispatch_revops_worker('whatsapp-outbound-worker', 3, null)");
    expect(migration).toContain("'nvx-whatsapp-outbound-worker'");
    expect(migration).toContain("'* * * * *'");
  });

  it("wakes the safety worker for queued rows as well as stale claimed and sending rows", () => {
    expect(migration).toContain("where state = 'queued'");
    expect(migration).toContain("claimed_at < pg_catalog.now() - interval '2 minutes'");
    expect(migration).toContain("provider_attempt_started_at < pg_catalog.now() - interval '2 minutes'");
    expect(migration).toContain("expires_at <= pg_catalog.now()");
    expect(migration).not.toContain("where state = 'queued'\n        and expires_at > now()");
  });
});
