import { createClient } from "jsr:@supabase/supabase-js@2";

declare const Deno: any;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const HUBSPOT_ACCESS_TOKEN = Deno.env.get("HUBSPOT_ACCESS_TOKEN") || "";
const DEFAULT_OWNER_ID = (Deno.env.get("HUBSPOT_DEFAULT_DEAL_OWNER_ID") || "").trim();
const HUBSPOT_BASE = "https://api.hubapi.com";
const API_VERSION = "2026-03";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

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

async function hubspot(path: string, init: RequestInit = {}) {
  const response = await fetch(`${HUBSPOT_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
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
  const payload = await hubspot(`/crm/objects/${API_VERSION}/contacts/${contactId}?properties=nvx_is_test_lead,nvx_lead_id`);
  if (truthy(payload?.properties?.nvx_is_test_lead)) throw new Error("QA contact suppressed");
  return payload;
}

async function findExistingDeal(name: string) {
  const payload = await hubspot(`/crm/objects/${API_VERSION}/deals/search`, {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: "dealname", operator: "EQ", value: name }] }],
      properties: ["dealname", "dealstage", "pipeline"],
      limit: 2,
      after: "0",
      sorts: [],
    }),
  });
  const results = Array.isArray(payload?.results) ? payload.results : [];
  if (results.length > 1) throw new Error("Duplicate deterministic Deal key");
  return results[0] || null;
}

async function defaultDealContactAssociationTypeId(): Promise<number> {
  const payload = await hubspot(`/crm/associations/${API_VERSION}/deals/contacts/labels`);
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const defaultType = results.find((item: any) => item?.category === "HUBSPOT_DEFINED" && (item?.label === null || item?.label === ""));
  const fallback = defaultType || results.find((item: any) => item?.category === "HUBSPOT_DEFINED");
  const id = Number(fallback?.typeId);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Default deal-contact association unavailable");
  return id;
}

async function ensureAssociation(dealId: string, contactId: string) {
  const typeId = await defaultDealContactAssociationTypeId();
  await hubspot(`/crm/objects/${API_VERSION}/deals/${dealId}/associations/contacts/${contactId}/${typeId}`, { method: "PUT" });
}

async function createOrRecoverDeal(lead: any, projection: any) {
  const name = dealName(lead.id);
  const existing = await findExistingDeal(name);
  if (existing?.id) {
    await ensureAssociation(String(existing.id), String(projection.hubspot_contact_id));
    return { id: String(existing.id), created: false };
  }

  const payload = await hubspot(`/crm/objects/${API_VERSION}/deals`, {
    method: "POST",
    body: JSON.stringify({ properties: dealProperties(lead, projection), associations: [] }),
  });
  const dealId = String(payload?.id || "");
  if (!/^\d+$/.test(dealId)) throw new Error("HubSpot create did not return Deal id");
  await ensureAssociation(dealId, String(projection.hubspot_contact_id));
  return { id: dealId, created: true };
}

async function updateExistingDeal(dealId: string, lead: any, projection: any) {
  await hubspot(`/crm/objects/${API_VERSION}/deals/${dealId}`, {
    method: "PATCH",
    body: JSON.stringify({ properties: dealProperties(lead, projection) }),
  });
  await ensureAssociation(dealId, String(projection.hubspot_contact_id));
  return dealId;
}

async function processProjection(admin: any, projection: any) {
  const now = new Date().toISOString();
  const { data: lead, error: leadError } = await admin
    .from("leads")
    .select("id,source,stage,revenue,verified_revenue,appointment_date,attended_at,first_response_at,first_outbound_at,hubspot_contact_id,hubspot_deal_id")
    .eq("id", projection.lead_id)
    .is("deleted_at", null)
    .single();
  if (leadError || !lead) throw new Error("Projection lead missing");
  if (lead.source !== "website_hubspot") throw new Error("Deal Factory only accepts website_hubspot leads");
  if (String(lead.hubspot_contact_id || "") !== String(projection.hubspot_contact_id || "")) throw new Error("Contact projection mismatch");

  try {
    await verifyContact(String(projection.hubspot_contact_id));
  } catch (error: any) {
    if (String(error?.message || "").includes("QA contact")) {
      await admin.from("hubspot_deal_projections").update({ projection_status: "suppressed", last_error: null, updated_at: now }).eq("lead_id", lead.id);
      return { lead_id: lead.id, outcome: "suppressed" };
    }
    throw error;
  }

  await admin.from("hubspot_deal_projections").update({
    projection_status: projection.hubspot_deal_id ? "updating" : "creating",
    attempt_count: Number(projection.attempt_count || 0) + 1,
    last_error: null,
    updated_at: now,
  }).eq("lead_id", lead.id);

  try {
    let result;
    const knownDealId = String(projection.hubspot_deal_id || lead.hubspot_deal_id || "");
    if (/^\d+$/.test(knownDealId)) {
      await updateExistingDeal(knownDealId, lead, projection);
      result = { id: knownDealId, created: false };
    } else {
      result = await createOrRecoverDeal(lead, projection);
    }

    await admin.from("hubspot_deal_projections").update({
      hubspot_deal_id: result.id,
      stage_id: chooseStage(lead),
      amount: Number(lead.verified_revenue || lead.revenue || 0) || null,
      projection_status: "created",
      projected_at: now,
      last_error: null,
      updated_at: now,
    }).eq("lead_id", lead.id);

    await admin.from("leads").update({ hubspot_deal_id: result.id, updated_at: now }).eq("id", lead.id);
    return { lead_id: lead.id, hubspot_deal_id: result.id, outcome: result.created ? "created" : "updated" };
  } catch (error: any) {
    const message = String(error?.message || "Deal projection failed").slice(0, 240);
    await admin.from("hubspot_deal_projections").update({ projection_status: "failed", last_error: message, updated_at: now }).eq("lead_id", lead.id);
    return { lead_id: lead.id, outcome: "failed", error: message };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ success: false, message: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE || !HUBSPOT_ACCESS_TOKEN) return json({ success: false, message: "Server configuration error" }, 500);

  const body = await req.json().catch(() => ({}));
  const requestedLimit = Number(body?.limit || DEFAULT_LIMIT);
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number.isFinite(requestedLimit) ? Math.trunc(requestedLimit) : DEFAULT_LIMIT));
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const { data: rows, error } = await admin
    .from("hubspot_deal_projections")
    .select("lead_id,hubspot_contact_id,hubspot_deal_id,pipeline_id,stage_id,owner_id,amount,currency_code,projection_status,attempt_count")
    .in("projection_status", ["pending", "failed", "created"])
    .order("updated_at", { ascending: true })
    .limit(limit);
  if (error) return json({ success: false, message: "Projection queue unavailable" }, 500);

  const results = [];
  for (const projection of rows || []) {
    try {
      results.push(await processProjection(admin, projection));
    } catch (error: any) {
      const message = String(error?.message || "Projection failed").slice(0, 240);
      await admin.from("hubspot_deal_projections").update({ projection_status: "failed", last_error: message, updated_at: new Date().toISOString() }).eq("lead_id", projection.lead_id);
      results.push({ lead_id: projection.lead_id, outcome: "failed", error: message });
    }
  }

  return json({
    success: true,
    processed: results.length,
    created_or_updated: results.filter((r: any) => r.outcome === "created" || r.outcome === "updated").length,
    suppressed: results.filter((r: any) => r.outcome === "suppressed").length,
    failed: results.filter((r: any) => r.outcome === "failed").length,
    results,
  });
});
