import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");

describe("google-click-attribution QA contract", () => {
  it("derives QA from the allowlisted staging origin instead of request-body authority", () => {
    expect(source).toContain('const STAGING_ORIGIN = "https://staging2.nuvanx.com"');
    expect(source).toContain("const isTestLead = origin === STAGING_ORIGIN");
    expect(source).not.toMatch(/body\.is_test_lead|body\.nvx_is_test_lead/);
  });

  it("suppresses staging rows from downstream reconciliation", () => {
    expect(source).toContain('reconciliation_status: qa.is_test_lead ? "qa_suppressed" : "pending"');
    expect(source).toContain("is_test_lead: qa.is_test_lead");
    expect(source).toContain("test_run_id: qa.test_run_id");
  });

  it("keeps browser lineage separate from the reconciled lead foreign key", () => {
    expect(source).not.toContain("applied_lead_id:");
    expect(source).not.toContain("applied_at:");
  });

  it("protects applied rows and production outbox lineage in retention purge migration", () => {
    const migration = readFileSync(
      fileURLToPath(new URL("../../migrations/20260830020500_add_qa_attribution_retention.sql", import.meta.url)),
      "utf8"
    );
    expect(migration).toContain("g.applied_lead_id is null");
    expect(migration).toContain("w.applied_lead_id is null");
    expect(migration).toContain("coalesce(o.is_test_lead, false) = false");
  });
});
