import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const runner = readFileSync("scripts/refresh-doctoralia-appointment-engine.js", "utf8");
const orchestrator = readFileSync("scripts/run-daily-sync.js", "utf8");
const migration = readFileSync("supabase/migrations/20260819171218_revops_operating_contract.sql", "utf8");

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

  it("preserves the live lead stage vocabulary", () => {
    expect(migration).toContain("WHEN l.stage = 'convertido' THEN l.stage");
    expect(migration).toContain("WHEN l.stage = 'lead' THEN 'appointment'");
    expect(migration).not.toContain("appointment_attended");
    expect(migration).not.toContain("l.stage = 'closed'");
  });

  it("stores attendance and no-show state in dedicated appointment fields", () => {
    expect(migration).toContain("appointment_status = CASE");
    expect(migration).toContain("attended_at = CASE");
    expect(migration).toContain("no_show_flag = lower(pm.estado) = 'no acude'");
  });
});
