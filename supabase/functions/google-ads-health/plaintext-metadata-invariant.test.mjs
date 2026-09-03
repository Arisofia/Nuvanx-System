import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const cleanupMigration = readFileSync(
  fileURLToPath(
    new URL(
      "../../migrations/20260903060000_remove_google_ads_plaintext_developer_token.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const invariantMigration = readFileSync(
  fileURLToPath(
    new URL(
      "../../migrations/20260903060100_enforce_google_ads_plaintext_metadata_invariant.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const healthSource = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");

describe("Google Ads plaintext developer-token metadata invariant", () => {
  it("cleans existing object metadata without erasing unrelated state or changing routing recency", () => {
    expect(cleanupMigration).toContain("SET metadata = metadata - 'developer_token' - 'developerToken'");
    expect(cleanupMigration).toContain("WHERE service = 'google_ads'");
    expect(cleanupMigration).toContain("jsonb_typeof(metadata) = 'object'");
    expect(cleanupMigration).not.toContain("SET metadata = '{}'::jsonb");
    expect(cleanupMigration).not.toContain("updated_at = NOW()");
    expect(cleanupMigration).not.toContain("ADD CONSTRAINT integrations_google_ads_no_plaintext_developer_token");
    expect(cleanupMigration).not.toContain("CREATE TRIGGER integrations_strip_google_ads_plaintext_metadata");
  });

  it("installs an object-scoped sanitizer before closing the database invariant", () => {
    const triggerIndex = invariantMigration.indexOf("CREATE TRIGGER integrations_strip_google_ads_plaintext_metadata");
    const cleanupIndex = invariantMigration.indexOf("UPDATE public.integrations");
    const constraintIndex = invariantMigration.indexOf("ADD CONSTRAINT integrations_google_ads_no_plaintext_developer_token");

    expect(invariantMigration).toContain("CREATE OR REPLACE FUNCTION public.nvx_strip_google_ads_plaintext_metadata()");
    expect(invariantMigration).toContain("IF NEW.service = 'google_ads'");
    expect(invariantMigration).toContain("jsonb_typeof(NEW.metadata) = 'object'");
    expect(invariantMigration).toContain("NEW.metadata := NEW.metadata - 'developer_token' - 'developerToken'");
    expect(invariantMigration).toContain("BEFORE INSERT OR UPDATE ON public.integrations");
    expect(invariantMigration).toContain("EXECUTE FUNCTION public.nvx_strip_google_ads_plaintext_metadata()");
    expect(invariantMigration).toContain("jsonb_typeof(metadata) = 'object'");
    expect(invariantMigration).not.toContain("updated_at = NOW()");
    expect(triggerIndex).toBeGreaterThan(-1);
    expect(cleanupIndex).toBeGreaterThan(triggerIndex);
    expect(constraintIndex).toBeGreaterThan(cleanupIndex);
  });

  it("keeps a CHECK constraint as object-scoped defense in depth after sanitization", () => {
    expect(invariantMigration).toContain("integrations_google_ads_no_plaintext_developer_token");
    expect(invariantMigration).toContain("service <> 'google_ads'");
    expect(invariantMigration).toContain("jsonb_typeof(metadata) <> 'object'");
    expect(invariantMigration).toContain("? 'developer_token'");
    expect(invariantMigration).toContain("? 'developerToken'");
  });

  it("does not source either developer-token alias from integration metadata at runtime", () => {
    expect(healthSource).not.toMatch(
      /metadata\s*(?:\?\.|\.)\s*(?:developer_token|developerToken)\b|metadata\s*(?:\?\.)?\s*\[\s*["'](?:developer_token|developerToken)["']\s*\]/,
    );
  });
});
