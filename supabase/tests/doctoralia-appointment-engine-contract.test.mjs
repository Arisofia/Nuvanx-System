import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const runner = readFileSync("scripts/refresh-doctoralia-appointment-engine.js", "utf8");
const orchestrator = readFileSync("scripts/run-daily-sync.js", "utf8");
const scheduledMigration = readFileSync(
  "supabase/migrations/20260831011429_harden_scheduled_doctoralia_refresh_and_meta_campaign_filter.sql",
  "utf8",
);
const validityMigration = readFileSync(
  "supabase/migrations/20260831011936_centralize_doctoralia_match_validity_and_prune_stale_matches.sql",
  "utf8",
);

describe("Doctoralia Appointment Engine contract", () => {
  it("runs only after canonical Doctoralia appointment ingestion", () => {
    const ingest = orchestrator.indexOf("sync-doctoralia-appointments");
    const refresh = orchestrator.indexOf("refresh-doctoralia-appointment-engine");
    expect(ingest).toBeGreaterThan(-1);
    expect(refresh).toBeGreaterThan(ingest);
  });

  it("uses service-role RPC for every public user rather than hardcoded owner ids", () => {
    expect(runner).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(runner).toContain("/rest/v1/users?select=id&order=created_at.asc");
    expect(runner).toContain("/rest/v1/rpc/refresh_doctoralia_appointment_engine");
    expect(runner).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  });

  it("keeps the scheduled engine evidence-only", () => {
    expect(scheduledMigration).toContain("RETURN public.match_leads_to_doctoralia_by_phone(p_user_id);");
    expect(scheduledMigration).not.toContain("DELETE FROM public.lead_appointment_matches");
    expect(scheduledMigration).not.toContain("UPDATE public.leads");
    expect(scheduledMigration).not.toContain("THEN 'appointment'");
    expect(scheduledMigration).not.toContain("appointment_status = CASE");
  });

  it("centralizes match validity and self-heals stale evidence", () => {
    expect(validityMigration).toContain("CREATE OR REPLACE FUNCTION public.nvx_doctoralia_match_is_valid");
    expect(validityMigration).toContain("count(DISTINCT NULLIF(btrim(a2.doctoralia_id), ''))");
    expect(validityMigration).toContain("AT TIME ZONE 'Europe/Madrid'");
    expect(validityMigration).toContain("DELETE FROM public.lead_appointment_matches lam");
    expect(validityMigration).toContain("public.nvx_doctoralia_match_is_valid(l.id, a.id)");
    expect(validityMigration).not.toContain("SET verified_revenue");
    expect(validityMigration).not.toContain("stage = CASE");
  });
});
