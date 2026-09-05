import { createClient } from "jsr:@supabase/supabase-js@2";

declare const Deno: any;

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").trim();
const SERVICE_ROLE = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
const ENCRYPTION_KEY = (Deno.env.get("ENCRYPTION_KEY") || "").trim();
const META_APP_SECRET = (Deno.env.get("META_APP_SECRET") || "").trim();
const META_CANONICAL_APP_SECRET = (
  Deno.env.get("META_CANONICAL_APP_SECRET") || Deno.env.get("META_REPORTING_APP_SECRET") || ""
).trim();
const META_GRAPH = "https://graph.facebook.com/v22.0";
const MAX_OBJECTS = 1000;

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
  const km = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(ENCRYPTION_KEY),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
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

function shouldRetryProof(body: any): boolean {
  const message = String(body?.error?.message || body?.message || "").toLowerCase();
  return message.includes("appsecret_proof") || message.includes("app secret proof");
}

async function graphFetch(pathOrUrl: string, token: string, params: Record<string, string> = {}) {
  const secrets = [...new Set([META_CANONICAL_APP_SECRET, META_APP_SECRET].filter(Boolean))];
  const candidates: Array<string | null> = [...secrets, null];
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

    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(20_000) });
    const text = await response.text();
    let body: any = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { message: text.slice(0, 400) };
    }
    if (response.ok) return body;
    lastStatus = response.status;
    lastMessage = String(body?.error?.message || body?.message || `Meta API ${response.status}`);
    if (!(i + 1 < candidates.length && shouldRetryProof(body))) break;
  }

  const error = new Error(lastMessage);
  Object.assign(error, { status: lastStatus });
  throw error;
}

async function graphFetchAll(path: string, token: string, params: Record<string, string>, limit = MAX_OBJECTS, maxPages = 50): Promise<{ rows: any[]; truncated: boolean }> {
  const rows: any[] = [];
  let next: string | null = path;
  let nextParams: Record<string, string> = { ...params };
  let truncated = false;

  for (let page = 0; next && rows.length < limit && page < maxPages; page += 1) {
    const payload = await graphFetch(next, token, nextParams);
    nextParams = {};
    for (const row of Array.isArray(payload?.data) ? payload.data : []) {
      rows.push(row);
      if (rows.length >= limit) {
        if (payload?.paging?.next) truncated = true;
        break;
      }
    }
    if (rows.length >= limit) break;
    next = typeof payload?.paging?.next === "string" ? payload.paging.next : null;
  }
  if (next) truncated = true;
  return { rows, truncated };
}

async function resolveCanonicalMeta(admin: any) {
  const { data: integrations, error: integrationError } = await admin
    .from("integrations")
    .select("id,user_id,clinic_id,service,status,metadata")
    .eq("service", "meta_ads")
    .eq("status", "connected");
  if (integrationError) throw integrationError;

  const canonical = (Array.isArray(integrations) ? integrations : []).filter(
    (row: any) => row?.metadata?.canonical === true || String(row?.metadata?.canonical || "").toLowerCase() === "true",
  );
  if (canonical.length !== 1) throw new Error("Expected exactly one connected canonical meta_ads integration");

  const integration = canonical[0];
  const userId = String(integration.user_id || "").trim();
  const clinicId = String(integration.clinic_id || "").trim();
  const pageId = String(integration.metadata?.pageId ?? integration.metadata?.page_id ?? "").trim();
  const adAccountId = String(integration.metadata?.adAccountId ?? integration.metadata?.ad_account_id ?? "").trim();
  if (!userId || !clinicId || !/^\d+$/.test(pageId) || !/^act_\d+$/.test(adAccountId)) {
    throw new Error("Canonical Meta routing metadata incomplete");
  }

  const { data: credential, error: credentialError } = await admin
    .from("credentials")
    .select("id,encrypted_key")
    .eq("user_id", userId)
    .eq("service", "meta_ads")
    .maybeSingle();
  if (credentialError || !credential?.encrypted_key) throw new Error("Canonical Meta credential missing");
  const managementToken = await decryptCred(String(credential.encrypted_key));
  return { integration, userId, clinicId, pageId, adAccountId, credentialId: credential.id, managementToken };
}

async function resolvePageToken(pageId: string, managementToken: string): Promise<string> {
  try {
    const page = await graphFetch(`/${pageId}`, managementToken, { fields: "id,name,access_token" });
    if (String(page?.id || "") === pageId && page?.access_token) return String(page.access_token);
  } catch (_error) {
    // Fall through to /me/accounts.
  }

  const accounts = await graphFetchAll("/me/accounts", managementToken, {
    fields: "id,name,access_token",
    limit: "100",
  });
  const match = accounts.rows.find((row: any) => String(row?.id || "") === pageId);
  if (!match?.access_token) throw new Error("Canonical Meta credential cannot resolve configured Page Access Token");
  return String(match.access_token);
}

function collectLeadFormIds(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectLeadFormIds(item, out);
    return out;
  }
  if (!value || typeof value !== "object") return out;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase();
    if (["lead_gen_form_id", "leadgen_form_id", "lead_form_id"].includes(normalized)) {
      const id = String(child ?? "").trim();
      if (/^\d+$/.test(id)) out.add(id);
      continue;
    }
    collectLeadFormIds(child, out);
  }
  return out;
}

function objectMap(rows: any[]) {
  return new Map(rows.map((row: any) => [String(row?.id || ""), row]));
}

async function getPageForms(pageId: string, pageToken: string) {
  return await graphFetchAll(`/${pageId}/leadgen_forms`, pageToken, {
    fields: "id,name,status,created_time",
    limit: "100",
  });
}

async function getPageSubscriptions(pageId: string, pageToken: string) {
  const result = await graphFetchAll(`/${pageId}/subscribed_apps`, pageToken, {
    fields: "id,name,subscribed_fields",
    limit: "100",
  });
  return { ok: true, rows: result.rows, truncated: result.truncated };
}

async function getAdsRouting(adAccountId: string, managementToken: string, campaignId: string | null) {
  const adsPath = campaignId ? `/${campaignId}/ads` : `/${adAccountId}/ads`;
  const adsetsPath = campaignId ? `/${campaignId}/adsets` : `/${adAccountId}/adsets`;
  const [adsResult, adsetsResult, campaignsResult] = await Promise.all([
    graphFetchAll(adsPath, managementToken, {
      fields: "id,name,status,effective_status,adset_id,campaign_id,creative{id,name,object_story_spec,asset_feed_spec}",
      limit: "500",
    }),
    graphFetchAll(adsetsPath, managementToken, {
      fields: "id,name,status,effective_status,campaign_id",
      limit: "500",
    }),
    graphFetchAll(`/${adAccountId}/campaigns`, managementToken, {
      fields: "id,name,status,effective_status,objective",
      limit: "500",
    }),
  ]);

  const ads = adsResult.rows;
  const adsets = adsetsResult.rows;
  const campaigns = campaignsResult.rows;
  const truncated = adsResult.truncated || adsetsResult.truncated || campaignsResult.truncated;

  return { ads, adsets, campaigns, truncated };
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
    const campaignIdRaw = String(body?.campaignId ?? body?.campaign_id ?? "").trim();
    const campaignId = /^\d+$/.test(campaignIdRaw) ? campaignIdRaw : null;

    const ctx = await resolveCanonicalMeta(admin);
    const pageToken = await resolvePageToken(ctx.pageId, ctx.managementToken);
    const [formsResult, subscriptionsResult, routing] = await Promise.all([
      getPageForms(ctx.pageId, pageToken),
      getPageSubscriptions(ctx.pageId, pageToken),
      getAdsRouting(ctx.adAccountId, ctx.managementToken, campaignId),
    ]);

    const forms = formsResult.rows;
    const formMap = objectMap(forms);
    const adsetMap = objectMap(routing.adsets);
    const campaignMap = objectMap(routing.campaigns);

    const ads = routing.ads.map((ad: any) => {
      const formIds = [...collectLeadFormIds(ad?.creative ?? {})];
      const adset = adsetMap.get(String(ad?.adset_id || ""));
      const campaign = campaignMap.get(String(ad?.campaign_id || ""));
      return {
        id: String(ad?.id || ""),
        name: ad?.name ?? null,
        status: ad?.status ?? null,
        effective_status: ad?.effective_status ?? null,
        campaign_id: ad?.campaign_id ?? null,
        campaign_name: campaign?.name ?? null,
        campaign_status: campaign?.status ?? null,
        campaign_effective_status: campaign?.effective_status ?? null,
        adset_id: ad?.adset_id ?? null,
        adset_name: adset?.name ?? null,
        adset_status: adset?.status ?? null,
        adset_effective_status: adset?.effective_status ?? null,
        creative_id: ad?.creative?.id ?? null,
        creative_name: ad?.creative?.name ?? null,
        lead_form_ids: formIds,
        lead_forms: formIds.map((id) => ({
          id,
          name: formMap.get(id)?.name ?? null,
          status: formMap.get(id)?.status ?? null,
          present_on_page: formMap.has(id),
        })),
      };
    });

    const uniqueFormIds = [...new Set(ads.flatMap((ad: any) => ad.lead_form_ids))];
    const activeAds = ads.filter((ad: any) => String(ad.effective_status || "") === "ACTIVE");
    const activeFormIds = [...new Set(activeAds.flatMap((ad: any) => ad.lead_form_ids))];
    const leadgenSubscribers = subscriptionsResult.rows.filter((row: any) =>
      Array.isArray(row?.subscribed_fields) && row.subscribed_fields.some((field: unknown) => String(field) === "leadgen")
    );
    const truncated = formsResult.truncated || subscriptionsResult.truncated || routing.truncated;

    const { error: usageError } = await admin.from("credentials").update({ last_used: new Date().toISOString() }).eq("id", ctx.credentialId);
    if (usageError) throw usageError;

    return reply(200, {
      success: true,
      source: "meta_graph_live",
      truncated,
      pageId: ctx.pageId,
      adAccountId: ctx.adAccountId,
      campaignId,
      forms: forms.map((form: any) => ({
        id: String(form?.id || ""),
        name: form?.name ?? null,
        status: form?.status ?? null,
        created_time: form?.created_time ?? null,
      })),
      subscriptions: {
        ok: subscriptionsResult.ok,
        apps: subscriptionsResult.rows,
        leadgen_apps: leadgenSubscribers,
      },
      ads,
      summary: {
        ads: ads.length,
        active_ads: activeAds.length,
        ads_with_lead_form: ads.filter((ad: any) => ad.lead_form_ids.length > 0).length,
        active_ads_with_lead_form: activeAds.filter((ad: any) => ad.lead_form_ids.length > 0).length,
        unique_form_ids: uniqueFormIds,
        active_form_ids: activeFormIds,
        page_form_ids: forms.map((form: any) => String(form?.id || "")),
        all_active_ads_have_form: activeAds.length > 0 && activeAds.every((ad: any) => ad.lead_form_ids.length > 0),
        all_active_ads_same_form: activeAds.length > 0 && activeFormIds.length === 1 && activeAds.every((ad: any) => ad.lead_form_ids.length > 0),
        page_has_leadgen_subscriber: leadgenSubscribers.length > 0,
        truncated,
      },
    });
  } catch (error: any) {
    console.error("[meta-routing-audit] error", String(error?.message || error).slice(0, 300));
    return reply(502, { success: false, message: String(error?.message || "Meta routing audit failed").slice(0, 300) });
  }
});
