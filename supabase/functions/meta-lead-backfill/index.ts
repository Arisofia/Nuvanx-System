// Canonical Meta Lead Ads historical backfill.
//
// The legacy API backfill queried /{ad-account-id}/leadgen_forms. Lead forms are
// owned by a Facebook Page, so this function resolves the canonical meta_ads
// integration, queries /{page-id}/leadgen_forms and reconciles each lead by
// strongest available identity before inserting anything.
//
// This is an internal maintenance endpoint. It is authenticated with the same
// REVOPS_INTERNAL_SECRET used by server-to-server maintenance jobs, so it does
// not depend on a frontend user session or any periodic cron.
import { createClient } from "jsr:@supabase/supabase-js@2";

declare const Deno: any;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const META_GRAPH = "https://graph.facebook.com/v22.0";
const DEFAULT_LOOKBACK_DAYS = 180;
const MAX_LOOKBACK_DAYS = 730;
const MAX_FORMS = 200;
const MAX_LEADS = 5000;

type MetaLead = {
  id?: string;
  field_data?: Array<{ name?: string; values?: unknown[] }>;
  created_time?: string;
  ad_id?: string;
  ad_name?: string;
  form_id?: string;
  form_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  page_id?: string;
};

function json(status: number, body: Record<string, unknown>) {
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

function parseDateInput(value: unknown, fallback: Date): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) ? parsed : fallback;
}

function normalizePhone(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!text || /dummy data|test lead/i.test(text)) return null;
  const digits = text.replaceAll(/\D/g, "");
  if (digits.length === 9 && /^[6789]/.test(digits)) return `+34${digits}`;
  if (digits.length >= 11 && digits.startsWith("34")) return `+${digits}`;
  if (text.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
}

function normalizeEmail(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const value = String(raw).trim().toLowerCase();
  if (!value || !value.includes("@") || value.length > 254) return null;
  return value;
}

function leadFields(fieldData: MetaLead["field_data"]) {
  const out: Record<string, string> = {};
  for (const item of fieldData ?? []) {
    const key = String(item?.name || "").trim().toLowerCase();
    if (!key) continue;
    const values = Array.isArray(item?.values) ? item.values : [];
    const value = values.map((entry) => String(entry ?? "").trim()).filter(Boolean).join(" ").trim();
    if (value) out[key] = value;
  }
  return out;
}

function first(fields: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const value = fields[key];
    if (value?.trim()) return value.trim();
  }
  return null;
}

function mapLead(raw: MetaLead) {
  const fields = leadFields(raw.field_data);
  const firstName = first(fields, ["first_name", "nombre", "firstname"]);
  const lastName = first(fields, ["last_name", "apellidos", "lastname"]);
  const fullName = first(fields, ["full_name", "name", "nombre_completo"])
    || [firstName, lastName].filter(Boolean).join(" ").trim()
    || null;
  const email = normalizeEmail(first(fields, ["email", "work_email"]));
  const phone = normalizePhone(first(fields, ["phone_number", "phone", "telefono", "teléfono", "mobile_phone", "mobilephone"]));
  const rawJoined = JSON.stringify(raw.field_data ?? []).toLowerCase();
  const isTest = email === "test@meta.com"
    || /<test lead|dummy data/.test(String(fullName || "").toLowerCase())
    || /<test lead|dummy data/.test(rawJoined);

  return { fields, fullName, email, phone, isTest };
}

async function metaFetchPage(pathOrUrl: string, token: string, params?: Record<string, string>) {
  const url = pathOrUrl.startsWith("https://") ? new URL(pathOrUrl) : new URL(`${META_GRAPH}${pathOrUrl}`);
  if (!url.searchParams.has("access_token")) url.searchParams.set("access_token", token);
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value);
  const response = await fetch(url.toString(), { signal: AbortSignal.timeout(20_000) });
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text.slice(0, 500) }; }
  if (!response.ok) {
    const metaMessage = body?.error?.message || body?.message || `Meta API ${response.status}`;
    throw new Error(metaMessage);
  }
  return body;
}

async function fetchForms(pageId: string, token: string) {
  const forms: Array<{ id: string; name?: string }> = [];
  let next: string | null = `/${pageId}/leadgen_forms`;
  let params: Record<string, string> | undefined = { fields: "id,name", limit: "100" };
  while (next && forms.length < MAX_FORMS) {
    const page = await metaFetchPage(next, token, params);
    params = undefined;
    for (const form of Array.isArray(page?.data) ? page.data : []) {
      if (form?.id) forms.push({ id: String(form.id), name: form.name ? String(form.name) : undefined });
      if (forms.length >= MAX_FORMS) break;
    }
    next = typeof page?.paging?.next === "string" ? page.paging.next : null;
  }
  return forms;
}

async function fetchLeads(form: { id: string; name?: string }, token: string, since: Date, until: Date) {
  const leads: MetaLead[] = [];
  const sinceTs = Math.floor(since.getTime() / 1000);
  let next: string | null = `/${form.id}/leads`;
  let params: Record<string, string> | undefined = {
    fields: "id,field_data,created_time,ad_id,ad_name,form_id,form_name,campaign_id,campaign_name,adset_id,adset_name,page_id",
    filtering: JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: sinceTs }]),
    limit: "100",
  };
  while (next && leads.length < MAX_LEADS) {
    const page = await metaFetchPage(next, token, params);
    params = undefined;
    for (const raw of Array.isArray(page?.data) ? page.data : []) {
      const created = raw?.created_time ? new Date(raw.created_time) : null;
      if (!created || !Number.isFinite(created.getTime())) continue;
      if (created < since || created > until) continue;
      leads.push({ ...raw, form_name: raw.form_name ?? form.name ?? null });
      if (leads.length >= MAX_LEADS) break;
    }
    next = typeof page?.paging?.next === "string" ? page.paging.next : null;
  }
  return leads;
}

async function findExistingLead(admin: any, userId: string, leadgenId: string, phone: string | null, email: string | null) {
  const { data: attr } = await admin.from("meta_attribution").select("lead_id").eq("leadgen_id", leadgenId).maybeSingle();
  if (attr?.lead_id) {
    const { data: row } = await admin.from("leads").select("id,user_id,external_id,source,campaign_id,campaign_name,meta_form_id,meta_ad_id,meta_ad_name,ad_account_id").eq("id", attr.lead_id).is("deleted_at", null).maybeSingle();
    if (row) return String(row.user_id) === userId ? { row, conflict: false } : { row: null, conflict: true };
  }

  const { data: external } = await admin.from("leads").select("id,user_id,external_id,source,campaign_id,campaign_name,meta_form_id,meta_ad_id,meta_ad_name,ad_account_id").eq("user_id", userId).eq("external_id", leadgenId).is("deleted_at", null).maybeSingle();
  if (external) return { row: external, conflict: false };

  let phoneRow: any = null;
  let emailRow: any = null;
  if (phone) {
    const { data } = await admin.from("leads").select("id,user_id,external_id,source,campaign_id,campaign_name,meta_form_id,meta_ad_id,meta_ad_name,ad_account_id").eq("user_id", userId).eq("phone", phone).is("deleted_at", null).limit(1).maybeSingle();
    phoneRow = data ?? null;
  }
  if (email) {
    const { data } = await admin.from("leads").select("id,user_id,external_id,source,campaign_id,campaign_name,meta_form_id,meta_ad_id,meta_ad_name,ad_account_id").eq("user_id", userId).eq("email", email).is("deleted_at", null).limit(1).maybeSingle();
    emailRow = data ?? null;
  }
  if (phoneRow && emailRow && phoneRow.id !== emailRow.id) return { row: null, conflict: true };
  return { row: phoneRow ?? emailRow ?? null, conflict: false };
}

async function persistLead(admin: any, userId: string, clinicId: string | null, adAccountId: string | null, raw: MetaLead) {
  const leadgenId = String(raw.id || "").trim();
  if (!leadgenId) return { outcome: "invalid" };
  const mapped = mapLead(raw);
  if (mapped.isTest) return { outcome: "test" };

  const resolved = await findExistingLead(admin, userId, leadgenId, mapped.phone, mapped.email);
  if (resolved.conflict) return { outcome: "identity_conflict" };

  const createdAt = raw.created_time && Number.isFinite(new Date(raw.created_time).getTime())
    ? new Date(raw.created_time).toISOString()
    : new Date().toISOString();

  let leadId: string | null = resolved.row?.id ?? null;
  if (leadId) {
    const existing = resolved.row;
    const updates: Record<string, unknown> = {
      external_id: existing.external_id || leadgenId,
      campaign_id: existing.campaign_id || raw.campaign_id || null,
      campaign_name: existing.campaign_name || raw.campaign_name || null,
      meta_form_id: existing.meta_form_id || raw.form_id || null,
      meta_ad_id: existing.meta_ad_id || raw.ad_id || null,
      meta_ad_name: existing.meta_ad_name || raw.ad_name || null,
      ad_account_id: existing.ad_account_id || adAccountId || null,
    };
    const { error } = await admin.from("leads").update(updates).eq("id", leadId).eq("user_id", userId);
    if (error) throw error;
  } else {
    const row = {
      user_id: userId,
      clinic_id: clinicId,
      external_id: leadgenId,
      source: "meta_leadgen",
      stage: "lead",
      name: mapped.fullName,
      email: mapped.email,
      phone: mapped.phone,
      campaign_id: raw.campaign_id || null,
      campaign_name: raw.campaign_name || null,
      meta_form_id: raw.form_id || null,
      meta_ad_id: raw.ad_id || null,
      meta_ad_name: raw.ad_name || null,
      ad_account_id: adAccountId,
      created_at_meta: createdAt,
      created_at: createdAt,
      utm_source: "meta",
      utm_medium: "paid_social",
      utm_campaign: raw.campaign_name || null,
      raw_field_data: { field_data: raw.field_data ?? [], backfill: "page_leadgen_forms_v1" },
    };
    const { data, error } = await admin.from("leads").insert(row).select("id").single();
    if (error) throw error;
    leadId = data?.id ?? null;
  }

  if (leadId) {
    const attribution = {
      lead_id: leadId,
      leadgen_id: leadgenId,
      page_id: raw.page_id || null,
      form_id: raw.form_id || null,
      campaign_id: raw.campaign_id || null,
      campaign_name: raw.campaign_name || null,
      adset_id: raw.adset_id || null,
      adset_name: raw.adset_name || null,
      ad_id: raw.ad_id || null,
      ad_name: raw.ad_name || null,
      captured_at: createdAt,
    };
    const { error } = await admin.from("meta_attribution").upsert(attribution, { onConflict: "lead_id" });
    if (error) throw error;
  }

  return { outcome: resolved.row ? "reconciled" : "inserted" };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { success: false, message: "Method not allowed" });
  if (!SUPABASE_URL || !SERVICE_ROLE) return json(500, { success: false, message: "Server configuration error" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  try {
    const receivedSecret = String(req.headers.get("x-nvx-internal-secret") || "");
    const { data: expectedSecret, error: secretError } = await admin.rpc("nvx_get_runtime_secret", { p_name: "REVOPS_INTERNAL_SECRET" });
    if (secretError) throw secretError;
    if (!timingSafeTextMatch(receivedSecret, String(expectedSecret || ""))) {
      return json(401, { success: false, message: "Unauthorized" });
    }

    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }

    const requestedUserId = String(body?.user_id || "").trim().toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestedUserId)) {
      return json(422, { success: false, message: "Valid user_id is required" });
    }

    const now = new Date();
    const defaultSince = new Date(now.getTime() - DEFAULT_LOOKBACK_DAYS * 86_400_000);
    const since = parseDateInput(body?.since, defaultSince);
    const untilInput = parseDateInput(body?.until, now);
    const until = new Date(Math.min(untilInput.getTime() + 86_399_999, now.getTime()));
    const lookbackDays = Math.ceil((until.getTime() - since.getTime()) / 86_400_000);
    if (lookbackDays < 0 || lookbackDays > MAX_LOOKBACK_DAYS) {
      return json(422, { success: false, message: `Date window must be between 0 and ${MAX_LOOKBACK_DAYS} days` });
    }

    const { data: integrations, error: integrationError } = await admin
      .from("integrations")
      .select("user_id,clinic_id,service,status,metadata")
      .eq("user_id", requestedUserId)
      .eq("service", "meta_ads")
      .eq("status", "connected");
    if (integrationError) throw integrationError;

    const canonicalIntegrations = (Array.isArray(integrations) ? integrations : []).filter((row: any) => row?.metadata?.canonical === true);
    if (canonicalIntegrations.length !== 1) {
      return json(409, { success: false, message: "Expected exactly one canonical connected meta_ads integration for user" });
    }
    const integration = canonicalIntegrations[0];
    const userId = requestedUserId;

    const pageId = String(integration.metadata?.pageId ?? integration.metadata?.page_id ?? "").trim();
    const adAccountId = String(integration.metadata?.adAccountId ?? integration.metadata?.ad_account_id ?? "").trim() || null;
    if (!/^\d+$/.test(pageId)) return json(409, { success: false, message: "Canonical Meta Page ID missing" });

    const { data: accessToken, error: tokenError } = await admin.rpc("nvx_get_meta_lead_backfill_token");
    if (tokenError) throw tokenError;
    if (!accessToken) return json(503, { success: false, message: "Meta lead backfill token unavailable" });

    const forms = await fetchForms(pageId, String(accessToken));
    const counts: Record<string, number> = { inserted: 0, reconciled: 0, test: 0, identity_conflict: 0, invalid: 0, failed: 0 };
    let fetched = 0;
    const failures: Array<{ leadgenId: string | null; message: string }> = [];

    for (const form of forms) {
      const leads = await fetchLeads(form, String(accessToken), since, until);
      for (const raw of leads) {
        fetched += 1;
        try {
          const result = await persistLead(admin, userId, integration.clinic_id ?? null, adAccountId, raw);
          counts[result.outcome] = (counts[result.outcome] ?? 0) + 1;
        } catch (error: any) {
          counts.failed += 1;
          if (failures.length < 20) failures.push({ leadgenId: raw.id ? String(raw.id) : null, message: String(error?.message || "persist failed").slice(0, 240) });
        }
      }
    }

    return json(200, {
      success: counts.failed === 0,
      source: "meta_page_leadgen_forms",
      userId,
      pageId,
      adAccountId,
      period: { since: since.toISOString(), until: until.toISOString() },
      forms: forms.length,
      fetched,
      counts,
      failures,
    });
  } catch (error: any) {
    console.error("[meta-lead-backfill] error", String(error?.message || "error").slice(0, 300));
    return json(502, { success: false, message: String(error?.message || "Backfill failed").slice(0, 300) });
  }
});
