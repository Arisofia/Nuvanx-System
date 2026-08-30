import { createClient } from "jsr:@supabase/supabase-js@2";

declare const Deno: any;

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").trim();
const SERVICE_ROLE = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
const ENCRYPTION_KEY = (Deno.env.get("ENCRYPTION_KEY") || "").trim();
const META_APP_SECRET = (Deno.env.get("META_APP_SECRET") || "").trim();
const META_CANONICAL_APP_SECRET = (Deno.env.get("META_CANONICAL_APP_SECRET") || Deno.env.get("META_REPORTING_APP_SECRET") || "").trim();
const META_GRAPH = "https://graph.facebook.com/v22.0";
const MAX_RANGE_DAYS = 93;

type Action = { action_type?: string; value?: unknown };

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
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt.buffer, iterations: 100000, hash: "SHA-256" },
    km,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv.buffer }, key, combinedBuffer);
  return new TextDecoder().decode(plain).trim();
}

async function proof(token: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token))));
}

function isProofError(body: any): boolean {
  const message = String(body?.error?.message || body?.message || "").toLowerCase();
  return message.includes("appsecret_proof") || message.includes("app secret proof");
}

async function graphFetch(pathOrUrl: string, token: string, params: Record<string, string>) {
  const candidates: Array<string | null> = [...new Set([META_CANONICAL_APP_SECRET, META_APP_SECRET].filter(Boolean)), null];
  let lastStatus = 502;
  let lastMessage = "Meta API request failed";
  for (let i = 0; i < candidates.length; i += 1) {
    const url = pathOrUrl.startsWith("https://") ? new URL(pathOrUrl) : new URL(`${META_GRAPH}${pathOrUrl}`);
    if (!url.searchParams.has("access_token")) url.searchParams.set("access_token", token);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const secret = candidates[i];
    if (secret && !url.searchParams.has("appsecret_proof")) url.searchParams.set("appsecret_proof", await proof(token, secret));
    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(25000) });
    const text = await response.text();
    let body: any = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text.slice(0, 400) }; }
    if (response.ok) return body;
    lastStatus = response.status;
    lastMessage = String(body?.error?.message || body?.message || `Meta API ${response.status}`);
    if (!(i + 1 < candidates.length && isProofError(body))) break;
  }
  const error = new Error(lastMessage);
  Object.assign(error, { status: lastStatus });
  throw error;
}

function parseMetric(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function actionValue(actions: Action[] | undefined, predicate: (type: string) => boolean): number {
  if (!Array.isArray(actions)) return 0;
  return actions.reduce((sum, item) => predicate(String(item?.action_type || "").toLowerCase()) ? sum + parseMetric(item?.value) : sum, 0);
}

function isCanonicalLeadAction(type: string): boolean {
  const t = String(type || "").toLowerCase();
  return t === "lead" || t === "onsite_conversion.lead_grouped" || t === "contact_total";
}

function isMessagingAction(type: string): boolean {
  const t = String(type || "").toLowerCase();
  return t.includes("messaging_conversation_started") || t.includes("conversation_started") || t.includes("messaging_first_reply") || t.includes("onsite_conversion.messaging") || t.includes("whatsapp");
}

function actionsObject(actions: Action[] | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const action of actions || []) {
    const key = String(action?.action_type || "").trim();
    if (key) {
      const val = parseMetric(action?.value);
      out[key] = (out[key] || 0) + val;
    }
  }
  return out;
}

function parseDate(value: unknown, fallback: Date): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) ? date : fallback;
}

async function resolveCanonical(admin: any) {
  const { data: integrations, error } = await admin
    .from("integrations")
    .select("id,user_id,clinic_id,metadata")
    .eq("service", "meta_ads")
    .eq("status", "connected");
  if (error) throw error;
  const canonicalIntegrations = (Array.isArray(integrations) ? integrations : [])
    .filter((row: any) => row?.metadata?.canonical === true || String(row?.metadata?.canonical || "").toLowerCase() === "true");
  if (canonicalIntegrations.length !== 1) {
    throw new Error("Expected exactly one canonical connected meta_ads integration");
  }
  const integration = canonicalIntegrations[0];
  const clinicId = String(integration.clinic_id || "").trim();
  if (!clinicId) throw new Error("Canonical Meta integration clinic_id missing");
  const accountId = String(integration.metadata?.adAccountId ?? integration.metadata?.ad_account_id ?? "").trim();
  if (!/^act_\d+$/.test(accountId)) throw new Error("Canonical Meta ad account missing");
  const { data: credential, error: credentialError } = await admin
    .from("credentials")
    .select("id,encrypted_key")
    .eq("user_id", integration.user_id)
    .eq("service", "meta_ads")
    .maybeSingle();
  if (credentialError || !credential?.encrypted_key) throw new Error("Canonical Meta credential missing");
  const token = await decryptCred(String(credential.encrypted_key));
  if (!token) throw new Error("Canonical Meta credential empty");
  return { integration, accountId, credentialId: credential.id, token };
}

async function fetchDaily(accountId: string, token: string, since: string, until: string) {
  const rows: any[] = [];
  let next: string | null = `/${accountId}/insights`;
  let params: Record<string, string> = {
    fields: "date_start,impressions,reach,clicks,spend,ctr,cpc,cpm,conversions,actions,action_values",
    time_range: JSON.stringify({ since, until }),
    time_increment: "1",
    limit: "1000",
  };
  for (let page = 0; next && page < 20; page += 1) {
    const payload = await graphFetch(next, token, params);
    params = {};
    rows.push(...(Array.isArray(payload?.data) ? payload.data : []));
    next = typeof payload?.paging?.next === "string" ? payload.paging.next : null;
  }
  return rows;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply(405, { success: false, message: "Method not allowed" });
  if (!SUPABASE_URL || !SERVICE_ROLE) return reply(500, { success: false, message: "Server configuration error" });
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  try {
    const received = String(req.headers.get("x-nvx-internal-secret") || "");
    const { data: expected, error: secretError } = await admin.rpc("nvx_get_runtime_secret", { p_name: "REVOPS_INTERNAL_SECRET" });
    if (secretError) throw secretError;
    if (!timingSafeTextMatch(received, String(expected || ""))) return reply(401, { success: false, message: "Unauthorized" });

    const body = await req.json().catch(() => ({}));
    const now = new Date();
    const defaultSince = new Date(now.getTime() - 2 * 86400000);
    const fromDate = parseDate(body?.from, defaultSince);
    const toInput = parseDate(body?.to, now);
    const toDate = new Date(Math.min(toInput.getTime(), now.getTime()));
    const inclusiveDays = Math.floor((toDate.getTime() - fromDate.getTime()) / 86400000) + 1;
    if (inclusiveDays < 1 || inclusiveDays > MAX_RANGE_DAYS) return reply(422, { success: false, message: "Invalid Meta insight date range" });
    const since = fromDate.toISOString().slice(0, 10);
    const until = toDate.toISOString().slice(0, 10);

    const ctx = await resolveCanonical(admin);
    const providerRows = await fetchDaily(ctx.accountId, ctx.token, since, until);
    const dbRows = providerRows.map((row: any) => {
      const actions: Action[] = Array.isArray(row?.actions) ? row.actions : [];
      const leadActions = actionValue(actions, isCanonicalLeadAction);
      const messaging = actionValue(actions, isMessagingAction);
      const conversions = leadActions;
      return {
        user_id: ctx.integration.user_id,
        clinic_id: ctx.integration.clinic_id,
        ad_account_id: ctx.accountId,
        date: String(row?.date_start || "").trim(),
        impressions: parseMetric(row?.impressions),
        reach: parseMetric(row?.reach),
        clicks: parseMetric(row?.clicks),
        spend: Number((parseMetric(row?.spend)).toFixed(2)),
        cpc: Number((parseMetric(row?.cpc)).toFixed(4)),
        cpm: Number((parseMetric(row?.cpm)).toFixed(4)),
        ctr: Number((parseMetric(row?.ctr)).toFixed(6)),
        conversions: Math.round(conversions),
        leads: Math.round(leadActions),
        messaging_conversations: Math.round(messaging),
        actions: actionsObject(actions),
        action_values: Array.isArray(row?.action_values) ? row.action_values : [],
        source_quality: "canonical_meta_api",
        updated_at: new Date().toISOString(),
      };
    });

    if (dbRows.length > 0) {
      const { error: upsertError } = await admin.from("meta_daily_insights").upsert(dbRows, { onConflict: "clinic_id,ad_account_id,date" });
      if (upsertError) throw upsertError;
    }
    const nowIso = new Date().toISOString();
    const [credRes, intRes] = await Promise.all([
      admin.from("credentials").update({ last_used: nowIso }).eq("id", ctx.credentialId),
      admin.from("integrations").update({ last_sync: nowIso, last_error: null, updated_at: nowIso }).eq("id", ctx.integration.id),
    ]);
    if (credRes.error) throw credRes.error;
    if (intRes.error) throw intRes.error;

    return reply(200, {
      success: true,
      source: "canonical_meta_api",
      accountId: ctx.accountId,
      period: { since, until },
      providerRows: providerRows.length,
      rowsUpserted: dbRows.length,
    });
  } catch (error: any) {
    console.error("[meta-daily-insights]", String(error?.message || error).slice(0, 300));
    return reply(502, { success: false, message: String(error?.message || "Meta daily insights failed").slice(0, 300) });
  }
});
