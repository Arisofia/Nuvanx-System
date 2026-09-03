import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../../migrations/20260903060000_remove_google_ads_plaintext_developer_token.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const healthSource = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");

describe("Google Ads plaintext developer-token metadata invariant", () => {
  it("removes both legacy aliases while preserving unrelated metadata", () => {
    expect(migration).toContain("COALESCE(metadata, '{}'::jsonb) - 'developer_token' - 'developerToken'");
    expect(migration).toContain("WHERE service = 'google_ads'");
    expect(migration).not.toContain("SET metadata = '{}'::jsonb");
  });

  it("sanitizes legacy client writes before the database constraint is evaluated", () => {
    const triggerIndex = migration.indexOf("CREATE TRIGGER integrations_strip_google_ads_plaintext_metadata");
    const constraintIndex = migration.indexOf("ADD CONSTRAINT integrations_google_ads_no_plaintext_developer_token");

    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.nvx_strip_google_ads_plaintext_metadata()");
    expect(migration).toContain("IF NEW.service = 'google_ads' THEN");
    expect(migration).toContain("NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb) - 'developer_token' - 'developerToken'");
    expect(migration).toContain("BEFORE INSERT OR UPDATE ON public.integrations");
    expect(migration).toContain("EXECUTE FUNCTION public.nvx_strip_google_ads_plaintext_metadata()");
    expect(triggerIndex).toBeGreaterThan(-1);
    expect(constraintIndex).toBeGreaterThan(triggerIndex);
  });

  it("keeps a CHECK constraint as defense in depth after sanitization", () => {
    expect(migration).toContain("integrations_google_ads_no_plaintext_developer_token");
    expect(migration).toContain("service <> 'google_ads'");
    expect(migration).toContain("? 'developer_token'");
    expect(migration).toContain("? 'developerToken'");
  });

  it("does not source either developer-token alias from integration metadata at runtime", () => {
    expect(healthSource).not.toMatch(
      /metadata\s*(?:\?\.|\.)\s*(?:developer_token|developerToken)\b|metadata\s*(?:\?\.)?\s*\[\s*["'](?:developer_token|developerToken)["']\s*\]/,
    );
  });
});
