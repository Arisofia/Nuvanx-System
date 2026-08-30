import { createClient } from "jsr:@supabase/supabase-js@2";

declare const Deno: any;

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").trim().replace(/\/$/, "");
const SERVICE_ROLE = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
const ENCRYPTION_KEY = (Deno.env.get("ENCRYPTION_KEY") || "").trim();
const META_APP_ID = (Deno.env.get("META_APP_ID") || "").trim();
const META_APP_SECRET = (Deno.env.get("META_APP_SECRET") || "").trim();
const META_CANONICAL_APP_SECRET = (
  Deno.env.get("META_CANONICAL_APP_SECRET") || Deno.env.get("META_REPORTING_APP_SECRET") || ""
).trim();
const META_WEBHOOK_VERIFY_TOKEN = (
  Deno.env.get("META_WEBHOOK_VERIFY_TOKEN") || Deno.env.get("META_VERIFY_TOKEN") || ""
).trim();
const META_GRAPH = "https://graph.facebook.com/v22.0";
const META_GRAPH_ROOT = "https://graph.facebook.com";
const EXPECTED_CALLBACK = `${SUPABASE_URL}/functions/v1/api/webhooks/meta`;
const MAX_OBJECTS = 500;

type GraphMethod = "GET" | "POST";

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

async function appsecretProof(token: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token)));
  return bytesToHex(sig);
}

function isProofError(body: any): boolean {
  const message = String(body?.error?.message || body?.message || "").toLowerCase();
  return message.includes("appsecret_proof") || message.includes("app secret proof");
}

async function graphRequest(
  method: GraphMethod,
  pathOrUrl: string,
  token: string,
  params: Record<string, string> = {},
  options: { proof?: boolean } = {},
) {
  const useProof = options.proof !== false;
  const secrets = [...new Set([META_CANONICAL_APP_SECRET, META_APP_SECRET].filter(Boolean))];
  const candidates: Array<string | null> = useProof ? [...secrets, null] : [null];
  let lastMessage = "Meta API request failed";
  let lastStatus = 502;

  for (let i = 0; i < candidates.length; i += 1) {
    const url = pathOrUrl.startsWith("https://") ? new URL(pathOrUrl) : new URL(`${META_GRAPH}${pathOrUrl}`);
    if (!url.searchParams.has("access_token")) url.searchParams.set("access_token", token);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const secret = candidates[i];
    if (secret && !url.searchParams.has("appsecret_proof")) {
      url.searchParams.set("appsecret_proof", await appsecretProof(token, secret));
    }

    const response = await fetch(url.toString(), { method, signal: AbortSignal.timeout(20_000) });
    const text = await response.text();
    let body: any = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { message: text.slice(0, 500) };
    }
    if (response.ok) return body;
    lastStatus = response.status;
    lastMessage = String(body?.error?.message || body?.message || `Meta API ${response.status}`);
    if (!(i + 1 < candidates.length && isProofError(body))) break;
  }

  const error = new Error(lastMessage);
  Object.assign(error, { status: lastStatus });
  throw error;
}

async function graphFetchAll(path: string, token: string, params: Record<string, string>, proof = true) {
  const rows: any[] = [];
  let next: string | null = path;
  let nextParams = { ...params };
  for (let page = 0; next && rows.length < MAX_OBJECTS && page < 20; page += 1) {
    const payload = await graphRequest("GET", next, token, nextParams, { proof });
    nextParams = {};
    for (const row of Array.isArray(payload?.data) ? payload.data : []) {
      rows.push(row);
      if (rows.length >= MAX_OBJECTS) break;
    }
    next = typeof payload?.paging?.next === "string" ? payload.paging.next : null;
  }
  return rows;
}

async function resolveCanonicalMeta(admin: any) {
  const { data: integrations, error: integrationError } = await admin
    .from("integrations")
    .select("id,user_id,metadata")
    .eq("service", "meta_ads")
    .eq("status", "connected");
  if (integrationError) throw integrationError;

  const canonical = (Array.isArray(integrations) ? integrations : []).filter(
    (row: any) => row?.metadata?.canonical === true || String(row?.metadata?.canonical || "").toLowerCase() === "true",
  );
  if (canonical.length !== 1) throw new Error("Expected exactly one connected canonical meta_ads integration");

  const integration = canonical[0];
  const userId = String(integration.user_id || "").trim();
  const pageId = String(integration.metadata?.pageId ?? integration.metadata?.page_id ?? "").trim();
  const integrationAppId = String(
    integration.metadata?.appId ??
    integration.metadata?.app_id ??
    integration.metadata?.metaAppId ??
    integration.metadata?.meta_app_id ??
    "",
  ).trim();

  const appId = integrationAppId || META_APP_ID;
  if (!userId || !/^\d+$/.test(pageId)) throw new Error("Canonical Meta page routing metadata incomplete");
  if (!/^\d+$/.test(appId)) throw new Error("Canonical Meta App ID missing or invalid");
  if (integrationAppId && META_APP_ID && integrationAppId !== META_APP_ID) {
    throw new Error(`Canonical Meta App ID mismatch: metadata ${integrationAppId} vs env ${META_APP_ID}`);
  }

  const { data: credential, error: credentialError } = await admin
    .from("credentials")
    .select("id,encrypted_key")
    .eq("user_id", userId)
    .eq("service", "meta_ads")
    .maybeSingle();
  if (credentialError || !credential?.encrypted_key) throw new Error("Canonical Meta credential missing");
  return {
    userId,
    pageId,
    appId,
    credentialId: credential.id,
    managementToken: await decryptCred(String(credential.encrypted_key)),
  };
}

async function resolvePageToken(pageId: string, managementToken: string): Promise<string> {
  try {
    const page = await graphRequest("GET", `/${pageId}`, managementToken, { fields: "id,name,access_token" });
    if (String(page?.id || "") === pageId && page?.access_token) return String(page.access_token);
  } catch (_error) {
    // Fall through to /me/accounts.
  }
  const accounts = await graphFetchAll("/me/accounts", managementToken, {
    fields: "id,name,access_token",
    limit: "100",
  });
  const match = accounts.find((row: any) => String(row?.id || "") === pageId);
  if (!match?.access_token) throw new Error("Canonical Meta credential cannot resolve Page Access Token");
  return String(match.access_token);
}

async function resolveAppToken(appId: string): Promise<string> {
  const appSecret = META_CANONICAL_APP_SECRET || META_APP_SECRET;
  if (!/^\d+$/.test(appId) || !appSecret) throw new Error("META_APP_ID / Meta App Secret unavailable");
  const url = new URL(`${META_GRAPH_ROOT}/oauth/access_token`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("grant_type", "client_credentials");
  const response = await fetch(url.toString(), { signal: AbortSignal.timeout(20_000) });
  const body = await response.json().catch(() => ({})) as any;
  if (!response.ok || !body?.access_token) {
    throw new Error(String(body?.error?.message || "Unable to resolve Meta App Access Token"));
  }
  return String(body.access_token);
}

function fieldNames(subscription: any): string[] {
  if (!Array.isArray(subscription?.fields)) return [];
  return subscription.fields
    .map((field: any) => typeof field === "string" ? field : field?.name)
    .map((name: unknown) => String(name || "").trim())
    .filter(Boolean);
}

function normalizeUrl(raw: unknown): string {
  return String(raw || "").trim().replace(/\/$/, "");
}

function summarizeAppSubscription(row: any) {
  return {
    object: row?.object ?? null,
    callback_url: row?.callback_url ?? null,
    active: row?.active ?? null,
    fields: fieldNames(row),
  };
}

function summarizePageApp(row: any) {
  return {
    id: String(row?.id || ""),
    name: row?.name ?? null,
    subscribed_fields: Array.isArray(row?.subscribed_fields) ? row.subscribed_fields : [],
  };
}

async function fetchState(appId: string, pageId: string, pageToken: string, appToken: string) {
  const [appSubscriptions, pageApps] = await Promise.all([
    graphFetchAll(`/${appId}/subscriptions`, appToken, {}, false),
    graphFetchAll(`/${pageId}/subscribed_apps`, pageToken, {
      fields: "id,name,subscribed_fields",
      limit: "100",
    }),
  ]);
  const pageObjectSubscriptions = appSubscriptions.filter((row: any) => String(row?.object || "").toLowerCase() === "page");
  const expectedAppSubscription = pageObjectSubscriptions.find((row: any) =>
    normalizeUrl(row?.callback_url) === EXPECTED_CALLBACK && fieldNames(row).includes("leadgen") && row?.active !== false
  ) ?? null;
  const pageApp = pageApps.find((row: any) => String(row?.id || "") === appId) ?? null;
  const pageLeadgenSubscribed = Boolean(
    pageApp && Array.isArray(pageApp?.subscribed_fields) && pageApp.subscribed_fields.includes("leadgen")
  );
  return {
    appSubscriptions,
    pageApps,
    pageObjectSubscriptions,
    expectedAppSubscription,
    pageApp,
    pageLeadgenSubscribed,
  };
}

async function ensureAppLeadgenSubscription(appId: string, appToken: string, state: any) {
  if (state.expectedAppSubscription) return { changed: false, reason: "already_configured" };
  if (!META_WEBHOOK_VERIFY_TOKEN) {
    throw new Error("META_WEBHOOK_VERIFY_TOKEN unavailable; refusing to create app webhook subscription");
  }

  const conflicting = state.pageObjectSubscriptions.filter((row: any) =>
    normalizeUrl(row?.callback_url) && normalizeUrl(row?.callback_url) !== EXPECTED_CALLBACK
  );
  if (conflicting.length > 0) {
    const error = new Error("Existing Page webhook subscription uses a different callback URL; refusing to overwrite it");
    Object.assign(error, { code: "CONFLICTING_PAGE_WEBHOOK" });
    throw error;
  }

  const sameCallback = state.pageObjectSubscriptions.find((row: any) => normalizeUrl(row?.callback_url) === EXPECTED_CALLBACK);
  const fields = [...new Set([...(sameCallback ? fieldNames(sameCallback) : []), "leadgen"])];
  const result = await graphRequest("POST", `/${appId}/subscriptions`, appToken, {
    object: "page",
    callback_url: EXPECTED_CALLBACK,
    fields: fields.join(","),
    verify_token: META_WEBHOOK_VERIFY_TOKEN,
    include_values: "true",
  }, { proof: false });
  if (result?.success !== true) throw new Error("Meta did not confirm app webhook subscription");
  return { changed: true, reason: sameCallback ? "leadgen_added" : "subscription_created" };
}

async function ensurePageLeadgenSubscription(pageId: string, pageToken: string, state: any) {
  if (state.pageLeadgenSubscribed) return { changed: false, reason: "already_configured" };
  const existingFields = state.pageApp && Array.isArray(state.pageApp?.subscribed_fields)
    ? state.pageApp.subscribed_fields.map((field: unknown) => String(field))
    : [];
  const subscribedFields = [...new Set([...existingFields, "leadgen"])];
  const result = await graphRequest("POST", `/${pageId}/subscribed_apps`, pageToken, {
    subscribed_fields: subscribedFields.join(","),
  });
  if (result?.success !== true) throw new Error("Meta did not confirm Page leadgen subscription");
  return { changed: true, reason: existingFields.length > 0 ? "leadgen_added" : "app_subscribed" };
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
    const mode = String(body?.mode || "audit").trim().toLowerCase();
    if (!["audit", "ensure_leadgen"].includes(mode)) {
      return reply(400, { success: false, message: "mode must be audit or ensure_leadgen" });
    }

    const ctx = await resolveCanonicalMeta(admin);
    const [pageToken, appToken] = await Promise.all([
      resolvePageToken(ctx.pageId, ctx.managementToken),
      resolveAppToken(ctx.appId),
    ]);

    const before = await fetchState(ctx.appId, ctx.pageId, pageToken, appToken);
    let appChange = { changed: false, reason: "audit_only" };
    let pageChange = { changed: false, reason: "audit_only" };

    if (mode === "ensure_leadgen") {
      appChange = await ensureAppLeadgenSubscription(ctx.appId, appToken, before);
      const afterApp = appChange.changed ? await fetchState(ctx.appId, ctx.pageId, pageToken, appToken) : before;
      if (!afterApp.expectedAppSubscription) {
        throw new Error("App-level Page webhook still lacks active leadgen subscription after repair");
      }
      pageChange = await ensurePageLeadgenSubscription(ctx.pageId, pageToken, afterApp);
    }

    const after = mode === "ensure_leadgen"
      ? await fetchState(ctx.appId, ctx.pageId, pageToken, appToken)
      : before;

    const { error: usageError } = await admin.from("credentials").update({ last_used: new Date().toISOString() }).eq("id", ctx.credentialId);
    if (usageError) throw usageError;

    return reply(200, {
      success: true,
      mode,
      appId: ctx.appId,
      pageId: ctx.pageId,
      expected_callback: EXPECTED_CALLBACK,
      before: {
        app_page_subscriptions: before.pageObjectSubscriptions.map(summarizeAppSubscription),
        page_apps: before.pageApps.map(summarizePageApp),
        app_leadgen_webhook_ok: Boolean(before.expectedAppSubscription),
        page_leadgen_subscription_ok: before.pageLeadgenSubscribed,
      },
      changes: {
        app_subscription: appChange,
        page_subscription: pageChange,
      },
      after: {
        app_page_subscriptions: after.pageObjectSubscriptions.map(summarizeAppSubscription),
        page_apps: after.pageApps.map(summarizePageApp),
        app_leadgen_webhook_ok: Boolean(after.expectedAppSubscription),
        page_leadgen_subscription_ok: after.pageLeadgenSubscribed,
      },
      ready: Boolean(after.expectedAppSubscription) && after.pageLeadgenSubscribed,
    });
  } catch (error: any) {
    const code = String(error?.code || "META_WEBHOOK_MAINTENANCE_ERROR");
    const status = code === "CONFLICTING_PAGE_WEBHOOK" ? 409 : 502;
    console.error("[meta-webhook-maintenance]", code, String(error?.message || error).slice(0, 300));
    return reply(status, {
      success: false,
      code,
      message: String(error?.message || "Meta webhook maintenance failed").slice(0, 300),
      expected_callback: EXPECTED_CALLBACK,
    });
  }
});
