export type WhatsAppProviderOutcomeStatus = "accepted" | "failed" | "unknown";

export type WhatsAppProviderOutcome = {
  status: WhatsAppProviderOutcomeStatus;
  providerMessageId: string | null;
  providerHttpStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type SendWhatsAppTextInput = {
  accessToken: string;
  phoneNumberId: string;
  graphVersion: string;
  to: string;
  message: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
};

function providerError(data: any): { code: string | null; message: string } {
  const error = data?.error || data?.errors?.[0] || null;
  return {
    code: error?.code === undefined || error?.code === null ? null : String(error.code),
    message: String(error?.message || data?.message || "WhatsApp provider error").slice(0, 500),
  };
}

export async function sendWhatsAppText(input: SendWhatsAppTextInput): Promise<WhatsAppProviderOutcome> {
  const accessToken = String(input.accessToken || "").trim();
  const phoneNumberId = String(input.phoneNumberId || "").trim();
  const graphVersion = String(input.graphVersion || "").trim();
  const to = String(input.to || "").trim();
  const message = String(input.message || "");
  const timeoutMs = Math.max(1, Number(input.timeoutMs || 10_000));
  const fetchImpl = input.fetchImpl || fetch;

  if (!accessToken || !phoneNumberId || !graphVersion || !to || !message) {
    return {
      status: "failed",
      providerMessageId: null,
      providerHttpStatus: null,
      errorCode: "provider_configuration_invalid",
      errorMessage: "WhatsApp provider request configuration is incomplete",
    };
  }

  let response: Response;
  let payload: any = {};
  try {
    response = await fetchImpl(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: message },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    payload = await response.json().catch(() => ({}));
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.name : "provider_transport_error";
    return {
      status: "unknown",
      providerMessageId: null,
      providerHttpStatus: null,
      errorCode: reason,
      errorMessage: "Meta provider outcome is unknown after transport failure",
    };
  }

  const explicitProviderError = Boolean(payload?.error || payload?.success === false);
  const providerMessageId = String(payload?.messages?.[0]?.id || "").trim() || null;

  if (!response.ok || explicitProviderError) {
    const provider = providerError(payload);
    const ambiguous = response.status >= 500;
    return {
      status: ambiguous ? "unknown" : "failed",
      providerMessageId: null,
      providerHttpStatus: response.status,
      errorCode: provider.code,
      errorMessage: provider.message,
    };
  }

  if (!providerMessageId) {
    return {
      status: "unknown",
      providerMessageId: null,
      providerHttpStatus: response.status,
      errorCode: "missing_provider_message_id",
      errorMessage: "Meta returned success without a message id",
    };
  }

  return {
    status: "accepted",
    providerMessageId,
    providerHttpStatus: response.status,
    errorCode: null,
    errorMessage: null,
  };
}
