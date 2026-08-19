import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
const migration = readFileSync(
  fileURLToPath(new URL("../../migrations/20260819185655_sla_human_first_response.sql", import.meta.url)),
  "utf8",
);

describe("WhatsApp human first-response SLA contract", () => {
  it("tracks only after the provider accepted the outbound text", () => {
    const providerCheck = source.indexOf("if (!waRes.ok)");
    const trackerCall = source.indexOf("trackFirstHumanResponse(req, leadId, messageId)");
    expect(providerCheck).toBeGreaterThan(-1);
    expect(trackerCall).toBeGreaterThan(providerCheck);
    expect(source).toContain('type: "text"');
  });

  it("requires the authenticated user to own the lead", () => {
    expect(source).toContain("admin.auth.getUser(token)");
    expect(source).toContain('.eq("user_id", userId)');
    expect(source).toContain('.is("deleted_at", null)');
    expect(source).toContain('rpc("mark_lead_human_first_response"');
  });

  it("atomically preserves first outbound and first human response", () => {
    expect(migration).toContain("first_outbound_at = coalesce(l.first_outbound_at, p_sent_at)");
    expect(migration).toContain("first_response_at = coalesce(l.first_response_at, l.first_outbound_at, p_sent_at)");
    expect(migration).toContain("and l.user_id = p_user_id");
    expect(migration).toContain("grant execute on function public.mark_lead_human_first_response(uuid,uuid,timestamptz) to service_role");
  });

  it("records actor provenance without message content", () => {
    expect(source).toContain('source_platform: "whatsapp"');
    expect(source).toContain('event_type: "outbound_response"');
    expect(source).toContain('actor: "human_authenticated"');
    expect(source).toContain("sla_first_response_at: firstResponseAt");
    const eventBlock = source.slice(source.indexOf('.from("lead_events").insert'), source.indexOf("if (eventError)"));
    expect(eventBlock).not.toContain("message,");
    expect(eventBlock).not.toContain("body: message");
  });

  it("does not infer first response from inbound traffic, templates, bots, or delivery receipts", () => {
    const trackingBlock = source.slice(source.indexOf("async function trackFirstHumanResponse"), source.indexOf("Deno.serve"));
    expect(trackingBlock).not.toMatch(/template_name|replied_at|direction\s*:\s*["']inbound["']/);
  });

  it("never converts a successful WhatsApp send into a business failure when SLA telemetry fails", () => {
    const trackerCall = source.indexOf("trackFirstHumanResponse(req, leadId, messageId)");
    const successResponse = source.indexOf("success: true", trackerCall);
    expect(trackerCall).toBeGreaterThan(-1);
    expect(successResponse).toBeGreaterThan(trackerCall);
    expect(source).toContain("slaTracked: sla.tracked");
    expect(source).toContain("slaFirstResponseAt: sla.first_response_at || null");
  });
});
