import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const edgePreflight = readFileSync(
  fileURLToPath(new URL("../google-ads-auth-preflight/index.ts", import.meta.url)),
  "utf8",
);
const runtimePreflight = readFileSync(
  fileURLToPath(new URL("../../../scripts/preflight-google-ads-runtime.js", import.meta.url)),
  "utf8",
);
const provisionScript = readFileSync(
  fileURLToPath(new URL("../../../scripts/provision-google-ads-developer-token.js", import.meta.url)),
  "utf8",
);

describe("Google Ads authenticated runtime boundary", () => {
  it("requires the exact canonical MCC in Edge and caller acceptance", () => {
    expect(edgePreflight).toContain('const CANONICAL_LOGIN_CUSTOMER_ID = "8265708501"');
    expect(edgePreflight).toContain("loginCustomerId !== CANONICAL_LOGIN_CUSTOMER_ID");
    expect(edgePreflight).toContain("Canonical Google Ads MCC is not directly accessible");
    expect(edgePreflight).toContain("login_customer_id: CANONICAL_LOGIN_CUSTOMER_ID");
    expect(edgePreflight).toContain("login_customer_accessible: true");

    expect(runtimePreflight).toContain("const CANONICAL_LOGIN_CUSTOMER_ID = '8265708501'");
    expect(runtimePreflight).toContain("String(payload?.login_customer_id || '') !== CANONICAL_LOGIN_CUSTOMER_ID");
    expect(runtimePreflight).toContain("payload?.login_customer_accessible !== true");
  });

  it("rejects redirects on every credential-bearing Node request in the acceptance path", () => {
    expect(runtimePreflight).toMatch(/google-ads-auth-preflight`, \{\s*method: 'POST',\s*redirect: 'error'/s);
    expect(provisionScript).toMatch(/fetchImpl\(`\$\{safeBase\}\$\{path\}`, \{\s*\.\.\.options,\s*redirect: 'error'/s);
    expect(provisionScript).toMatch(/google-ads-health`, \{\s*method: 'POST',\s*redirect: 'error'/s);
  });
});
