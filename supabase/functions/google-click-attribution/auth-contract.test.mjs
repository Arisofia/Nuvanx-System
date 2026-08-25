import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
const handler = source.slice(source.indexOf("Deno.serve(async (req: Request) =>"));

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
    const readBody = handler.indexOf("const rawBody = await req.text()");
    const bodySize = handler.indexOf("new TextEncoder().encode(rawBody).byteLength > 8192");
    const authenticate = handler.indexOf("const authentication = await authenticateRelay(req, rawBody)");
    const parse = handler.indexOf("body = JSON.parse(rawBody)");
    const client = handler.indexOf("const admin = createClient(SUPABASE_URL, SERVICE_ROLE");
    const dbAccess = handler.indexOf('.from("google_click_attributions")');

    expect(readBody).toBeGreaterThan(-1);
    expect(bodySize).toBeGreaterThan(readBody);
    expect(authenticate).toBeGreaterThan(bodySize);
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

  it("matches the exact cross-language sender fixture", () => {
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
