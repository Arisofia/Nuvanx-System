import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function cleanUuid(value: unknown): string | null {
  const v = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v) ? v : null;
}

function normalizePhone(value: unknown): string {
  const raw = String(value || "").trim();
  const hasLeadingPlus = raw.startsWith("+");
  const digits = raw.replace(/\D/g, "");
  return `${hasLeadingPlus ? "+" : ""}${digits}`;
}

function bearerToken(req: Request): string | null {
  const header = String(req.headers.get("Authorization") || "").trim();
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  return token || null;
}

type AuthorizedLeadContext = {
  ok: true;
  admin: ReturnType<typeof createClient> | null;
  userId: string | null;
};

type RejectedLeadContext = {
  ok: false;
  status: number;
  message: string;
};

async function authorizeLeadRecipient(
  req: Request,
  leadId: string | null,
  normalizedTo: string,
): Promise<AuthorizedLeadContext | RejectedLeadContext> {
  if (!leadId) return { ok: true, admin: null, userId: null };
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return { ok: false, status: 500, message: "Lead authorization is not configured" };
  }

  const token = bearerToken(req);
  if (!token) return { ok: false, status: 401, message: "Authenticated user context is required" };

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    const userId = authData?.user?.id || "";
    if (authError || !userId) return { ok: false, status: 401, message: "Authenticated user context is invalid" };

    const { data: lead, error: leadError } = await admin
      .from("leads")
      .select("id,user_id,phone")
      .eq("id", leadId)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();

    if (leadError || !lead?.id) {
      return { ok: false, status: 403, message: "Lead is not available to this user" };
    }

    const storedPhone = normalizePhone(lead.phone);
    if (!storedPhone) return { ok: false, status: 409, message: "Lead has no WhatsApp phone registered" };
    if (storedPhone !== normalizedTo) {
      return { ok: false, status: 409, message: "Recipient does not match the lead phone" };
    }

    return { ok: true, admin, userId };
  } catch {
    return { ok: false, status: 500, message: "Lead authorization failed" };
  }
}

async function trackFirstHumanResponse(
  admin: ReturnType<typeof createClient> | null,
  userId: string | null,
  leadId: string | null,
  messageId: string | null,
) {
  if (!leadId) return { tracked: false, reason: "lead_id_not_provided" };
  if (!admin || !userId) return { tracked: false, reason: "tracking_context_missing" };

  try {
    const sentAt = new Date().toISOString();
    const { data: slaRows, error: slaError } = await admin.rpc("mark_lead_human_first_response", {
      p_lead_id: leadId,
      p_user_id: userId,
      p_sent_at: sentAt,
    });
    if (slaError || !Array.isArray(slaRows) || slaRows.length !== 1) {
      return { tracked: false, reason: "lead_update_failed" };
    }

    const firstResponseAt = String(slaRows[0]?.first_response_at || "") || null;
    const { error: eventError } = await admin.from("lead_events").insert({
      lead_id: leadId,
      source_platform: "whatsapp",
      source_channel: "direct",
      channel_label: "WhatsApp",
      event_type: "outbound_response",
      event_created_at: sentAt,
      captured_at: sentAt,
      resolution_status: "resolved",
      raw_payload: {
        ...(messageId ? { message_id: messageId } : {}),
        actor: "human_authenticated",
        sla_first_response_at: firstResponseAt,
      },
    });
    if (eventError) {
      return {
        tracked: true,
        event_recorded: false,
        reason: "event_insert_failed",
        first_response_at: firstResponseAt,
      };
    }

    return { tracked: true, event_recorded: true, first_response_at: firstResponseAt };
  } catch {
    return { tracked: false, reason: "tracking_failed" };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });

  if (req.method !== "POST") return json({ success: false, message: "POST required" }, 405);

  const body = await req.json().catch(() => ({}));
  const normalizedTo = normalizePhone(body?.to);
  const message = String(body?.message || "");
  const leadId = body?.lead_id === undefined || body?.lead_id === null || body?.lead_id === ""
    ? null
    : cleanUuid(body.lead_id);

  if (!normalizedTo || !message) return json({ success: false, message: "to and message are required" }, 400);
  if (body?.lead_id && !leadId) return json({ success: false, message: "lead_id must be a UUID" }, 400);
  if (message.length > 4096) return json({ success: false, message: "message is too long" }, 400);
  if (!/^\+?[1-9]\d{7,14}$/.test(normalizedTo)) {
    return json({ success: false, message: "to must be a valid phone number in E.164 format (+34XXXXXXXXX)" }, 400);
  }

  // Authorization MUST happen before any irreversible provider call.
  // When a lead_id is supplied, the destination must equal that owned lead's stored phone.
  const authorized = await authorizeLeadRecipient(req, leadId, normalizedTo);
  if (!authorized.ok) {
    return json({ success: false, message: authorized.message }, authorized.status);
  }

  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
  const graphVersion = Deno.env.get("META_GRAPH_VERSION") ?? "v22.0";

  if (!accessToken || !phoneNumberId) {
    return json({ success: false, message: "WhatsApp not configured" }, 503);
  }

  const waRes = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizedTo,
      type: "text",
      text: { preview_url: false, body: message },
    }),
  });

  const waData = await waRes.json().catch(() => ({}));

  if (!waRes.ok) {
    return json({ success: false, message: "WhatsApp provider error", providerStatus: waRes.status }, waRes.status);
  }

  const messageId = String(waData?.messages?.[0]?.id || "") || null;
  const sla = await trackFirstHumanResponse(authorized.admin, authorized.userId, leadId, messageId);

  return json({
    success: true,
    messageId,
    to: normalizedTo,
    slaTracked: sla.tracked,
    slaEventRecorded: sla.event_recorded === true,
    slaFirstResponseAt: sla.first_response_at || null,
    slaTrackingReason: sla.tracked && sla.event_recorded !== false ? null : sla.reason || null,
  });
});
