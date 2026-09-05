import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
const migration = readFileSync(
  fileURLToPath(new URL("../../migrations/20260830070000_add_durable_meta_capi_outbox.sql", import.meta.url)),
  "utf8",
);
const eligibilityMigration = readFileSync(
  fileURLToPath(new URL("../../migrations/20260830070100_harden_meta_capi_outbox_eligibility.sql", import.meta.url)),
  "utf8",
);

describe("Meta CAPI durable dispatch contract", () => {
  it("is internal service-role only", () => {
    expect(source).toContain('SUPABASE_SERVICE_ROLE_KEY") || "").trim()');
    expect(source).toContain("requireServiceRole(req)");
    expect(source).toContain('message: "Forbidden"');
    expect(migration).toContain("revoke all on table public.meta_capi_outbox from public, anon, authenticated");
    expect(migration).toContain("grant all on table public.meta_capi_outbox to service_role");
    expect(migration).toContain("alter table public.leads");
    expect(migration).toContain("add column if not exists capi_sent");
  });

  it("claims durable rows with a recoverable lease", () => {
    expect(migration).toContain("for update skip locked");
    expect(migration).toContain("status = 'processing'");
    expect(migration).toContain("interval '15 minutes'");
    expect(source).toContain('admin.rpc("nvx_claim_meta_capi_outbox"');
  });

  it("uses HubSpot identity only in memory and never persists it in the outbox", () => {
    expect(source).toContain("hubSpotIdentity");
    expect(source).toContain("crm/v3/objects/contacts/");
    expect(source).toContain('url.searchParams.set("properties", "email,phone")');
    expect(migration).not.toMatch(/meta_capi_outbox[\s\S]{0,500}\b(email|phone)\b/i);
  });

  it("rejects enqueue without canonical HubSpot identity and exact lineage", () => {
    expect(eligibilityMigration).toContain("v_lead.source <> 'website_hubspot'");
    expect(eligibilityMigration).toContain("v_lead.hubspot_contact_id is null or v_lead.hubspot_contact_id <= 0");
    expect(eligibilityMigration).toContain("new.event_id <> 'lead:' || v_lead.nvx_lead_id::text");
    expect(eligibilityMigration).toContain("before insert or update of lead_id, event_name, event_id");
  });

  it("passes the authoritative lead clinic tenant to the internal web-events bridge", () => {
    expect(source).toContain('select("id,nvx_lead_id,clinic_id,hubspot_contact_id');
    expect(source).toContain('if (!lead.clinic_id)');
    expect(source).toContain('"Outbox lead missing clinic_id for CAPI tenant resolution"');
    expect(source).toContain('clinic_id: String(lead.clinic_id)');
    expect(source).toContain('fetch(`${SUPABASE_URL}/functions/v1/web-events`');
    expect(source).toContain('event_name: "Lead"');
    expect(source).toContain("event_id: String(row.event_id || \"\")");
    expect(source).toContain("nvx_is_test_lead: false");
  });

  it("requires an exact event-id acknowledgement before marking delivery", () => {
    expect(source).toContain('String(responseBody?.eventId || "") !== String(row.event_id || "")');
    expect(source).toContain("capi_sent: true, enviado_a_meta: true");
    expect(source).toContain('status: "succeeded"');
  });

  it("is idempotent and bounded", () => {
    expect(migration).toContain("constraint meta_capi_outbox_lead_event_unique unique (lead_id, event_name)");
    expect(migration).toContain("constraint meta_capi_outbox_event_id_unique unique (event_id)");
    expect(migration).toContain("on conflict do nothing");
    expect(source).toContain("const MAX_ATTEMPTS = 8");
    expect(source).toContain("Meta deduplicates by event_id");
  });

  it("enforces explicit timeouts and pre-claim credential resolution", () => {
    expect(source).toContain("AbortSignal.timeout(10_000)");
    expect(source).toContain("AbortSignal.timeout(15_000)");
    const claimIdx = source.indexOf('admin.rpc("nvx_claim_meta_capi_outbox"');
    const tokenIdx = source.indexOf("await resolveHubSpotToken(admin)");
    expect(tokenIdx).toBeGreaterThan(0);
    expect(claimIdx).toBeGreaterThan(tokenIdx);
  });
});
