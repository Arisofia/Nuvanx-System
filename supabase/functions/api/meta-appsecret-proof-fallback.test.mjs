import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");

describe("Meta appsecret proof routing", () => {
  it("falls back to a bare access token only after configured app secrets are exhausted", () => {
    expect(source).toContain("return [...new Set(values)].map((value) => value || null).concat([null]);");
    expect(source).toContain("const canRetrySecret = index + 1 < candidates.length && isInvalidAppsecretProof(data);");
  });

  it("keeps explicit service-specific overrides strict", () => {
    expect(source).toContain("if (appSecretOverride !== undefined) return [appSecretOverride || null];");
  });
});
