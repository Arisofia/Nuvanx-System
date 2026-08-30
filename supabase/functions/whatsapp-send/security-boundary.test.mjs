import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
const config = readFileSync(fileURLToPath(new URL("../_shared/config.ts", import.meta.url)), "utf8");
const migration = readFileSync(
  fileURLToPath(new URL("../../migrations/20260830090000_harden_whatsapp_outbound_delivery.sql", import.meta.url)),
  "utf8",
);

function ordered(sourceText, ...anchors) {
  let previous = -1;
  for (const anchor of anchors) {
    const current = sourceText.indexOf(anchor);
    expect(current, `missing anchor: ${anchor}`).toBeGreaterThan(-1);
    expect(current, `out-of-order anchor: ${anchor}`).toBeGreaterThan(previous);
    previous = current;
  }
}

describe("WhatsApp browser and recipient security boundary", () => {
  it("uses the canonical exact-origin allowlist and never reintroduces wildcard CORS", () => {
    expect(source).toContain('ALLOWED_CORS_ORIGINS');
    expect(source).toContain('"Vary": "Origin"');
    expect(source).not.toContain('"Access-Control-Allow-Origin": "*"');
    expect(source).toContain('isDisallowedBrowserOrigin(origin)');
    expect(source).toContain('message: "Origin not allowed" }, 403');
  });

  it("normalizes configured production and additional browser origins before exact matching", () => {
    expect(config).toContain("PRODUCTION_FALLBACK_URL = normalizeFrontendUrl(getEnv('PRODUCTION_FALLBACK_URL')) || ''");
    expect(config).toContain(".map((origin) => normalizeFrontendUrl(origin.trim()))");
    expect(config).toContain("return parsed.origin");
  });

  it("treats recipient mismatch as an authorization denial", () => {
    expect(source).toContain('message.includes("recipient_does_not_match_lead_phone")');
    expect(source).toContain('status: 403, message: "Recipient does not match the lead phone"');
  });

  it("proves phone matching happens before the send request is reserved", () => {
    ordered(
      migration,
      "v_requested_phone_digits :=",
      "recipient_does_not_match_lead_phone",
      "insert into public.whatsapp_send_requests (",
    );
  });

  it("keeps authorization and reservation before the irreversible Meta call", () => {
    ordered(
      source,
      "const auth = await authenticatedContext(req)",
      "const prepared = await prepareSend",
      "waRes = await fetch",
    );
  });
});
