import { createClient } from "jsr:@supabase/supabase-js@2";

declare const Deno: any;

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").trim();
const SERVICE_ROLE = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
const HUBSPOT_ACCESS_TOKEN_ENV = (Deno.env.get("HUBSPOT_ACCESS_TOKEN") || "").trim();
const HUBSPOT_BASE = "https://api.hubapi.com";
const NATIVE_SYNC_GRACE_MS = 2 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_DAYS = 7;
const MAX_ROWS = 100;

const ENRICHMENT_PROPERTIES = [
  "email",
  "phone",
  "hubspot_owner_id",
  "nvx_lead_id",
  "nvx_utm_source",
  "nvx_utm_medium",
  "nvx_utm_campaign",
  "nvx_utm_content",
  "nvx_attribution_captured_at",
  "nombre",
  "qu_te_gustara_mejorar_principalmente",
  "cundo_prefieres_que_te_contactemos",
] as const;

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function timingSafeTextMatch(received: string, expected: string): boolean {
  const a = String(received || "");
  const b = String(expected || "");
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function clean(value: unknown, max = 1000): string | null {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
}

function normalizeEmail(value: unknown): string | null {
  const email = String(value ?? "").trim().toLowerCase();
  return email && email.includes("@") && email.length <= 254 ? email : null;
}

function fieldMap(raw: any): Record<string, string> {
  const out: Record<string, string> = {};
  const rows = Array.isArray(raw?.field_data) ? raw.field_data : [];
  for (const row of rows) {
    const name = String(row?.name || "").trim().toLowerCase();
    if (!name) continue;
    const value = (Array.isArray(row?.values) ? row.values : [])
      .map((item: unknown) => String(item ?? "").trim())
      .filter(Boolean)
      .join(" ")
      .trim();
    if (value) out[name] = value;
  }
  return out;
}

function answer(fields: Record<string, string>, names: string[]): string | null {
  for (const name of names) {
    const value = fields[name.toLowerCase()];
    if (value) return value;
  }
  return null;
}

async function resolveHubspotToken(admin: any): Promise<string> {
  if (HUBSPOT_ACCESS_TOKEN_ENV) return HUBSPOT_ACCESS_TOKEN_ENV;
  const { data, error } = await admin.rpc("nvx_get_runtime_secret", { p_name: "HUBSPOT_ACCESS_TOKEN" });
  if (error || !data) throw new Error("HubSpot runtime credential unavailable");
  return String(data).trim();
}

async function hubspotRequest(token: string, method: string, path: string, body?: unknown) {
  const response = await fetch(`${HUBSPOT_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let payload: any = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { message: text.slice(0, 300) };
  }
  if (!response.ok) {
    const error = new Error(`HubSpot ${method} ${path} failed ${response.status}`);
    Object.assign(error, { status: response.status, payload });
    throw error;
  }
  return payload;
}

function enrichmentPropertiesQuery(): string {
  return ENRICHMENT_PROPERTIES.join(",");
}

async function searchHubspotByEmail(token: string, email: string) {
  const payload = await hubspotRequest(token, "POST", "/crm/v3/objects/contacts/search", {
    filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }],
    properties: [...ENRICHMENT_PROPERTIES],
    limit: 2,
  });
  return Array.isArray(payload?.results) ? payload.results : [];
}

async function hubspotContactById(token: string, contactId: string) {
  if (!/^\d+$/.test(contactId)) throw new Error("Invalid linked HubSpot contact id");
  return await hubspotRequest(
    token,
    "GET",
    `/crm/v3/objects/contacts/${contactId}?properties=${enrichmentPropertiesQuery()}&archived=false`,
  );
}

function desiredProperties(lead: any, attr: any): Record<string, string> {
  const fields = fieldMap(lead?.raw_field_data || {});
  const fullName = clean(lead?.name, 255) || answer(fields, ["full_name", "first_name", "nombre", "nombre_y_apellidos", "nombre_completo"]);
  const email = normalizeEmail(lead?.email) || normalizeEmail(answer(fields, ["email", "correo", "correo_electrónico", "correo_electronico"]));
  const phone = clean(lead?.phone_normalized, 80) || clean(lead?.phone, 80) || answer(fields, ["phone_number", "phone", "telefono", "teléfono", "numero_de_telefono", "número_de_teléfono", "mobile_phone_number", "mobile_phone", "celular"]);
  const improve = answer(fields, ["¿qué_te_gustaría_mejorar_principalmente?", "qué_te_gustaría_mejorar_principalmente"]);
  const contactWhen = answer(fields, ["¿cuándo_prefieres_que_te_contactemos?", "cuándo_prefieres_que_te_contactemos"]);

  const props: Record<string, string> = {};
  const put = (key: string, value: unknown) => {
    const text = clean(value, 1000);
    if (text) props[key] = text;
  };
  put("email", email);
  put("phone", phone);
  put("nombre", fullName);
  put("nvx_lead_id", lead?.nvx_lead_id || lead?.id);
  put("nvx_utm_source", lead?.utm_source || "facebook");
  put("nvx_utm_medium", lead?.utm_medium || "paid_social");
  put("nvx_utm_campaign", lead?.utm_campaign || lead?.campaign_name || attr?.campaign_id);
  put("nvx_utm_content", lead?.utm_content || attr?.ad_id);
  put("nvx_attribution_captured_at", attr?.captured_at || lead?.created_at_meta);
  put("qu_te_gustara_mejorar_principalmente", improve);
  put("cundo_prefieres_que_te_contactemos", contactWhen);
  return props;
}

function missingOnly(existing: Record<string, unknown>, desired: Record<string, string>): Record<string, string> {
  const patch: Record<string, string> = {};
  for (const [key, value] of Object.entries(desired)) {
    if (!String(existing?.[key] ?? "").trim() && value) patch[key] = value;
  }
  return patch;
}

function hubspotOwnerId(contact: any): string | null {
  const ownerId = clean(contact?.properties?.hubspot_owner_id, 80);
  return ownerId && /^\d+$/.test(ownerId) ? ownerId : null;
}

async function applyOwnerAuthority(admin: any, leadId: string, contactId: string, contact: any) {
  const { data, error } = await admin.rpc("nvx_apply_hubspot_owner_authority", {
    p_lead_id: leadId,
    p_hubspot_contact_id: Number(contactId),
    p_hubspot_owner_id: hubspotOwnerId(contact),
  });
  if (error) throw new Error("HubSpot owner authority reconciliation failed");
  return data || null;
}

async function linkLocalLead(admin: any, lead: any, contact: any) {
  const contactId = String(contact?.id || "").trim();
  if (!/^\d+$/.test(contactId)) throw new Error("Invalid HubSpot contact id");
  const lineageId = clean(lead?.nvx_lead_id, 64) || clean(lead?.id, 64);
  const patch: Record<string, unknown> = {
    hubspot_contact_id: Number(contactId),
    updated_at: new Date().toISOString(),
  };
  if (lineageId) patch.nvx_lead_id = lineageId;
  const { error } = await admin
    .from("leads")
    .update(patch)
    .eq("id", lead.id)
    .is("hubspot_contact_id", null);
  if (error) throw new Error("Local HubSpot lineage update failed");

  await applyOwnerAuthority(admin, String(lead.id), contactId, contact);
}

async function patchMissingContactProperties(token: string, contact: any, desired: Record<string, string>): Promise<string[]> {
  const contactId = String(contact?.id || "").trim();
  if (!/^\d+$/.test(contactId)) throw new Error("Invalid HubSpot contact id");
  const patch = missingOnly(contact?.properties || {}, desired);
  const patchedProperties = Object.keys(patch).sort();
  if (patchedProperties.length) {
    await hubspotRequest(token, "PATCH", `/crm/v3/objects/contacts/${contactId}`, { properties: patch });
  }
  return patchedProperties;
}

async function syncExistingContact(admin: any, token: string, lead: any, contact: any, desired: Record<string, string>) {
  const contactId = String(contact?.id || "").trim();
  if (!/^\d+$/.test(contactId)) throw new Error("Invalid HubSpot contact id");
  await patchMissingContactProperties(token, contact, desired);
  await linkLocalLead(admin, lead, contact);
  return contactId;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply(405, { success: false, message: "Method not allowed" });
  if (!SUPABASE_URL || !SERVICE_ROLE) return reply(500, { success: false, message: "Server configuration error" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  try {
    const receivedSecret = String(req.headers.get("x-nvx-internal-secret") || "");
    const { data: expectedSecret, error: secretError } = await admin.rpc("nvx_get_runtime_secret", {
      p_name: "REVOPS_INTERNAL_SECRET",
    });
    if (secretError) throw secretError;
    if (!timingSafeTextMatch(receivedSecret, String(expectedSecret || ""))) {
      return reply(401, { success: false, message: "Unauthorized" });
    }

    const body = await req.json().catch(() => ({}));
    const mode = String(body?.mode || "audit").toLowerCase() === "sync" ? "sync" : "audit";
    const verifyLinked = mode === "audit" && body?.verifyLinked === true;
    const campaignId = clean(body?.campaignId ?? body?.campaign_id, 64);
    const lookbackDaysRaw = Number(body?.lookbackDays ?? body?.lookback_days ?? DEFAULT_LOOKBACK_DAYS);
    const lookbackDays = Math.max(1, Math.min(90, Number.isFinite(lookbackDaysRaw) ? Math.trunc(lookbackDaysRaw) : DEFAULT_LOOKBACK_DAYS));
    const since = new Date(Date.now() - lookbackDays * 86_400_000).toISOString();
    const token = await resolveHubspotToken(admin);

    let attrQuery = admin
      .from("meta_attribution")
      .select("lead_id,leadgen_id,form_id,campaign_id,adset_id,ad_id,ad_name,captured_at")
      .gte("captured_at", since)
      .order("captured_at", { ascending: true })
      .limit(MAX_ROWS);
    if (campaignId) attrQuery = attrQuery.eq("campaign_id", campaignId);
    const { data: attrs, error: attrError } = await attrQuery;
    if (attrError) throw attrError;

    const leadIds = [...new Set((attrs || []).map((row: any) => String(row?.lead_id || "")).filter(Boolean))];
    const { data: leads, error: leadError } = leadIds.length
      ? await admin
        .from("leads")
        .select("id,nvx_lead_id,name,email,phone,phone_normalized,campaign_name,utm_source,utm_medium,utm_campaign,utm_content,created_at_meta,raw_field_data,hubspot_contact_id")
        .in("id", leadIds)
      : { data: [], error: null };
    if (leadError) throw leadError;
    const leadMap = new Map<string, any>((leads || []).map((lead: any) => [String(lead.id), lead]));

    const results: any[] = [];
    for (const attr of attrs || []) {
      const lead = leadMap.get(String(attr.lead_id));
      if (!lead) {
        results.push({ leadgen_id: attr.leadgen_id, outcome: "missing_local_lead" });
        continue;
      }

      const desired = desiredProperties(lead, attr);

      if (lead.hubspot_contact_id) {
        const contactId = String(lead.hubspot_contact_id);
        const contact = await hubspotContactById(token, contactId);
        if (String(contact?.id || "") !== contactId) throw new Error("Linked HubSpot contact verification mismatch");

        if (mode === "sync") {
          const patchedProperties = await patchMissingContactProperties(token, contact, desired);
          const localOwnerUserId = await applyOwnerAuthority(admin, String(lead.id), contactId, contact);
          results.push({
            leadgen_id: attr.leadgen_id,
            hubspot_contact_id: contactId,
            outcome: patchedProperties.length ? "linked_enriched" : "already_linked",
            patched_properties: patchedProperties,
            hubspot_owner_id: hubspotOwnerId(contact),
            local_owner_user_id: localOwnerUserId,
          });
        } else if (verifyLinked) {
          results.push({ leadgen_id: attr.leadgen_id, hubspot_contact_id: contactId, outcome: "linked_verified" });
        } else {
          const missingProperties = Object.keys(missingOnly(contact?.properties || {}, desired)).sort();
          results.push({
            leadgen_id: attr.leadgen_id,
            hubspot_contact_id: contactId,
            outcome: missingProperties.length ? "would_enrich_linked" : "already_linked",
            missing_properties: missingProperties,
          });
        }
        continue;
      }

      const email = normalizeEmail(desired.email);
      if (!email) {
        results.push({ leadgen_id: attr.leadgen_id, outcome: "missing_email" });
        continue;
      }

      const matches = await searchHubspotByEmail(token, email);
      if (matches.length > 1) {
        results.push({ leadgen_id: attr.leadgen_id, outcome: "hubspot_identity_conflict" });
        continue;
      }

      if (matches.length === 1) {
        const contact = matches[0];
        if (mode === "sync") {
          const contactId = await syncExistingContact(admin, token, lead, contact, desired);
          results.push({ leadgen_id: attr.leadgen_id, hubspot_contact_id: contactId, outcome: "linked_existing" });
        } else {
          results.push({ leadgen_id: attr.leadgen_id, hubspot_contact_id: String(contact.id), outcome: "would_link_existing" });
        }
        continue;
      }

      const capturedMs = new Date(attr.captured_at || lead.created_at_meta || 0).getTime();
      const ageMs = Number.isFinite(capturedMs) ? Date.now() - capturedMs : 0;
      if (ageMs < NATIVE_SYNC_GRACE_MS) {
        results.push({ leadgen_id: attr.leadgen_id, outcome: "native_sync_grace" });
        continue;
      }
      if (mode !== "sync") {
        results.push({ leadgen_id: attr.leadgen_id, outcome: "would_create_fallback" });
        continue;
      }

      try {
        const created = await hubspotRequest(token, "POST", "/crm/v3/objects/contacts", { properties: desired });
        const contactId = String(created?.id || "");
        if (!/^\d+$/.test(contactId)) throw new Error("HubSpot create returned invalid contact id");
        const createdContact = await hubspotContactById(token, contactId);
        await linkLocalLead(admin, lead, createdContact);
        results.push({
          leadgen_id: attr.leadgen_id,
          hubspot_contact_id: contactId,
          hubspot_owner_id: hubspotOwnerId(createdContact),
          outcome: "created_fallback",
        });
      } catch (error: any) {
        if (Number(error?.status) !== 409) throw error;
        const raceMatches = await searchHubspotByEmail(token, email);
        if (raceMatches.length !== 1) throw new Error("HubSpot create race could not resolve a unique contact");
        const contactId = await syncExistingContact(admin, token, lead, raceMatches[0], desired);
        results.push({ leadgen_id: attr.leadgen_id, hubspot_contact_id: contactId, outcome: "linked_race" });
      }
    }

    return reply(200, {
      success: true,
      mode,
      verifyLinked,
      campaignId,
      lookbackDays,
      processed: results.length,
      already_linked: results.filter((row) => row.outcome === "already_linked").length,
      linked_verified: results.filter((row) => row.outcome === "linked_verified").length,
      linked_verified_would_enrich: results.filter((row) => row.outcome === "linked_verified_would_enrich").length,
      linked_enriched: results.filter((row) => row.outcome === "linked_enriched").length,
      would_enrich_linked: results.filter((row) => row.outcome === "would_enrich_linked").length,
      linked_contact_stale: results.filter((row) => row.outcome === "linked_contact_stale").length,
      linked_existing: results.filter((row) => row.outcome === "linked_existing").length,
      linked_race: results.filter((row) => row.outcome === "linked_race").length,
      created_fallback: results.filter((row) => row.outcome === "created_fallback").length,
      native_sync_grace: results.filter((row) => row.outcome === "native_sync_grace").length,
      conflicts: results.filter((row) => String(row.outcome).includes("conflict")).length,
      results,
    });
  } catch (error: any) {
    console.error("[meta-hubspot-sync]", String(error?.message || error).slice(0, 300));
    return reply(502, { success: false, message: String(error?.message || "Meta HubSpot sync failed").slice(0, 240) });
  }
});
