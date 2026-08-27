import { createClient } from "jsr:@supabase/supabase-js@2";

declare const Deno: any;

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").trim();
const SERVICE_ROLE = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
const HUBSPOT_ACCESS_TOKEN_ENV = (Deno.env.get("HUBSPOT_ACCESS_TOKEN") || "").trim();
const DEFAULT_OWNER_ID = (Deno.env.get("HUBSPOT_DEFAULT_DEAL_OWNER_ID") || "").trim();
const HUBSPOT_BASE = "https://api.hubapi.com";
const API_VERSION = "2026-03";
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_ATTEMPTS = 6;
const RETRY_MINUTES = 30;
const UNMATCHED_RETRY_MINUTES = 120;
let runtimeHubspotToken = HUBSPOT_ACCESS_TOKEN_ENV;

const CONTACT_PROPERTIES = [
  "email",
  "phone",
  "firstname",
  "lastname",
  "hubspot_owner_id",
  "lifecyclestage",
  "hs_object_source_label",
  "hs_object_source_detail_1",
  "hs_analytics_source",
  "hs_analytics_source_data_1",
  "nvx_is_test_lead",
  "interes_principal_del_tratamiento",
];

function json(status: number, body: Record<string, unknown>) {
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

async function hubspot(token: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`${HUBSPOT_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let payload: any = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }
  if (!response.ok) throw new Error(`HubSpot ${response.status}`);
  return payload;
}

function cleanText(value: unknown, max = 512): string | null {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
}

function normalizeEmail(value: unknown): string | null {
  const email = cleanText(value, 254)?.toLowerCase() ?? null;
  return email && email.includes("@") ? email : null;
}

function normalizePhone(value: unknown): string | null {
  const text = cleanText(value, 80);
  if (!text) return null;
  const digits = text.replace(/\D/g, "");
  if (digits.length === 9 && /^[6789]/.test(digits)) return `34${digits}`;
  if (digits.length === 11 && digits.startsWith("34")) return digits;
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

function truthy(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || String(value || "").toLowerCase() === "true";
}

function isQaContact(contact: any): boolean {
  const props = contact?.properties || {};
  const name = `${props.firstname || ""} ${props.lastname || ""}`.toLowerCase();
  const email = String(props.email || "").toLowerCase();
  return truthy(props.nvx_is_test_lead)
    || email === "test@meta.com"
    || /<test lead|dummy data/.test(name);
}

function isMetaLeadAdsContact(contact: any, expectedFormName: string | null): boolean {
  const props = contact?.properties || {};
  if (String(props.hs_object_source_label || "").toUpperCase() !== "FORM") return false;
  if (String(props.hs_analytics_source || "").toUpperCase() !== "PAID_SOCIAL") return false;
  if (String(props.hs_analytics_source_data_1 || "").toLowerCase() !== "facebook") return false;
  if (expectedFormName) {
    const actual = String(props.hs_object_source_detail_1 || "").trim();
    if (actual && actual !== expectedFormName) return false;
  }
  return true;
}

function metaInterest(rawFieldData: any): string | null {
  const fieldData = Array.isArray(rawFieldData?.field_data)
    ? rawFieldData.field_data
    : Array.isArray(rawFieldData)
      ? rawFieldData
      : [];
  const accepted = new Set([
    "interes_principal_del_tratamiento",
    "interés_principal_del_tratamiento",
    "interes_principal",
    "interés_principal",
    "tratamiento_de_interes",
    "tratamiento_de_interés",
    "tratamiento",
  ]);
  for (const item of fieldData) {
    const key = String(item?.name || item?.field_name || "").trim().toLowerCase();
    if (!accepted.has(key)) continue;
    const values = Array.isArray(item?.values) ? item.values : [];
    const value = values.map((entry: unknown) => String(entry ?? "").trim()).filter(Boolean).join(" ").trim();
    if (value) return value.slice(0, 255);
  }
  return null;
}

function uniqueContacts(results: any[]): any[] {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const item of results) {
    const id = String(item?.id || "").trim();
    if (!/^\d+$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }
  return out;
}

async function searchContacts(token: string, lead: any): Promise<any[]> {
  const properties = CONTACT_PROPERTIES;
  const candidates: any[] = [];
  const email = normalizeEmail(lead.email);
  if (email) {
    const payload = await hubspot(token, `/crm/objects/${API_VERSION}/contacts/search`, {
      method: "POST",
      body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }],
        properties,
        limit: 3,
        after: "0",
        sorts: [],
      }),
    });
    candidates.push(...(Array.isArray(payload?.results) ? payload.results : []));
  }

  const expectedPhone = normalizePhone(lead.phone);
  if (expectedPhone) {
    const payload = await hubspot(token, `/crm/objects/${API_VERSION}/contacts/search`, {
      method: "POST",
      body: JSON.stringify({ query: String(lead.phone || ""), properties, limit: 10, after: "0", sorts: [] }),
    });
    for (const contact of Array.isArray(payload?.results) ? payload.results : []) {
      if (normalizePhone(contact?.properties?.phone) === expectedPhone) candidates.push(contact);
    }
  }

  return uniqueContacts(candidates);
}

async function contactById(token: string, contactId: string): Promise<any> {
  const properties = encodeURIComponent(CONTACT_PROPERTIES.join(","));
  return await hubspot(token, `/crm/objects/${API_VERSION}/contacts/${contactId}?properties=${properties}`);
}

async function ensureOwner(token: string, contact: any): Promise<string> {
  const existing = cleanText(contact?.properties?.hubspot_owner_id, 80);
  if (existing && /^\d+$/.test(existing)) return existing;
  if (!/^\d+$/.test(DEFAULT_OWNER_ID)) throw new Error("HubSpot default owner unavailable");
  const id = String(contact?.id || "");
  if (!/^\d+$/.test(id)) throw new Error("Invalid HubSpot contact id");
  await hubspot(token, `/crm/objects/${API_VERSION}/contacts/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ properties: { hubspot_owner_id: DEFAULT_OWNER_ID } }),
  });
  return DEFAULT_OWNER_ID;
}

async function ensureInterest(token: string, contact: any, lead: any): Promise<string | null> {
  const existing = cleanText(contact?.properties?.interes_principal_del_tratamiento, 255);
  if (existing) return existing;
  const fromMeta = metaInterest(lead.raw_field_data);
  if (!fromMeta) return null;
  const id = String(contact?.id || "");
  if (!/^\d+$/.test(id)) throw new Error("Invalid HubSpot contact id");
  await hubspot(token, `/crm/objects/${API_VERSION}/contacts/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ properties: { interes_principal_del_tratamiento: fromMeta } }),
  });
  return fromMeta;
}

function nextIso(minutes: number) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

async function markLedger(admin: any, leadId: string, patch: Record<string, unknown>) {
  const { error } = await admin
    .from("meta_hubspot_reconciliations")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("lead_id", leadId);
  if (error) throw new Error("Meta-HubSpot ledger update failed");
}

async function queueProjection(admin: any, lead: any, contactId: string, ownerId: string) {
  const { data: existingProjection, error: projectionLookupError } = await admin
    .from("hubspot_deal_projections")
    .select("projection_status,hubspot_contact_id")
    .eq("lead_id", lead.id)
    .maybeSingle();
  if (projectionLookupError) throw new Error("Deal projection lookup failed");
  if (existingProjection?.projection_status === "suppressed") return "suppressed";
  if (existingProjection?.hubspot_contact_id && String(existingProjection.hubspot_contact_id) !== contactId) {
    throw new Error("Deal projection contact conflict");
  }
  const { error } = await admin.from("hubspot_deal_projections").upsert({
    lead_id: lead.id,
    hubspot_contact_id: Number(contactId),
    owner_id: ownerId,
    projection_status: "pending",
    last_error: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "lead_id" });
  if (error) throw new Error("Deal projection upsert failed");
  return "pending";
}

async function processOne(admin: any, token: string, ledger: any) {
  const now = new Date().toISOString();
  const { data: lead, error: leadError } = await admin
    .from("leads")
    .select("id,source,email,phone,hubspot_contact_id,treatment_name,raw_field_data,form_name,meta_form_id,deleted_at")
    .eq("id", ledger.lead_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (leadError) throw new Error("Meta lead lookup failed");
  if (!lead) {
    await markLedger(admin, ledger.lead_id, { status: "suppressed", last_error: "Lead missing or deleted", reconciled_at: now });
    return { lead_id: ledger.lead_id, outcome: "suppressed" };
  }
  if (lead.source !== "meta_leadgen") {
    await markLedger(admin, lead.id, { status: "conflict", last_error: "Unexpected lead source", reconciled_at: now });
    return { lead_id: lead.id, outcome: "conflict" };
  }

  let contact: any = null;
  if (lead.hubspot_contact_id) {
    contact = await contactById(token, String(lead.hubspot_contact_id));
  } else {
    const contacts = await searchContacts(token, lead);
    if (contacts.length === 0) {
      const attempts = Number(ledger.attempt_count || 0) + 1;
      const terminal = attempts >= MAX_ATTEMPTS;
      await markLedger(admin, lead.id, {
        status: terminal ? "unmatched_terminal" : "unmatched",
        attempt_count: attempts,
        last_error: terminal ? "HubSpot contact not found after bounded retries" : "HubSpot contact not found",
        next_attempt_at: terminal ? now : nextIso(UNMATCHED_RETRY_MINUTES),
      });
      return { lead_id: lead.id, outcome: terminal ? "unmatched_terminal" : "unmatched" };
    }
    if (contacts.length > 1) {
      await markLedger(admin, lead.id, { status: "conflict", last_error: "Multiple HubSpot identity matches", reconciled_at: now });
      return { lead_id: lead.id, outcome: "conflict" };
    }
    contact = contacts[0];
  }

  if (isQaContact(contact)) {
    await markLedger(admin, lead.id, { status: "suppressed", last_error: null, reconciled_at: now });
    return { lead_id: lead.id, outcome: "suppressed" };
  }

  const expectedFormName = cleanText(lead.form_name, 255);
  if (!isMetaLeadAdsContact(contact, expectedFormName)) {
    await markLedger(admin, lead.id, { status: "conflict", last_error: "HubSpot contact is not canonical Facebook Lead Ads lineage", reconciled_at: now });
    return { lead_id: lead.id, outcome: "conflict" };
  }

  const contactId = String(contact?.id || "").trim();
  if (!/^\d+$/.test(contactId)) throw new Error("Invalid HubSpot contact id");
  if (lead.hubspot_contact_id && String(lead.hubspot_contact_id) !== contactId) throw new Error("HubSpot contact link conflict");

  const ownerId = await ensureOwner(token, contact);
  const treatmentName = await ensureInterest(token, contact, lead);
  const leadPatch: Record<string, unknown> = {
    hubspot_contact_id: Number(contactId),
    updated_at: now,
  };
  if (!lead.treatment_name && treatmentName) leadPatch.treatment_name = treatmentName;
  const { error: linkError } = await admin
    .from("leads")
    .update(leadPatch)
    .eq("id", lead.id)
    .is("deleted_at", null);
  if (linkError) throw new Error(linkError.code === "23505" ? "HubSpot contact already linked to another lead" : "Meta lead contact link failed");

  const projectionStatus = await queueProjection(admin, lead, contactId, ownerId);
  if (projectionStatus === "suppressed") {
    await markLedger(admin, lead.id, { status: "suppressed", hubspot_contact_id: Number(contactId), owner_id: ownerId, last_error: null, reconciled_at: now });
    return { lead_id: lead.id, outcome: "suppressed" };
  }

  await markLedger(admin, lead.id, {
    status: "reconciled",
    hubspot_contact_id: Number(contactId),
    owner_id: ownerId,
    attempt_count: Number(ledger.attempt_count || 0) + 1,
    last_error: null,
    reconciled_at: now,
    next_attempt_at: now,
  });
  return { lead_id: lead.id, outcome: "reconciled", treatment_mapped: Boolean(treatmentName) };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { success: false, message: "Method not allowed" });
  if (!SUPABASE_URL || !SERVICE_ROLE) return json(500, { success: false, message: "Server configuration error" });
  if (!(await requireServiceRole(req))) return json(403, { success: false, message: "Forbidden" });

  const body = await req.json().catch(() => ({}));
  const requestedLimit = Number(body?.limit || DEFAULT_LIMIT);
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number.isFinite(requestedLimit) ? Math.trunc(requestedLimit) : DEFAULT_LIMIT));
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  let token: string;
  try {
    token = await resolveHubspotToken(admin);
  } catch (error: any) {
    console.error("[meta-hubspot-reconcile]", String(error?.message || "configuration error").slice(0, 200));
    return json(500, { success: false, message: "Server configuration error" });
  }

  const now = new Date().toISOString();
  const { data: rows, error } = await admin
    .from("meta_hubspot_reconciliations")
    .select("lead_id,status,attempt_count,next_attempt_at")
    .in("status", ["pending", "failed", "unmatched"])
    .lte("next_attempt_at", now)
    .lt("attempt_count", MAX_ATTEMPTS)
    .order("next_attempt_at", { ascending: true })
    .limit(limit);
  if (error) return json(500, { success: false, message: "Reconciliation queue unavailable" });

  const results: any[] = [];
  for (const row of rows || []) {
    try {
      results.push(await processOne(admin, token, row));
    } catch (error: any) {
      const message = String(error?.message || "Meta-HubSpot reconciliation failed").slice(0, 240);
      const attempts = Number(row.attempt_count || 0) + 1;
      const conflict = /conflict|already linked|multiple/i.test(message);
      try {
        await markLedger(admin, row.lead_id, {
          status: conflict ? "conflict" : attempts >= MAX_ATTEMPTS ? "failed_terminal" : "failed",
          attempt_count: attempts,
          last_error: message,
          next_attempt_at: attempts >= MAX_ATTEMPTS || conflict ? now : nextIso(RETRY_MINUTES),
          reconciled_at: conflict ? now : null,
        });
      } catch (ledgerError) {
        console.error("[meta-hubspot-reconcile] ledger failure", String(ledgerError).slice(0, 200));
      }
      results.push({ lead_id: row.lead_id, outcome: conflict ? "conflict" : "failed" });
    }
  }

  return json(200, {
    success: true,
    processed: results.length,
    reconciled: results.filter((item) => item.outcome === "reconciled").length,
    unmatched: results.filter((item) => item.outcome === "unmatched" || item.outcome === "unmatched_terminal").length,
    suppressed: results.filter((item) => item.outcome === "suppressed").length,
    conflicts: results.filter((item) => item.outcome === "conflict").length,
    failed: results.filter((item) => item.outcome === "failed").length,
  });
});
