import { createClient } from "jsr:@supabase/supabase-js@2";

declare const Deno: any;

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").trim();
const SERVICE_ROLE = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
const ENCRYPTION_KEY = (Deno.env.get("ENCRYPTION_KEY") || "").trim();
const META_CANONICAL_APP_SECRET = (Deno.env.get("META_CANONICAL_APP_SECRET") || "").trim();
const META_GRAPH = "https://graph.facebook.com/v22.0";
const CANONICAL_APP_ID = "1836302544001572";
const CANONICAL_SYSTEM_USER_ID = "122098243371455164";
const CANONICAL_PAGE_ID = "113908631183569";

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
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) throw new Error("Malformed canonical Meta credential");
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
  if (salt.length === 0 || iv.length !== 12 || tag.length !== 16 || ct.length === 0) {
    throw new Error("Malformed canonical Meta credential");
  }
  const combinedBuffer = new ArrayBuffer(ct.length + tag.length);
  const combined = new Uint8Array(combinedBuffer);
  combined.set(ct);
  combined.set(tag, ct.length);
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(ENCRYPTION_KEY),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt.buffer, iterations: 100000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv.buffer }, key, combinedBuffer);
  return new TextDecoder().decode(plain).trim();
}

async function computeAppsecretProof(accessToken: string): Promise<string> {
  if (!META_CANONICAL_APP_SECRET) throw new Error("Canonical Meta App Secret unavailable");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(META_CANONICAL_APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(accessToken)),
  );
  return bytesToHex(sig);
}

async function fetchJson(url: URL) {
  const response = await fetch(url.toString(), {
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  let body: any = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  if (!response.ok) {
    const providerCode = body?.error?.code ? ` code=${String(body.error.code)}` : "";
    throw new Error(`Meta API request failed status=${response.status}${providerCode}`);
  }
  return body;
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
  const appId = String(integration.metadata?.appId ?? integration.metadata?.app_id ?? "").trim();
  const systemUserId = String(integration.metadata?.systemUserId ?? integration.metadata?.system_user_id ?? "").trim();
  const pageId = String(integration.metadata?.pageId ?? integration.metadata?.page_id ?? "").trim();
  if (
    !userId ||
    appId !== CANONICAL_APP_ID ||
    systemUserId !== CANONICAL_SYSTEM_USER_ID ||
    pageId !== CANONICAL_PAGE_ID
  ) {
    throw new Error("Canonical Meta routing identity mismatch");
  }

  const { data: credentials, error: credentialError } = await admin
    .from("credentials")
    .select("id,encrypted_key")
    .eq("user_id", userId)
    .eq("service", "meta_ads");
  if (credentialError) throw credentialError;
  if (!Array.isArray(credentials) || credentials.length !== 1 || !credentials[0]?.encrypted_key) {
    throw new Error("Expected exactly one canonical Meta credential");
  }
  const credential = credentials[0];
  const managementToken = await decryptCred(String(credential.encrypted_key));
  if (!managementToken) throw new Error("Canonical Meta credential is empty");
  return { credentialId: credential.id, appId, systemUserId, pageId, managementToken };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply(405, { success: false, message: "Method not allowed" });
  if (!SUPABASE_URL || !SERVICE_ROLE || !META_CANONICAL_APP_SECRET) {
    return reply(500, { success: false, message: "Server configuration error" });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
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
    const appAccessToken = `${CANONICAL_APP_ID}|${META_CANONICAL_APP_SECRET}`;
    const debugUrl = new URL(`${META_GRAPH}/debug_token`);
    debugUrl.searchParams.set("input_token", ctx.managementToken);
    debugUrl.searchParams.set("access_token", appAccessToken);
    const debug = await fetchJson(debugUrl);
    const data = debug?.data ?? {};
    const scopes = Array.isArray(data?.scopes) ? data.scopes.map(String) : [];
    if (
      data?.is_valid !== true ||
      String(data?.app_id || "") !== CANONICAL_APP_ID ||
      String(data?.user_id || "") !== CANONICAL_SYSTEM_USER_ID ||
      !scopes.includes("leads_retrieval") ||
      !scopes.includes("pages_show_list")
    ) {
      throw new Error("Canonical Meta token identity or scopes do not match runtime contract");
    }

    const proofUrl = new URL(`${META_GRAPH}/${ctx.pageId}`);
    proofUrl.searchParams.set("fields", "id,name");
    proofUrl.searchParams.set("access_token", ctx.managementToken);
    proofUrl.searchParams.set("appsecret_proof", await computeAppsecretProof(ctx.managementToken));
    const page = await fetchJson(proofUrl);
    if (String(page?.id || "") !== ctx.pageId) throw new Error("Canonical Page proof mismatch");

    const { error: usageError } = await admin
      .from("credentials")
      .update({ last_used: new Date().toISOString() })
      .eq("id", ctx.credentialId);
    if (usageError) throw usageError;

    return reply(200, {
      success: true,
      credential_owner: "supabase_meta_ads",
      app_credential_authority: "production_edge_secret",
      appId: CANONICAL_APP_ID,
      systemUserId: CANONICAL_SYSTEM_USER_ID,
      pageId: ctx.pageId,
      proof_verified: true,
      required_scopes: ["leads_retrieval", "pages_show_list"],
    });
  } catch (error: any) {
    console.error("[meta-runtime-credential-acceptance] failure", String(error?.message || error).slice(0, 240));
    return reply(502, { success: false, message: "Meta credential acceptance failed" });
  }
});