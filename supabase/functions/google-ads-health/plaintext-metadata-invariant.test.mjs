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

  it("enforces the invariant in the database after cleanup", () => {
    expect(migration).toContain("integrations_google_ads_no_plaintext_developer_token");
    expect(migration).toContain("service <> 'google_ads'");
    expect(migration).toContain("? 'developer_token'");
    expect(migration).toContain("? 'developerToken'");
    expect(migration).toContain("ADD CONSTRAINT integrations_google_ads_no_plaintext_developer_token");
  });

  it("does not source the developer token from integration metadata at runtime", () => {
    expect(healthSource).not.toContain("metadata.developer_token");
    expect(healthSource).not.toContain("metadata.developerToken");
    expect(healthSource).not.toContain("metadata['developer_token']");
    expect(healthSource).not.toContain('metadata["developer_token"]');
  });
});
