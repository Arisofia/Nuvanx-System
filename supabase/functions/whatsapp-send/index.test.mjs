import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");

describe("WhatsApp SLA tracking contract", () => {
  it("tracks only after the provider accepted the outbound message", () => {
    const providerCheck = source.indexOf("if (!waRes.ok)");
    const trackerCall = source.indexOf("trackFirstOutbound(req, leadId, messageId)");
    expect(providerCheck).toBeGreaterThan(-1);
    expect(trackerCall).toBeGreaterThan(providerCheck);
  });

  it("requires the authenticated user to own the lead", () => {
    expect(source).toContain("admin.auth.getUser(token)");
    expect(source).toContain('.eq("user_id", userId)');
    expect(source).toContain('.is("deleted_at", null)');
  });

  it("writes first_outbound_at only when no earlier response exists", () => {
    expect(source).toContain("first_outbound_at: now");
    expect(source).toContain('.is("first_outbound_at", null)');
  });

  it("records a non-PII outbound event without message content", () => {
    expect(source).toContain('source_platform: "whatsapp"');
    expect(source).toContain('event_type: "outbound_response"');
    expect(source).toContain("raw_payload: messageId ? { message_id: messageId } : {}");
    const eventBlock = source.slice(source.indexOf('.from("lead_events").insert'), source.indexOf("if (eventError)"));
    expect(eventBlock).not.toContain("message,");
    expect(eventBlock).not.toContain("body: message");
  });

  it("never converts a successful WhatsApp delivery into a business failure when SLA tracking fails", () => {
    const trackerCall = source.indexOf("trackFirstOutbound(req, leadId, messageId)");
    const successResponse = source.indexOf("success: true", trackerCall);
    expect(trackerCall).toBeGreaterThan(-1);
    expect(successResponse).toBeGreaterThan(trackerCall);
    expect(source).toContain("slaTracked: sla.tracked");
  });
});
