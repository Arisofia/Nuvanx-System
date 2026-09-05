import { describe, expect, it } from "vitest";
import { sendWhatsAppText } from "./whatsapp-provider.ts";

const base = {
  accessToken: "test-token",
  phoneNumberId: "123456789",
  graphVersion: "v22.0",
  to: "34600000000",
  message: "controlled acceptance message",
};

describe("shared WhatsApp provider transport", () => {
  it("classifies a provider success with message id as accepted", async () => {
    const outcome = await sendWhatsAppText({
      ...base,
      fetchImpl: async () => new Response(JSON.stringify({ messages: [{ id: "wamid.test" }] }), { status: 200 }),
    });
    expect(outcome).toEqual({
      status: "accepted",
      providerMessageId: "wamid.test",
      providerHttpStatus: 200,
      errorCode: null,
      errorMessage: null,
    });
  });

  it("classifies deterministic 4xx provider rejection as failed", async () => {
    const outcome = await sendWhatsAppText({
      ...base,
      fetchImpl: async () => new Response(JSON.stringify({ error: { code: 131000, message: "Rejected" } }), { status: 400 }),
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.providerHttpStatus).toBe(400);
    expect(outcome.errorCode).toBe("131000");
  });

  it("classifies 5xx provider rejection as unknown and non-replayable", async () => {
    const outcome = await sendWhatsAppText({
      ...base,
      fetchImpl: async () => new Response(JSON.stringify({ error: { code: 1, message: "Provider unavailable" } }), { status: 503 }),
    });
    expect(outcome.status).toBe("unknown");
    expect(outcome.providerHttpStatus).toBe(503);
  });

  it("classifies transport failure as unknown", async () => {
    const outcome = await sendWhatsAppText({
      ...base,
      fetchImpl: async () => {
        throw new DOMException("timeout", "TimeoutError");
      },
    });
    expect(outcome.status).toBe("unknown");
    expect(outcome.providerHttpStatus).toBeNull();
    expect(outcome.errorCode).toBe("TimeoutError");
  });

  it("classifies success without provider message id as unknown", async () => {
    const outcome = await sendWhatsAppText({
      ...base,
      fetchImpl: async () => new Response(JSON.stringify({ messages: [] }), { status: 200 }),
    });
    expect(outcome.status).toBe("unknown");
    expect(outcome.errorCode).toBe("missing_provider_message_id");
  });

  it("fails closed before network on incomplete provider configuration", async () => {
    let called = false;
    const outcome = await sendWhatsAppText({
      ...base,
      accessToken: "",
      fetchImpl: async () => {
        called = true;
        return new Response("{}", { status: 200 });
      },
    });
    expect(called).toBe(false);
    expect(outcome.status).toBe("failed");
    expect(outcome.errorCode).toBe("provider_configuration_invalid");
  });
});
