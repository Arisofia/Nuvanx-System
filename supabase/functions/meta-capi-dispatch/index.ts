import { createClient } from "jsr:@supabase/supabase-js@2";

declare const Deno: any;

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").trim();
const SERVICE_ROLE = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_ATTEMPTS = 8;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function sha256Bytes(raw: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)));
}

async function constantTimeMatch(received: string, expected: string): Promise<boolean> {
  if (!received || !expected) return false;
  const a = await sha256Bytes(received);
  const b = await sha256Bytes(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function requireServiceRole(req: Request): Promise<boolean> {
  const authorization = String(req.headers.get("authorization") || "").trim();
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? await constantTimeMatch(match[1], SERVICE_ROLE) : false;
}

function boundedError(raw: unknown): string {
  return String(raw || "Meta CAPI delivery failed").replaceAll(/\s+/g, " ").slice(0, 240);
}

function retryDelayMinutes(attempts: number): number {
  return Math.min(360, Math.max(1, 2 ** Math.max(0, attempts - 1)));
}

async function updateOutbox(admin: any, id: string, patch: Record<string, unknown>) {
  const { error } = await admin
    .from("meta_capi_outbox")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error("Meta CAPI outbox state update failed");
}

async function markFailure(admin: any, row: any, message: string, permanent: boolean) {
  const attempts = Number(row.attempts || 0);
  const dead = permanent || attempts >= MAX_ATTEMPTS;
  const nextAttempt = new Date(Date.now() + retryDelayMinutes(attempts) * 60_000).toISOString();
  await updateOutbox(admin, row.id, {
    status: dead ? "dead" : "failed",
    next_attempt_at: nextAttempt,
    last_error: boundedError(message),
  });
  return dead ? "dead" : "failed";
}

async function dispatchOne(admin: any, row: any) {
  const { data: lead, error: leadError } = await admin
    .from("leads")
    .select("id,nvx_lead_id,email,phone,source,deleted_at,fbc,fbp,ip_address,user_agent,capi_sent,enviado_a_meta")
    .eq("id", row.lead_id)
    .maybeSingle();

  if (leadError) return { id: row.id, outcome: await markFailure(admin, row, "Lead lookup failed", false) };
  if (!lead || lead.deleted_at || lead.source !== "website_hubspot" || !lead.nvx_lead_id) {
    return { id: row.id, outcome: await markFailure(admin, row, "Outbox lead is not an eligible website lead", true) };
  }

  if (lead.capi_sent === true && lead.enviado_a_meta === true) {
    await updateOutbox(admin, row.id, {
      status: "succeeded",
      delivered_at: new Date().toISOString(),
      last_error: null,
    });
    return { id: row.id, lead_id: lead.id, outcome: "already_delivered" };
  }

  const payload = {
    event_name: "Lead",
    event_id: String(row.event_id || ""),
    nvx_lead_id: String(lead.nvx_lead_id),
    email: String(lead.email || ""),
    phone: String(lead.phone || ""),
    fbc: String(lead.fbc || ""),
    fbp: String(lead.fbp || ""),
    client_ip_address: String(lead.ip_address || ""),
    user_agent: String(lead.user_agent || ""),
    nvx_is_test_lead: false,
  };

  const response = await fetch(`${SUPABASE_URL}/functions/v1/web-events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }).catch((error: unknown) => ({ networkError: error } as any));

  if ((response as any)?.networkError) {
    return {
      id: row.id,
      outcome: await markFailure(admin, row, `web-events transport failure: ${boundedError((response as any).networkError)}`, false),
    };
  }

  const httpResponse = response as Response;
  let body: any = null;
  try {
    body = await httpResponse.json();
  } catch {
    body = null;
  }

  if (!httpResponse.ok || body?.success !== true || body?.suppressed === true) {
    const permanent = [400, 413, 422].includes(httpResponse.status) || body?.suppressed === true;
    return {
      id: row.id,
      outcome: await markFailure(
        admin,
        row,
        `web-events rejected delivery status=${httpResponse.status}${body?.reason ? ` reason=${String(body.reason)}` : ""}`,
        permanent,
      ),
    };
  }

  if (String(body?.eventId || "") !== String(row.event_id || "")) {
    return { id: row.id, outcome: await markFailure(admin, row, "web-events event_id acknowledgement mismatch", false) };
  }

  const deliveredAt = new Date().toISOString();
  const { error: leadUpdateError } = await admin
    .from("leads")
    .update({ capi_sent: true, enviado_a_meta: true, updated_at: deliveredAt })
    .eq("id", lead.id)
    .is("deleted_at", null);
  if (leadUpdateError) {
    // Meta already accepted this deterministic event_id. Keep the outbox retryable;
    // the next attempt is safe because Meta deduplicates by event_id.
    return { id: row.id, outcome: await markFailure(admin, row, "Meta accepted event but lead delivery flags could not be persisted", false) };
  }

  await updateOutbox(admin, row.id, {
    status: "succeeded",
    delivered_at: deliveredAt,
    last_error: null,
  });

  return { id: row.id, lead_id: lead.id, event_id: row.event_id, outcome: "succeeded" };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ success: false, message: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ success: false, message: "Server configuration error" }, 500);
  if (!(await requireServiceRole(req))) return json({ success: false, message: "Forbidden" }, 403);

  const body = await req.json().catch(() => ({}));
  const requestedLimit = Number(body?.limit || DEFAULT_LIMIT);
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number.isFinite(requestedLimit) ? Math.trunc(requestedLimit) : DEFAULT_LIMIT));
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  try {
    const { data: claimed, error: claimError } = await admin.rpc("nvx_claim_meta_capi_outbox", { p_limit: limit });
    if (claimError) throw new Error("Meta CAPI outbox claim failed");

    const results = [];
    for (const row of claimed || []) results.push(await dispatchOne(admin, row));

    return json({
      success: true,
      processed: results.length,
      succeeded: results.filter((r: any) => r.outcome === "succeeded" || r.outcome === "already_delivered").length,
      failed: results.filter((r: any) => r.outcome === "failed").length,
      dead: results.filter((r: any) => r.outcome === "dead").length,
      results,
    });
  } catch (error: any) {
    console.error("[meta-capi-dispatch]", boundedError(error?.message || error));
    return json({ success: false, message: "Internal error" }, 500);
  }
});
