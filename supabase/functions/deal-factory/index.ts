import { createClient } from "jsr:@supabase/supabase-js@2";

declare const Deno: any;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const HUBSPOT_ACCESS_TOKEN_ENV = Deno.env.get("HUBSPOT_ACCESS_TOKEN") || "";
const DEFAULT_OWNER_ID = (Deno.env.get("HUBSPOT_DEFAULT_DEAL_OWNER_ID") || "").trim();
const HUBSPOT_BASE = "https://api.hubapi.com";
const API_VERSION = "v3";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const CLAIM_LEASE_SECONDS = 300;
let cachedDefaultDealContactAssociationTypeId: number | null = null;
let runtimeHubspotToken = HUBSPOT_ACCESS_TOKEN_ENV.trim();

const PIPELINE_ID = "3707782370";
const STAGES = Object.freeze({
  newLead: "5159669951",
  contacted: "5159669952",
  qualified: "5159669953",
  budgetAccepted: "5159669954",
  valuationScheduled: "5159669955",
  valuationAttended: "5159669956",
  pendingDecision: "5159666892",
  won: "5159669957",
  lostNoResponse: "5159666893",
  lostLocation: "5159666894",
  lostOther: "5159666895",
});

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function sha256Bytes(raw: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)));
}

async function secretMatches(received: string, expected: string): Promise<boolean> {
  if (!received || !expected) return false;
  const a = await sha256Bytes(received);
  const b = await sha256Bytes(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function requireServiceRole(req: Request): Promise<boolean> {
  const auth = String(req.headers.get("Authorization") || "").trim();
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? await secretMatches(match[1], SERVICE_ROLE) : false;
}

async function resolveHubspotToken(admin: any): Promise<string> {
  if (runtimeHubspotToken) return runtimeHubspotToken;
  const { data, error } = await admin.rpc("nvx_get_runtime_secret", { p_name: "HUBSPOT_ACCESS_TOKEN" });
  if (error || !data) throw new Error("HubSpot runtime credential unavailable");
  runtimeHubspotToken = String(data).trim();
  return runtimeHubspotToken;
}

async function hubspot(path: string, init: RequestInit = {}) {
  if (!runtimeHubspotToken) throw new Error("HubSpot runtime credential unavailable");
  const response = await fetch(`${HUBSPOT_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${runtimeHubspotToken}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let payload: any = null;
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }
  if (!response.ok) throw new Error(`HubSpot ${response.status}`);
  return payload;
}

function truthy(value: unknown) {
  return value === true || value === 1 || value === "1" || String(value || "").toLowerCase() === "true";
}

function dealName(leadId: string) {
  return `NUVANX · ${leadId}`;
}

function chooseStage(lead: any): string {
  if (Number(lead.verified_revenue || 0) > 0) return STAGES.won;
  if (lead.attended_at) return STAGES.valuationAttended;
  if (lead.appointment_date) return STAGES.valuationScheduled;
  if (lead.first_response_at || lead.first_outbound_at) return STAGES.contacted;
  return STAGES.newLead;
}

function dealProperties(lead: any, projection: any) {
  const amount = Number(lead.verified_revenue || lead.revenue || 0);
  const properties: Record<string, string> = {
    dealname: dealName(lead.id),
    pipeline: PIPELINE_ID,
    dealstage: chooseStage(lead),
    deal_currency_code: projection.currency_code || "EUR",
  };

  const ownerId = String(projection.owner_id || DEFAULT_OWNER_ID || "").trim();
  if (/^\d+$/.test(ownerId)) properties.hubspot_owner_id = ownerId;
  if (Number.isFinite(amount) && amount > 0) properties.amount = amount.toFixed(2);
  if (lead.appointment_date) properties.fecha_de_valoracion = new Date(lead.appointment_date).toISOString().slice(0, 10);
  return properties;
}

async function verifyContact(contactId: string) {
  if (!/^\d+$/.test(contactId)) throw new Error("Invalid HubSpot contact id");
  const payload = await hubspot(`/crm/v3/objects/contacts/${contactId}?properties=nvx_is_test_lead,nvx_lead_id`);
  if (truthy(payload?.properties?.nvx_is_test_lead)) throw new Error("QA contact suppressed");
  return payload;
}

async function findExistingDeal(name: string) {
  const payload = await hubspot(`/crm/v3/objects/deals/search`, {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: "dealname", operator: "EQ", value: name }] }],
      properties: ["dealname", "dealstage", "pipeline"],
      limit: 5,
      after: "0",
      sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
    }),
  });
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const exact = results.find((r: any) => String(r?.properties?.dealname || "").trim() === name.trim());
  return exact || results[0] || null;
}

async function defaultDealContactAssociationTypeId(): Promise<number> {
  if (cachedDefaultDealContactAssociationTypeId !== null) return cachedDefaultDealContactAssociationTypeId;
  try {
    const payload = await hubspot(`/crm/v3/associations/deals/contacts/types`);
    const results = Array.isArray(payload?.results) ? payload.results : [];
    const defaultType = results.find((item: any) => item?.category === "HUBSPOT_DEFINED" && (item?.label === null || item?.label === ""));
    const fallback = defaultType || results.find((item: any) => item?.category === "HUBSPOT_DEFINED");
    const id = Number(fallback?.typeId || fallback?.id || 3);
    if (Number.isInteger(id) && id > 0) {
      cachedDefaultDealContactAssociationTypeId = id;
      return id;
    }
  } catch (_e) {
    // Standard HubSpot deal-to-contact association ID is 3
  }
  cachedDefaultDealContactAssociationTypeId = 3;
  return 3;
}

async function ensureAssociation(dealId: string, contactId: string) {
  const typeId = await defaultDealContactAssociationTypeId();
  await hubspot(`/crm/v3/objects/deals/${dealId}/associations/contacts/${contactId}/${typeId}`, { method: "PUT" });
}

async function createOrRecoverDeal(lead: any, projection: any) {
  const name = dealName(lead.id);
  const existing = await findExistingDeal(name);
  if (existing?.id) {
    await ensureAssociation(String(existing.id), String(projection.hubspot_contact_id)).catch(() => {});
    return { id: String(existing.id), created: false };
  }

  const payload = await hubspot(`/crm/v3/objects/deals`, {
    method: "POST",
    body: JSON.stringify({
      properties: dealProperties(lead, projection),
      associations: [
        {
          to: { id: String(projection.hubspot_contact_id) },
          types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }],
        },
      ],
    }),
  });
  const dealId = String(payload?.id || "");
  if (!/^\d+$/.test(dealId)) throw new Error("HubSpot create did not return Deal id");
  await ensureAssociation(dealId, String(projection.hubspot_contact_id)).catch(() => {});
  return { id: dealId, created: true };
}

async function updateExistingDeal(dealId: string, lead: any, projection: any) {
  await hubspot(`/crm/v3/objects/deals/${dealId}`, {
    method: "PATCH",
    body: JSON.stringify({ properties: dealProperties(lead, projection) }),
  });
  await ensureAssociation(dealId, String(projection.hubspot_contact_id));
  return dealId;
}

async function finalizeProjection(
  admin: any,
  projection: any,
  outcome: "success" | "failed" | "suppressed",
  details: { dealId?: string | null; stageId?: string | null; amount?: number | null; error?: string | null } = {},
): Promise<string> {
  const claimToken = String(projection?.claim_token || "").trim();
  if (!claimToken) return "claim_lost";

  const numericDealId = details.dealId && /^\d+$/.test(details.dealId) ? Number(details.dealId) : null;
  const { data, error } = await admin.rpc("nvx_finalize_hubspot_deal_projection", {
    p_lead_id: projection.lead_id,
    p_claim_token: claimToken,
    p_outcome: outcome,
    p_hubspot_deal_id: numericDealId,
    p_stage_id: details.stageId || null,
    p_amount: details.amount ?? null,
    p_error: details.error || null,
  });
  if (error) throw new Error("Projection finalization unavailable");
  return String(data || "claim_lost");
}

async function failClaim(admin: any, projection: any, error: unknown) {
  const message = String((error as any)?.message || "Deal projection failed").slice(0, 240);
  try {
    const finalStatus = await finalizeProjection(admin, projection, "failed", { error: message });
    if (finalStatus === "claim_lost") {
      return { lead_id: projection.lead_id, outcome: "claim_lost" };
    }
  } catch (finalizeError: any) {
    console.error(`[deal-factory] lead=${projection.lead_id} finalize_error=${String(finalizeError?.message || "error").slice(0, 120)}`);
    return { lead_id: projection.lead_id, outcome: "finalize_error" };
  }
  return { lead_id: projection.lead_id, outcome: "failed", error: message };
}

async function processProjection(admin: any, projection: any) {
  try {
    const { data: lead, error: leadError } = await admin
      .from("leads")
      .select("id,source,stage,revenue,verified_revenue,appointment_date,attended_at,first_response_at,first_outbound_at,hubspot_contact_id,hubspot_deal_id")
      .eq("id", projection.lead_id)
      .is("deleted_at", null)
      .single();
    if (leadError || !lead) throw new Error("Projection lead missing");

    const sourceNorm = String(lead.source || "").toLowerCase().trim();
    const validSources = new Set([
      "website_hubspot",
      "meta_leadgen",
      "meta_instant_form",
      "meta_ads",
      "meta",
      "facebook",
      "instagram",
      "website",
      "landing_page",
      "whatsapp",
      "direct",
      "phone",
      "doctoralia",
    ]);
    if (!validSources.has(sourceNorm)) throw new Error(`Unsupported lead source for Deal Factory: ${lead.source}`);
    if (String(lead.hubspot_contact_id || "") !== String(projection.hubspot_contact_id || "")) {
      throw new Error("Contact projection mismatch");
    }

    try {
      await verifyContact(String(projection.hubspot_contact_id));
    } catch (error: any) {
      if (String(error?.message || "").includes("QA contact")) {
        const finalStatus = await finalizeProjection(admin, projection, "suppressed");
        return { lead_id: lead.id, outcome: finalStatus === "claim_lost" ? "claim_lost" : "suppressed" };
      }
      throw error;
    }

    let result;
    const knownDealId = String(projection.hubspot_deal_id || lead.hubspot_deal_id || "");
    if (/^\d+$/.test(knownDealId)) {
      await updateExistingDeal(knownDealId, lead, projection);
      result = { id: knownDealId, created: false };
    } else {
      result = await createOrRecoverDeal(lead, projection);
    }

    const amountValue = Number(lead.verified_revenue || lead.revenue || 0);
    const stageId = chooseStage(lead);
    const finalStatus = await finalizeProjection(admin, projection, "success", {
      dealId: result.id,
      stageId,
      amount: Number.isFinite(amountValue) && amountValue > 0 ? amountValue : null,
    });

    if (finalStatus === "claim_lost") {
      return { lead_id: lead.id, hubspot_deal_id: result.id, outcome: "claim_lost" };
    }

    await admin.from("leads").update({ hubspot_deal_id: result.id, updated_at: new Date().toISOString() }).eq("id", lead.id);
    if (finalStatus === "pending") {
      return { lead_id: lead.id, hubspot_deal_id: result.id, outcome: "requeued" };
    }
    return { lead_id: lead.id, hubspot_deal_id: result.id, outcome: result.created ? "created" : "updated" };
  } catch (error: any) {
    return await failClaim(admin, projection, error);
  }
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
    await resolveHubspotToken(admin);
  } catch (error: any) {
    console.error("[deal-factory]", error?.message || error);
    return json({ success: false, message: "Server configuration error" }, 500);
  }

  const { data: rows, error } = await admin.rpc("nvx_claim_hubspot_deal_projections", {
    p_limit: limit,
    p_lease_seconds: CLAIM_LEASE_SECONDS,
  });
  if (error) return json({ success: false, message: "Projection queue unavailable" }, 500);

  const results = [];
  for (const projection of rows || []) {
    results.push(await processProjection(admin, projection));
  }

  return json({
    success: true,
    processed: results.length,
    created_or_updated: results.filter((r: any) => r.outcome === "created" || r.outcome === "updated").length,
    requeued: results.filter((r: any) => r.outcome === "requeued").length,
    suppressed: results.filter((r: any) => r.outcome === "suppressed").length,
    failed: results.filter((r: any) => r.outcome === "failed" || r.outcome === "finalize_error").length,
    claim_lost: results.filter((r: any) => r.outcome === "claim_lost").length,
    results,
  });
});
