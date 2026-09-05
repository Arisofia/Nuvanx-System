// NUVANX Web Events Bridge v3: internal server-side Meta CAPI relay.
// No browser or public caller is allowed. The Supabase gateway verifies JWT and
// the function additionally requires the exact service-role bearer token.
import { createClient } from "jsr:@supabase/supabase-js@2";

declare const Deno: any;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
const ENCRYPTION_KEY = Deno.env.get("ENCRYPTION_KEY") || "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") || "";
const META_CANONICAL_APP_SECRET = Deno.env.get("META_CANONICAL_APP_SECRET") || Deno.env.get("META_REPORTING_APP_SECRET") || "";
const META_PIXEL_ID = Deno.env.get("META_PIXEL_ID") || "";
const DEFAULT_LANDING_USER_EMAIL = Deno.env.get("DEFAULT_LANDING_USER_EMAIL") || Deno.env.get("LANDING_USER_EMAIL") || "";
const META_TEST_EVENT_CODE = (Deno.env.get("META_TEST_EVENT_CODE") || "").trim();
const META_GRAPH = "https://graph.facebook.com/v22.0";
const CANONICAL_EVENT_SOURCE_URL = "https://nuvanx.com/";

class RequestValidationError extends Error {
  status: number;

  constructor(message: string, status = 422) {
    super(message);
    this.name = "RequestValidationError";
    this.status = status;
  }
}

function headers() {
  return {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: headers() });
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length >>> 1);
  for (let i = 0; i < hex.length; i += 2) arr[i >>> 1] = Number.parseInt(hex.slice(i, i + 2), 16);
  return arr;
}

async function sha256Bytes(raw: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return new Uint8Array(digest);
}

async function sha256Hex(raw: string): Promise<string> {
  return bytesToHex(await sha256Bytes(String(raw).trim().toLowerCase()));
}

async function constantTimeMatch(received: string, expected: string): Promise<boolean> {
  if (!received || !expected) return false;
  const a = await sha256Bytes(received);
  const b = await sha256Bytes(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function requireServiceRole(req: Request): Promise<boolean> {
  const authorization = String(req.headers.get("authorization") || "").trim();
  if (!authorization.toLowerCase().startsWith("bearer ")) return false;
  const token = authorization.slice(7).trim();
  return await constantTimeMatch(token, SUPABASE_SERVICE_ROLE_KEY);
}

async function decryptCred(encoded: string): Promise<string> {
  if (!ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY not configured");
  const parts = String(encoded || "").split(":");
  if (parts.length !== 4) throw new Error("malformed encrypted credential");
  const [saltH, ivH, tagH, ctH] = parts;
  const salt = hexToBytes(saltH);
  const iv = hexToBytes(ivH);
  const tag = hexToBytes(tagH);
  const ct = hexToBytes(ctH);
  const combined = new Uint8Array(ct.length + tag.length);
  combined.set(ct);
  combined.set(tag, ct.length);
  const km = await crypto.subtle.importKey("raw", new TextEncoder().encode(ENCRYPTION_KEY), "PBKDF2", false, ["deriveKey"]);
  const aesKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt.buffer as ArrayBuffer, iterations: 100000, hash: "SHA-256" },
    km,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
      aesKey,
      combined.buffer as ArrayBuffer,
    ),
  );
}

async function appsecretProof(accessToken: string, appSecret: string): Promise<string | null> {
  if (!appSecret) return null;
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

function normalizeDigits(raw: unknown): string {
  return String(raw || "").replaceAll(/\D/g, "");
}

function sanitizeClinicId(raw: unknown): string {
  const value = String(raw || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    throw new RequestValidationError("Valid clinic_id is required");
  }
  return value;
}

async function resolveOwnerAndMeta(admin: any, clinicId: string) {
  let userId = "";
  if (DEFAULT_LANDING_USER_EMAIL) {
    const { data: userByEmail } = await admin.from("users").select("id").eq("email", DEFAULT_LANDING_USER_EMAIL).maybeSingle();
    userId = userByEmail?.id || "";
  }

  const scoreIntegration = (row: any) => {
    const metadata = row?.metadata ?? {};
    if (row?.service === "meta_ads" && metadata?.canonical === true) return 2;
    if (row?.service === "meta_ads") return 1;
    return 0;
  };

  let rows: any[] = [];
  if (userId) {
    const { data } = await admin
      .from("integrations")
      .select("user_id,clinic_id,service,metadata,status,updated_at")
      .eq("user_id", userId)
      .eq("clinic_id", clinicId)
      .in("service", ["meta_ads", "meta"])
      .eq("status", "connected");
    rows = data || [];
  } else {
    const { data } = await admin
      .from("integrations")
      .select("user_id,clinic_id,service,metadata,status,updated_at")
      .eq("clinic_id", clinicId)
      .in("service", ["meta_ads", "meta"])
      .eq("status", "connected")
      .order("updated_at", { ascending: false })
      .limit(20);
    rows = data || [];
  }

  const integration = [...rows].sort((a: any, b: any) =>
    scoreIntegration(b) - scoreIntegration(a) || String(b?.updated_at || "").localeCompare(String(a?.updated_at || ""))
  )[0];

  if (!integration) throw new Error("Connected Meta integration not found for clinic");
  userId = integration.user_id || userId;
  if (!userId) throw new Error("No Meta owner user resolved");

  const service = integration.service === "meta_ads" ? "meta_ads" : "meta";
  const { data: cred } = await admin
    .from("credentials")
    .select("encrypted_key")
    .eq("user_id", userId)
    .eq("clinic_id", clinicId)
    .eq("service", service)
    .maybeSingle();
  if (!cred?.encrypted_key) throw new Error("Meta credential not found for clinic");

  const metadata = integration.metadata || {};
  const pixelId = normalizeDigits(metadata.pixelId || metadata.pixel_id || META_PIXEL_ID);
  if (!pixelId) throw new Error("Meta Pixel ID not configured");

  const appSecret = service === "meta_ads" ? META_CANONICAL_APP_SECRET : META_APP_SECRET;
  return { pixelId, accessToken: await decryptCred(cred.encrypted_key), appSecret };
}

function getHeaderIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") || null;
}

function normalizeIp(raw: unknown): string | null {
  const value = String(raw || "").trim();
  if (!value) return null;
  if (/^[0-9a-fA-F:.]+$/.test(value) && value.length <= 45) return value;
  return null;
}

async function buildUserData(body: any, req: Request) {
  const userData: Record<string, any> = {};
  const email = String(body.email || body.em || "").trim();
  const phoneDigits = normalizeDigits(body.phone || body.ph || "");
  const externalId = String(body.nvx_lead_id || body.external_id || body.externalId || "").trim();

  if (email) userData.em = [await sha256Hex(email)];
  if (phoneDigits) userData.ph = [await sha256Hex(phoneDigits)];
  if (externalId) userData.external_id = [await sha256Hex(externalId)];

  const fbc = String(body.fbc || body._meta?.fbc || "").trim();
  const fbp = String(body.fbp || body._meta?.fbp || "").trim();
  const ua = String(body.user_agent || body.userAgent || req.headers.get("user-agent") || "").trim();
  const ip = normalizeIp(body.client_ip_address || body.ip) || getHeaderIp(req);

  if (fbc) userData.fbc = fbc;
  if (fbp) userData.fbp = fbp;
  if (ip) userData.client_ip_address = ip;
  if (ua) userData.client_user_agent = ua;

  return userData;
}

function sanitizeEventName(raw: unknown): string {
  const allowed = new Set(["PageView", "ViewContent", "Contact", "Lead"]);
  const value = String(raw || "").trim();
  if (!allowed.has(value)) throw new RequestValidationError("Unsupported event_name");
  return value;
}

function sanitizeEventId(raw: unknown): string {
  const value = String(raw || "").trim();
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(value)) throw new RequestValidationError("Valid event_id is required");
  return value;
}

function isTestLead(body: any): boolean {
  const value = body?.nvx_is_test_lead ?? body?._meta?.nvx_is_test_lead;
  return value === true || value === 1 || value === "1" || String(value || "").toLowerCase() === "true";
}

function safeCustomData() {
  return {
    source: "nuvanx_server",
    schema_version: "3",
  };
}

async function sendMetaCapi(params: { pixelId: string; accessToken: string; appSecret: string; body: any; req: Request }) {
  const { pixelId, accessToken, appSecret, body, req } = params;
  const eventName = sanitizeEventName(body.event_name || body.eventName);
  const eventId = sanitizeEventId(body.event_id || body.eventId);
  const userData = await buildUserData(body, req);
  if (Object.keys(userData).length === 0) throw new RequestValidationError("No user_data available for CAPI event");

  const event: Record<string, unknown> = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    action_source: "website",
    event_source_url: CANONICAL_EVENT_SOURCE_URL,
    user_data: userData,
    custom_data: safeCustomData(),
  };

  const payload: Record<string, unknown> = { data: [event] };
  if (META_TEST_EVENT_CODE) payload.test_event_code = META_TEST_EVENT_CODE;

  const url = new URL(`${META_GRAPH}/${pixelId}/events`);
  url.searchParams.set("access_token", accessToken);
  const proof = await appsecretProof(accessToken, appSecret);
  if (proof) url.searchParams.set("appsecret_proof", proof);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Meta API failure ${res.status}`);
  return { eventName, eventId };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ success: false, message: "Method not allowed" }, 405);

  const contentLength = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > 16384) {
    return json({ success: false, message: "Payload too large" }, 413);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[web-events] Supabase service configuration missing");
    return json({ success: false, message: "Server configuration error" }, 500);
  }

  if (!(await requireServiceRole(req))) return json({ success: false, message: "Unauthorized" }, 401);

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return json({ success: false, message: "Invalid JSON" }, 400);

    // QA traffic is deliberately suppressed before resolving Meta credentials or building an event.
    if (isTestLead(body)) {
      return json({ success: true, suppressed: true, reason: "qa_lead" }, 200);
    }

    const clinicId = sanitizeClinicId(body.clinic_id || body.clinicId);
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const meta = await resolveOwnerAndMeta(admin, clinicId);
    const result = await sendMetaCapi({ pixelId: meta.pixelId, accessToken: meta.accessToken, appSecret: meta.appSecret, body, req });
    return json({ success: true, eventName: result.eventName, eventId: result.eventId }, 200);
  } catch (error: any) {
    console.error("[web-events] error", error?.message || error);
    const status = error instanceof RequestValidationError ? error.status : 500;
    const message = status >= 500 ? "Internal error" : error?.message || "Invalid request";
    return json({ success: false, message }, status);
  }
});
