import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
const handler = source.slice(source.indexOf("Deno.serve(async (req: Request) =>"));

describe("google-click-attribution HMAC trust boundary", () => {
  it("matches the WordPress domain-separated signing contract", () => {
    expect(source).toContain('const SIGNATURE_MAX_SKEW_SECONDS = 300');
    expect(source).toContain('const GOOGLE_ATTRIBUTION_HMAC_CONTEXT = "nuvanx-google-click-attribution-hmac-key-v1"');
    expect(source).toContain('req.headers.get("x-nvx-timestamp")');
    expect(source).toContain('req.headers.get("x-nvx-signature")');
    expect(source).toContain('await hmacHex(hmacKey, `${timestampRaw}.${rawBody}`)');
    expect(source).toContain('Math.abs(now - timestamp) > SIGNATURE_MAX_SKEW_SECONDS');
    expect(source).toContain('timingSafeHexMatch(receivedSignature, expected)');
  });

  it("authenticates the raw body before JSON parsing or attribution-table access", () => {
    const rawBodyIndex = handler.indexOf("const rawBody = await req.text()");
    const bodySizeIndex = handler.indexOf("new TextEncoder().encode(rawBody).byteLength > 8192");
    const authIndex = handler.indexOf("const authResult = await authenticateSignedBody(req, rawBody, admin)");
    const parseIndex = handler.indexOf("body = JSON.parse(rawBody)");
    const tableIndex = handler.indexOf('.from("google_click_attributions")');

    expect(rawBodyIndex).toBeGreaterThanOrEqual(0);
    expect(bodySizeIndex).toBeGreaterThan(rawBodyIndex);
    expect(authIndex).toBeGreaterThan(bodySizeIndex);
    expect(parseIndex).toBeGreaterThan(authIndex);
    expect(tableIndex).toBeGreaterThan(authIndex);
    expect(source).not.toContain("await req.json()");
  });

  it("fails closed before secret lookup for malformed or stale signatures", () => {
    const timestampFormatIndex = source.indexOf('if (!/^\\d{10}$/.test(timestampRaw)) return "unauthorized"');
    const signatureFormatIndex = source.indexOf('if (!/^[0-9a-fA-F]{64}$/.test(receivedSignature)) return "unauthorized"');
    const skewIndex = source.indexOf("Math.abs(now - timestamp) > SIGNATURE_MAX_SKEW_SECONDS");
    const tokenLookupIndex = source.indexOf("const token = await resolveHubspotToken(admin)");

    expect(timestampFormatIndex).toBeGreaterThanOrEqual(0);
    expect(signatureFormatIndex).toBeGreaterThan(timestampFormatIndex);
    expect(skewIndex).toBeGreaterThan(signatureFormatIndex);
    expect(tokenLookupIndex).toBeGreaterThan(skewIndex);
    expect(handler).toContain('if (authResult !== "ok")');
    expect(handler).toContain('return reply(origin, 401, { success: false, message: "Unauthorized" })');
    expect(handler).toContain('if (authResult === "bootstrap_required")');
    expect(handler).toContain('return reply(origin, 503, { success: false, message: "Runtime bootstrap required" })');
  });

  it("does not cache a Vault-resolved signing credential across requests", () => {
    expect(source).toContain("if (HUBSPOT_ACCESS_TOKEN_ENV) return HUBSPOT_ACCESS_TOKEN_ENV");
    expect(source).toContain('admin.rpc("nvx_get_runtime_secret", { p_name: "HUBSPOT_ACCESS_TOKEN" })');
    expect(source).toContain("return String(data).trim()");
    expect(source).not.toContain("runtimeHubspotAccessToken");
  });

  it("keeps the cross-language fixture byte-compatible with the WordPress sender", () => {
    const credential = "fixture-hubspot-server-credential";
    const context = "nuvanx-google-click-attribution-hmac-key-v1";
    const timestamp = "1787679000";
    const rawBody = '{"nvx_lead_id":"11111111-1111-4111-8111-111111111111","gclid":"GCLID-FIXTURE"}';

    const derived = createHmac("sha256", credential).update(context).digest("hex");
    const signature = createHmac("sha256", derived).update(`${timestamp}.${rawBody}`).digest("hex");

    expect(derived).toBe("998f4b930ffd9666e625a38328b50f7b95f846712fb51ee9489b167fd3be07f7");
    expect(signature).toBe("f376a966a2a30b364c59f8622d818a7867637e3476567d403d22c0701f958028");
  });
});
