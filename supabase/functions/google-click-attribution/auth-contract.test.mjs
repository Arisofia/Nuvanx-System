import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");

describe("google-click-attribution HMAC boundary", () => {
  it("uses the same domain-separated signing contract as the WordPress sender", () => {
    expect(source).toContain('const HMAC_CONTEXT = "nuvanx-google-click-attribution-hmac-key-v1"');
    expect(source).toContain('req.headers.get("x-nvx-timestamp")');
    expect(source).toContain('req.headers.get("x-nvx-signature")');
    expect(source).toContain("const derivedKey = await hmacHex(HUBSPOT_ACCESS_TOKEN, HMAC_CONTEXT)");
    expect(source).toContain('await hmacHex(derivedKey, `${timestampRaw}.${rawBody}`)');
    expect(source).toContain("MAX_SIGNATURE_SKEW_SECONDS = 300");
  });

  it("authenticates the raw request before JSON parsing or service-role client creation", () => {
    const readBody = source.indexOf("const rawBody = await req.text()");
    const authenticate = source.indexOf("const authentication = await authenticateRelay(req, rawBody)");
    const parse = source.indexOf("body = JSON.parse(rawBody)");
    const client = source.indexOf("const admin = createClient(SUPABASE_URL, SERVICE_ROLE");
    const dbAccess = source.indexOf('admin.from("google_click_attributions")');

    expect(readBody).toBeGreaterThan(-1);
    expect(authenticate).toBeGreaterThan(readBody);
    expect(parse).toBeGreaterThan(authenticate);
    expect(client).toBeGreaterThan(authenticate);
    expect(dbAccess).toBeGreaterThan(client);
  });

  it("does not use service-role database access to discover the signing key", () => {
    const authFunction = source.slice(
      source.indexOf("async function authenticateRelay"),
      source.indexOf("function cleanClickId"),
    );
    expect(authFunction).toContain("HUBSPOT_ACCESS_TOKEN");
    expect(authFunction).not.toContain("createClient(");
    expect(authFunction).not.toContain(".from(");
    expect(authFunction).not.toContain("rpc(");
  });

  it("keeps Origin as defense-in-depth and exposes only required CORS headers", () => {
    expect(source).toContain("ALLOWED_ORIGINS.has(origin)");
    expect(source).toContain('"Access-Control-Allow-Headers": "content-type,x-nvx-timestamp,x-nvx-signature"');
  });
});
