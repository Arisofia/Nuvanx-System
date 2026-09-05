import { createClient } from "jsr:@supabase/supabase-js@2";

declare const Deno: any;

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").trim();
const SERVICE_ROLE = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
const ENCRYPTION_KEY = (Deno.env.get("ENCRYPTION_KEY") || "").trim();
const META_APP_SECRET = (Deno.env.get("META_APP_SECRET") || "").trim();
const META_CANONICAL_APP_SECRET = (Deno.env.get("META_CANONICAL_APP_SECRET") || Deno.env.get("META_REPORTING_APP_SECRET") || "").trim();
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

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(hex.length >>> 1);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < hex.length; i += 2) out[i >>> 1] = Number.parseInt(hex.slice(i, i + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function decryptCred(encoded: string): Promise<string> {
  if (!ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY unavailable");
  const parts = String(encoded || "").split(":");
  if (parts.length !== 4) throw new Error("Malformed canonical Meta credential");
  const [saltH, ivH, tagH, ctH] = parts;
  const salt = hexToBytes(saltH);
  const iv = hexToBytes(ivH);
  const tag = hexToBytes(tagH);
  const ct = hexToBytes(ctH);
  const combinedBuffer = new ArrayBuffer(ct.length + tag.length);
  const combined = new Uint8Array(combinedBuffer);
  combined.set(ct);
  combined.set(tag, ct.length);
  const km = await crypto.subtle.importKey("raw", new TextEncoder().encode(ENCRYPTION_KEY), "PBKDF2", false, ["deriveKey"]);
  const aesKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt.buffer, iterations: 100000, hash: "SHA-256" },
    km,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv.buffer }, aesKey, combinedBuffer);
  return new TextDecoder().decode(plain).trim();
}

async function computeAppsecretProof(accessToken: string, appSecret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(accessToken)));
  return bytesToHex(sig);
}

function graphErrorMessage(body: any, status: number): string {
  return String(body?.error?.message || body?.message || `Meta API ${status}`);
}

function shouldRetryProof(body: any): boolean {
  const message = String(body?.error?.message || body?.message || "").toLowerCase();
  return message.includes("appsecret_proof") || message.includes("app secret proof");
}

async function graphFetch(pathOrUrl: string, token: string, params: Record<string, string> = {}) {
  const secrets = [...new Set([META_CANONICAL_APP_SECRET, META_APP_SECRET].filter(Boolean))];
  const candidates: Array<string | null> = secrets.length > 0 ? [...secrets] : [null];
  let lastMessage = "Meta API request failed";
  let lastStatus = 502;

  for (let i = 0; i < candidates.length; i += 1) {
    const url = pathOrUrl.startsWith("https://") ? new URL(pathOrUrl) : new URL(`${META_GRAPH}${pathOrUrl}`);
    if (!url.searchParams.has("access_token")) url.searchParams.set("access_token", token);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const secret = candidates[i];
    if (secret && !url.searchParams.has("appsecret_proof")) {
      url.searchParams.set("appsecret_proof", await computeAppsecretProof(token, secret));
    }
    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(20000) });
    const text = await response.text();
    let body: any = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text.slice(0, 400) }; }
    if (response.ok) return body;
    lastStatus = response.status;
    lastMessage = graphErrorMessage(body, response.status);
    if (!(i + 1 < candidates.length && shouldRetryProof(body))) break;
  }

  const error = new Error(lastMessage);
  Object.assign(error, { status: lastStatus });
  throw error;
}

async function resolvePageToken(pageId: string, managementToken: string): Promise<string> {
  try {
    const page = await graphFetch(`/${pageId}`, managementToken, { fields: "id,name,access_token" });
    if (String(page?.id || "") === pageId && page?.access_token) return String(page.access_token);
  } catch (error) {
    console.warn("[meta-lead-backfill] direct page token resolution failed", String((error as any)?.message || error).slice(0, 180));
  }

  let next: string | null = "/me/accounts";
  let params: Record<string, string> = { fields: "id,name,access_token", limit: "100" };
  for (let pageNo = 0; next && pageNo < 10; pageNo += 1) {
    const payload = await graphFetch(next, managementToken, params);
    params = {};
    const match = (Array.isArray(payload?.data) ? payload.data : []).find((row: any) => String(row?.id || "") === pageId);
    if (match?.access_token) return String(match.access_token);
    next = typeof payload?.paging?.next === "string" ? payload.paging.next : null;
  }
  throw new Error("Canonical Meta credential cannot resolve a Page Access Token for the configured Page");
}

async function resolveCanonicalMeta(admin: any) {
  const { data: integrations, error: integrationError } = await admin
    .from("integrations")
    .select("id,user_id,clinic_id,service,status,metadata")
    .eq("service", "meta_ads")
    .eq("status", "connected");
  if (integrationError) throw integrationError;
  const canonicalIntegrations = (Array.isArray(integrations) ? integrations : [])
    .filter((row: any) => row?.metadata?.canonical === true || String(row?.metadata?.canonical || "").toLowerCase() === "true");
  if (canonicalIntegrations.length !== 1) {
    throw new Error("Expected exactly one connected canonical meta_ads integration");
  }
  const integration = canonicalIntegrations[0];
  const userId = String(integration.user_id || "").trim();
  const pageId = String(integration.metadata?.pageId ?? integration.metadata?.page_id ?? "").trim();
  const adAccountId = String(integration.metadata?.adAccountId ?? integration.metadata?.ad_account_id ?? "").trim() || null;
  if (!userId) throw new Error("Canonical Meta owner missing");
  if (!/^\d+$/.test(pageId)) throw new Error("Canonical Meta Page ID missing");

  const { data: credential, error: credentialError } = await admin
    .from("credentials")
    .select("id,encrypted_key")
    .eq("user_id", userId)
    .eq("service", "meta_ads")
    .maybeSingle();
  if (credentialError || !credential?.encrypted_key) throw new Error("Canonical Meta credential missing");
  const managementToken = await decryptCred(String(credential.encrypted_key));
  if (!managementToken) throw new Error("Canonical Meta credential is empty");
  return { integration, userId, pageId, adAccountId, credentialId: credential.id, managementToken };
}

async function fetchForms(pageId: string, token: string) {
  const forms: Array<{ id: string; name?: string }> = [];
  let next: string | null = `/${pageId}/leadgen_forms`;
  let params: Record<string, string> = { fields: "id,name", limit: "100" };
  while (next && forms.length < MAX_FORMS) {
    const payload = await graphFetch(next, token, params);
    params = {};
    for (const form of Array.isArray(payload?.data) ? payload.data : []) {
      if (form?.id) forms.push({ id: String(form.id), name: form.name ? String(form.name) : undefined });
      if (forms.length >= MAX_FORMS) break;
    }
    next = typeof payload?.paging?.next === "string" ? payload.paging.next : null;
  }
  return forms;
}

async function fetchLeads(form: { id: string; name?: string }, token: string, since: Date, until: Date) {
  const leads: MetaLead[] = [];
  const sinceTs = Math.floor(since.getTime() / 1000);
  let next: string | null = `/${form.id}/leads`;
  let params: Record<string, string> = {
    fields: "id,field_data,created_time,ad_id,ad_name,form_id,form_name,campaign_id,campaign_name,adset_id,adset_name,page_id",
    filtering: JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: sinceTs }]),
    limit: "100",
  };
  while (next && leads.length < MAX_LEADS) {
    const payload = await graphFetch(next, token, params);
    params = {};
    for (const raw of Array.isArray(payload?.data) ? payload.data : []) {
      const created = raw?.created_time ? new Date(raw.created_time) : null;
      if (!created || !Number.isFinite(created.getTime()) || created < since || created > until) continue;
      leads.push({ ...raw, form_name: raw.form_name ?? form.name ?? null });
      if (leads.length >= MAX_LEADS) break;
    }
    next = typeof payload?.paging?.next === "string" ? payload.paging.next : null;
  }
  return leads;
}

function parseDateInput(value: unknown, fallback: Date): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) ? parsed : fallback;
}

function normalizePhone(raw: unknown): string | null {
  const text = String(raw ?? "").trim();
  if (!text || /dummy data|test lead/i.test(text)) return null;
  const digits = text.replaceAll(/\D/g, "");
  if (digits.length === 9 && /^[6789]/.test(digits)) return `+34${digits}`;
  if (digits.length >= 11 && digits.startsWith("34")) return `+${digits}`;
  if (text.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
}

function phoneLookupKey(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replaceAll(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("34")) return digits.slice(2);
  return digits || null;
}

function normalizeEmail(raw: unknown): string | null {
  const value = String(raw ?? "").trim().toLowerCase();
  return value && value.includes("@") && value.length <= 254 ? value : null;
}

function mapLead(raw: MetaLead) {
  const fields: Record<string, string> = {};
  for (const item of raw.field_data ?? []) {
    const key = String(item?.name || "").trim().toLowerCase();
    if (!key) continue;
    const value = (Array.isArray(item?.values) ? item.values : []).map((v) => String(v ?? "").trim()).filter(Boolean).join(" ").trim();
    if (value) fields[key] = value;
  }
  const first = (...keys: string[]) => keys.map((k) => fields[k]).find((v) => v?.trim())?.trim() || null;
  const firstName = first("first_name", "nombre", "firstname");
  const lastName = first("last_name", "apellidos", "lastname");
  const fullName = first("full_name", "name", "nombre_completo") || [firstName, lastName].filter(Boolean).join(" ").trim() || null;
  const email = normalizeEmail(first("email", "work_email"));
  const phone = normalizePhone(first("phone_number", "phone", "telefono", "teléfono", "mobile_phone", "mobilephone"));
  const rawJoined = JSON.stringify(raw.field_data ?? []).toLowerCase();
  const isTest = email === "test@meta.com" || /<test lead|dummy data/.test(String(fullName || "").toLowerCase()) || /<test lead|dummy data/.test(rawJoined);
  return { fullName, email, phone, isTest };
}

const LEAD_MATCH_FIELDS = "id,user_id,clinic_id,external_id,source,campaign_id,campaign_name,meta_form_id,meta_ad_id,meta_ad_name,ad_account_id";

type ExistingLeadResolution = {
  row: any | null;
  conflict: boolean;
};

function scopeOwner(query: any, userId: string, clinicId: string | null) {
  let scoped = query.eq("user_id", userId);
  scoped = clinicId ? scoped.eq("clinic_id", clinicId) : scoped.is("clinic_id", null);
  return scoped;
}

async function fetchIdentityCandidate(
  admin: any,
  userId: string,
  clinicId: string | null,
  column: "phone_normalized" | "email",
  value: string | null,
): Promise<ExistingLeadResolution> {
  if (!value) return { row: null, conflict: false };
  const query = scopeOwner(
    admin.from("leads").select(LEAD_MATCH_FIELDS),
    userId,
    clinicId,
  )
    .eq(column, value)
    .is("deleted_at", null)
    .limit(2);
  const { data, error } = await query;
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  if (rows.length > 1) return { row: null, conflict: true };
  return { row: rows[0] ?? null, conflict: false };
}

async function findExistingLead(
  admin: any,
  userId: string,
  clinicId: string | null,
  leadgenId: string,
  phone: string | null,
  email: string | null,
): Promise<ExistingLeadResolution> {
  // Provider lead IDs are not globally unique tenancy keys. Resolve them on the
  // durable lead owner (user + clinic), then use attribution only by lead_id.
  const externalQuery = scopeOwner(
    admin.from("leads").select(LEAD_MATCH_FIELDS),
    userId,
    clinicId,
  )
    .eq("external_id", leadgenId)
    .is("deleted_at", null)
    .limit(2);
  const { data: externalRows, error: externalError } = await externalQuery;
  if (externalError) throw externalError;
  const external = Array.isArray(externalRows) ? externalRows : [];
  if (external.length > 1) return { row: null, conflict: true };
  if (external[0]) return { row: external[0], conflict: false };

  const phoneCandidate = await fetchIdentityCandidate(admin, userId, clinicId, "phone_normalized", phoneLookupKey(phone));
  if (phoneCandidate.conflict) return phoneCandidate;
  const emailCandidate = await fetchIdentityCandidate(admin, userId, clinicId, "email", email);
  if (emailCandidate.conflict) return emailCandidate;

  if (phoneCandidate.row && emailCandidate.row && phoneCandidate.row.id !== emailCandidate.row.id) {
    return { row: null, conflict: true };
  }
  return { row: phoneCandidate.row ?? emailCandidate.row ?? null, conflict: false };
}

async function persistLead(admin: any, ctx: any, raw: MetaLead) {
  const leadgenId = String(raw.id || "").trim();
  if (!leadgenId) return "invalid";
  const mapped = mapLead(raw);
  if (mapped.isTest) return "test";
  const clinicId = ctx.integration.clinic_id ? String(ctx.integration.clinic_id) : null;
  const resolved = await findExistingLead(admin, ctx.userId, clinicId, leadgenId, mapped.phone, mapped.email);
  if (resolved.conflict) return "identity_conflict";
  const createdAt = raw.created_time && Number.isFinite(new Date(raw.created_time).getTime()) ? new Date(raw.created_time).toISOString() : new Date().toISOString();
  let leadId = resolved.row?.id ?? null;
  const common = {
    campaign_id: raw.campaign_id || null,
    campaign_name: raw.campaign_name || null,
    adset_id: raw.adset_id || null,
    adset_name: raw.adset_name || null,
    ad_id: raw.ad_id || null,
    ad_name: raw.ad_name || null,
    form_id: raw.form_id || null,
    form_name: raw.form_name || null,
    meta_form_id: raw.form_id || null,
    meta_ad_id: raw.ad_id || null,
    meta_ad_name: raw.ad_name || null,
    ad_account_id: ctx.adAccountId,
  };
  if (leadId) {
    const existing = resolved.row;
    const updates: Record<string, unknown> = { external_id: existing.external_id || leadgenId };
    for (const [key, value] of Object.entries(common)) if (!(existing as any)[key] && value) updates[key] = value;
    let updateQuery = admin.from("leads").update(updates).eq("id", leadId).eq("user_id", ctx.userId);
    updateQuery = clinicId ? updateQuery.eq("clinic_id", clinicId) : updateQuery.is("clinic_id", null);
    const { error } = await updateQuery;
    if (error) throw error;
  } else {
    const { data, error } = await admin.from("leads").insert({
      user_id: ctx.userId,
      clinic_id: clinicId,
      external_id: leadgenId,
      source: "meta_leadgen",
      stage: "lead",
      name: mapped.fullName,
      email: mapped.email,
      phone: mapped.phone,
      ...common,
      created_at_meta: createdAt,
      created_at: createdAt,
      utm_source: "meta",
      utm_medium: "paid_social",
      utm_campaign: raw.campaign_name || null,
      raw_field_data: { field_data: raw.field_data ?? [], backfill: "page_leadgen_forms_v2" },
    }).select("id").single();
    if (error) throw error;
    leadId = data?.id ?? null;
  }
  if (leadId) {
    const { error } = await admin.from("meta_attribution").upsert({
      lead_id: leadId,
      leadgen_id: leadgenId,
      page_id: raw.page_id || ctx.pageId,
      form_id: raw.form_id || null,
      campaign_id: raw.campaign_id || null,
      campaign_name: raw.campaign_name || null,
      adset_id: raw.adset_id || null,
      adset_name: raw.adset_name || null,
      ad_id: raw.ad_id || null,
      ad_name: raw.ad_name || null,
      captured_at: createdAt,
    }, { onConflict: "lead_id" });
    if (error) throw error;
  }
  return resolved.row ? "reconciled" : "inserted";
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply(405, { success: false, message: "Method not allowed" });
  if (!SUPABASE_URL || !SERVICE_ROLE) return reply(500, { success: false, message: "Server configuration error" });
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  try {
    const receivedSecret = String(req.headers.get("x-nvx-internal-secret") || "");
    const { data: expectedSecret, error: secretError } = await admin.rpc("nvx_get_runtime_secret", { p_name: "REVOPS_INTERNAL_SECRET" });
    if (secretError) throw secretError;
    if (!timingSafeTextMatch(receivedSecret, String(expectedSecret || ""))) return reply(401, { success: false, message: "Unauthorized" });

    const body = await req.json().catch(() => ({}));
    const now = new Date();
    const since = parseDateInput(body?.since, new Date(now.getTime() - DEFAULT_LOOKBACK_DAYS * 86400000));
    const untilInput = parseDateInput(body?.until, now);
    const until = new Date(Math.min(untilInput.getTime() + 86399999, now.getTime()));
    const lookbackDays = Math.ceil((until.getTime() - since.getTime()) / 86400000);
    if (lookbackDays < 0 || lookbackDays > MAX_LOOKBACK_DAYS) return reply(422, { success: false, message: `Date window must be between 0 and ${MAX_LOOKBACK_DAYS} days` });

    const ctx = await resolveCanonicalMeta(admin);
    let token = ctx.managementToken;
    let forms: Array<{ id: string; name?: string }> = [];
    let tokenMode = "canonical_management";
    try {
      forms = await fetchForms(ctx.pageId, token);
    } catch (error) {
      const message = String((error as any)?.message || error);
      if (!/page access token|oauth|permission|#190|unsupported get request/i.test(message)) throw error;
      token = await resolvePageToken(ctx.pageId, ctx.managementToken);
      tokenMode = "resolved_page_access";
      forms = await fetchForms(ctx.pageId, token);
    }

    const counts: Record<string, number> = { inserted: 0, reconciled: 0, test: 0, identity_conflict: 0, invalid: 0, failed: 0 };
    let fetched = 0;
    const failures: Array<{ leadgenId: string | null; message: string }> = [];
    for (const form of forms) {
      const leads = await fetchLeads(form, token, since, until);
      for (const raw of leads) {
        fetched += 1;
        try {
          const outcome = await persistLead(admin, ctx, raw);
          counts[outcome] = (counts[outcome] ?? 0) + 1;
        } catch (error: any) {
          counts.failed += 1;
          if (failures.length < 20) failures.push({ leadgenId: raw.id ? String(raw.id) : null, message: String(error?.message || "persist failed").slice(0, 240) });
        }
      }
    }

    const { error: usageError } = await admin.from("credentials").update({ last_used: new Date().toISOString() }).eq("id", ctx.credentialId);
    if (usageError) throw usageError;
    return reply(200, {
      success: counts.failed === 0,
      source: "meta_page_leadgen_forms",
      credential: "canonical_meta_ads",
      token_mode: tokenMode,
      pageId: ctx.pageId,
      adAccountId: ctx.adAccountId,
      period: { since: since.toISOString(), until: until.toISOString() },
      forms: forms.length,
      fetched,
      counts,
      failures,
    });
  } catch (error: any) {
    console.error("[meta-lead-backfill] error", String(error?.message || "error").slice(0, 300));
    return reply(502, { success: false, message: String(error?.message || "Backfill failed").slice(0, 300) });
  }
});
