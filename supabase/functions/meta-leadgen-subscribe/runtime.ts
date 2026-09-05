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

async function graphRequest(
  method: "GET" | "POST",
  pathOrUrl: string,
  token: string,
  params: Record<string, string> = {},
) {
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

    const response = await fetch(url.toString(), { method, signal: AbortSignal.timeout(20_000) });
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
  const pageId = String(integration.metadata?.pageId ?? integration.metadata?.page_id ?? "").trim();
  if (!userId || !/^\d+$/.test(pageId)) throw new Error("Canonical Meta Page metadata incomplete");

  const { data: credential, error: credentialError } = await admin
    .from("credentials")
    .select("id,encrypted_key")
    .eq("user_id", userId)
    .eq("service", "meta_ads")
    .maybeSingle();
  if (credentialError || !credential?.encrypted_key) throw new Error("Canonical Meta credential missing");
  const managementToken = await decryptCred(String(credential.encrypted_key));
  return { pageId, credentialId: credential.id, managementToken };
}

async function resolvePageToken(pageId: string, managementToken: string): Promise<string> {
  try {
    const page = await graphRequest("GET", `/${pageId}`, managementToken, { fields: "id,name,access_token" });
    if (String(page?.id || "") === pageId && page?.access_token) return String(page.access_token);
  } catch (_error) {
    // Fall through to /me/accounts.
  }

  let next: string | null = "/me/accounts";
  let params: Record<string, string> = { fields: "id,name,access_token", limit: "100" };
  for (let pageNo = 0; next && pageNo < 10; pageNo += 1) {
    const payload = await graphRequest("GET", next, managementToken, params);
    params = {};
    const match = (Array.isArray(payload?.data) ? payload.data : []).find(
      (row: any) => String(row?.id || "") === pageId,
    );
    if (match?.access_token) return String(match.access_token);
    next = typeof payload?.paging?.next === "string" ? payload.paging.next : null;
  }
  throw new Error("Canonical Meta credential cannot resolve configured Page Access Token");
}

async function resolveTokenApp(managementToken: string) {
  const app = await graphRequest("GET", "/app", managementToken, { fields: "id,name" });
  const id = String(app?.id || "").trim();
  if (!/^\d+$/.test(id)) throw new Error("Canonical Meta credential cannot resolve its app identity");
  return { id, name: app?.name ? String(app.name) : null };
}

async function getSubscriptions(pageId: string, pageToken: string) {
  const payload = await graphRequest("GET", `/${pageId}/subscribed_apps`, pageToken, {
    fields: "id,name,subscribed_fields",
    limit: "100",
  });
  return Array.isArray(payload?.data) ? payload.data : [];
}

function appHasLeadgen(rows: any[], appId: string): boolean {
  const target = rows.find((row: any) => String(row?.id || "") === appId);
  return Boolean(target && Array.isArray(target?.subscribed_fields) && target.subscribed_fields.includes("leadgen"));
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

    const ctx = await resolveCanonicalMeta(admin);
    const [pageToken, canonicalApp] = await Promise.all([
      resolvePageToken(ctx.pageId, ctx.managementToken),
      resolveTokenApp(ctx.managementToken),
    ]);
    const before = await getSubscriptions(ctx.pageId, pageToken);
    const alreadySubscribed = appHasLeadgen(before, canonicalApp.id);

    let mutation: any = { success: true, skipped: alreadySubscribed };
    if (!alreadySubscribed) {
      mutation = await graphRequest("POST", `/${ctx.pageId}/subscribed_apps`, pageToken, {
        subscribed_fields: "leadgen",
      });
    }

    const after = await getSubscriptions(ctx.pageId, pageToken);
    const targetSubscribed = appHasLeadgen(after, canonicalApp.id);
    const leadgenApps = after.filter(
      (row: any) => Array.isArray(row?.subscribed_fields) && row.subscribed_fields.includes("leadgen"),
    );
    await admin.from("credentials").update({ last_used: new Date().toISOString() }).eq("id", ctx.credentialId);

    return reply(targetSubscribed ? 200 : 502, {
      success: targetSubscribed,
      pageId: ctx.pageId,
      canonical_app: canonicalApp,
      before,
      mutation,
      after,
      canonical_app_has_leadgen: targetSubscribed,
      leadgen_apps: leadgenApps,
    });
  } catch (error: any) {
    console.error("[meta-leadgen-subscribe] error", String(error?.message || error).slice(0, 300));
    return reply(502, {
      success: false,
      message: String(error?.message || "Leadgen subscription failed").slice(0, 300),
    });
  }
});
