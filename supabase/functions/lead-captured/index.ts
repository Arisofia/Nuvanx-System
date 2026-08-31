// NUVANX canonical lead-captured ingestion.
// WordPress signs timestamp.body with a domain-separated HMAC key derived from
// the verified HubSpot private-app token. The raw HubSpot token is never used
// directly as the capture-signing key.
import { createClient } from "jsr:@supabase/supabase-js@2";

declare const Deno: any;
declare const EdgeRuntime: any;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const HUBSPOT_ACCESS_TOKEN_ENV = (Deno.env.get("HUBSPOT_ACCESS_TOKEN") || "").trim();
const CANONICAL_FORM_ID = "5042522a-0bc5-4381-ac3e-5aee8649b69c";
const ALLOWED_ORIGINS = new Set(["https://nuvanx.com", "https://www.nuvanx.com", "https://staging2.nuvanx.com"]);
const SIGNATURE_MAX_SKEW_SECONDS = 300;
const CAPTURE_HMAC_CONTEXT = "nuvanx-lead-capture-hmac-key-v1";

class ValidationError extends Error {
  status: number;
  constructor(message: string, status = 422) {
    super(message);
    this.name = "ValidationError";
    this.status = status;
  }
}

function headers(origin: string | null) {
  const out: Record<string, string> = {
    "Access-Control-Allow-Headers": "content-type,x-nvx-timestamp,x-nvx-signature",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) out["Access-Control-Allow-Origin"] = origin;
  return out;
}

function reply(origin: string | null, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: headers(origin) });
}

function timingSafeHexMatch(received: string, expected: string): boolean {
  const a = String(received || "").trim().toLowerCase();
  const b = String(expected || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(a) || !/^[0-9a-f]{64}$/.test(b)) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function deriveCaptureHmacKey(token: string): Promise<string> {
  return await hmacHex(token, CAPTURE_HMAC_CONTEXT);
}

async function resolveHubspotToken(admin: any): Promise<string> {
  if (HUBSPOT_ACCESS_TOKEN_ENV) return HUBSPOT_ACCESS_TOKEN_ENV;
  const { data, error } = await admin.rpc("nvx_get_runtime_secret", { p_name: "HUBSPOT_ACCESS_TOKEN" });
  if (error || !data) return "";
  return String(data).trim();
}

async function authenticateSignedBody(req: Request, rawBody: string, admin: any): Promise<boolean> {
  const timestampRaw = String(req.headers.get("x-nvx-timestamp") || "").trim();
  const receivedSignature = String(req.headers.get("x-nvx-signature") || "").trim();
  if (!/^\d{10}$/.test(timestampRaw)) return false;
  const timestamp = Number(timestampRaw);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > SIGNATURE_MAX_SKEW_SECONDS) return false;

  const token = await resolveHubspotToken(admin);
  if (!token) throw new ValidationError("Runtime bootstrap required", 503);
  const hmacKey = await deriveCaptureHmacKey(token);
  const expected = await hmacHex(hmacKey, `${timestampRaw}.${rawBody}`);
  return timingSafeHexMatch(receivedSignature, expected);
}

function uuidV4(raw: unknown): string {
  const value = String(raw || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    throw new ValidationError("Valid nvx_lead_id is required");
  }
  return value;
}

function bounded(raw: unknown, max: number): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = String(raw).trim();
  if (!value || value.length > max) throw new ValidationError("Invalid bounded string");
  return value;
}

function emailHash(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = String(raw).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(value)) throw new ValidationError("Invalid email_hash");
  return value;
}

function hubspotContactId(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = String(raw).trim();
  if (!/^[1-9][0-9]{0,18}$/.test(value)) throw new ValidationError("Invalid hubspot_contact_id");
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric)) throw new ValidationError("Invalid hubspot_contact_id");
  return numeric;
}

function booleanValue(raw: unknown): boolean {
  return raw === true || raw === 1 || raw === "1" || String(raw || "").toLowerCase() === "true";
}

const ATTR_KEYS = new Set([
  "source", "medium", "campaign_id", "referrer_domain", "landing_url", "timestamp", "channel",
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  "gclid", "gbraid", "wbraid", "gclsrc",
  "fbclid", "fbc", "fbp",
]);

function cleanMetaIdentity(key: string, raw: string): string | null {
  if (key === "fbclid") {
    return /^[A-Za-z0-9._~:+-]{1,512}$/.test(raw) ? raw : null;
  }
  if (key === "fbc" || key === "fbp") {
    return /^fb\.1\.\d{10,16}\.[A-Za-z0-9._~:+-]{1,512}$/.test(raw) ? raw : null;
  }
  return null;
}

function cleanAttribution(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!ATTR_KEYS.has(key) || value === null || value === undefined || value === "") continue;
    const normalized = String(value).trim();
    if (!normalized) continue;
    if (key === "fbclid" || key === "fbc" || key === "fbp") {
      const metaValue = cleanMetaIdentity(key, normalized);
      if (metaValue) out[key] = metaValue;
      continue;
    }
    out[key] = normalized.slice(0, key === "landing_url" ? 1000 : 512);
  }

  // FBC is a deterministic representation of a real fbclid. Derive it only
  // when a consented touch contains both fbclid evidence and its capture time.
  // FBP is never synthesized; it is accepted only when the browser supplies
  // a real `_fbp` cookie value.
  if (out.fbclid && !out.fbc && out.timestamp) {
    const touchMillis = Date.parse(out.timestamp);
    if (Number.isFinite(touchMillis) && touchMillis > 0) {
      const derived = `fb.1.${Math.trunc(touchMillis)}.${out.fbclid}`;
      const valid = cleanMetaIdentity("fbc", derived);
      if (valid) out.fbc = valid;
    }
  }
  return out;
}

function triggerReconciliation() {
  const url = `${SUPABASE_URL}/functions/v1/web-lead-reconcile`;
  const request = fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ limit: 10 }),
  }).catch((error) => console.error("[lead-captured] reconciliation trigger failed", String(error?.message || "error").slice(0, 160)));
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(request);
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") {
    if (origin && !ALLOWED_ORIGINS.has(origin)) return reply(origin, 403, { success: false, message: "Origin not allowed" });
    return new Response("ok", { headers: headers(origin) });
  }
  if (req.method !== "POST") return reply(origin, 405, { success: false, message: "Method not allowed" });
  if (origin && !ALLOWED_ORIGINS.has(origin)) return reply(origin, 403, { success: false, message: "Origin not allowed" });

  const length = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(length) && length > 32768) return reply(origin, 413, { success: false, message: "Payload too large" });
  if (!SUPABASE_URL || !SERVICE_ROLE) return reply(origin, 500, { success: false, message: "Server configuration error" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  try {
    const rawBody = await req.text();
    if (!(await authenticateSignedBody(req, rawBody, admin))) return reply(origin, 401, { success: false, message: "Unauthorized" });

    let body: any = null;
    try { body = JSON.parse(rawBody); } catch { body = null; }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Invalid JSON", 400);

    const leadId = uuidV4(body.nvx_lead_id);
    const formId = String(body.form_id || "").trim().toLowerCase();
    if (formId !== CANONICAL_FORM_ID) throw new ValidationError("Unsupported form_id");

    const isTest = booleanValue(body.nvx_is_test_lead);
    const testRunId = bounded(body.nvx_test_run_id, 128);
    if (isTest && (!testRunId || !testRunId.startsWith("staging2-"))) {
      throw new ValidationError("Test lead requires server-owned staging2 test_run_id");
    }
    if (!isTest && testRunId) throw new ValidationError("Production lead cannot carry test_run_id");

    // Missing/legacy senders are deliberately fail-closed as false.
    const marketingConsent = booleanValue(body.marketing_consent);

    const row = {
      nvx_lead_id: leadId,
      form_id: formId,
      hubspot_contact_id: hubspotContactId(body.hubspot_contact_id),
      hubspot_submission_id: bounded(body.hubspot_submission_id, 180),
      email_hash: emailHash(body.email_hash),
      is_test_lead: isTest,
      test_run_id: testRunId,
      marketing_consent: marketingConsent,
      first_attribution: marketingConsent ? cleanAttribution(body.first_attribution) : {},
      conversion_attribution: marketingConsent ? cleanAttribution(body.conversion_attribution) : {},
      source: "hubspot_web",
      last_seen_at: new Date().toISOString(),
      metadata: { schema_version: 3, auth: "hubspot_hmac_sha256", attribution_contract: "attribution_identity_v1" },
    };

    const { data, error } = await admin
      .from("web_lead_captures")
      .upsert(row, { onConflict: "nvx_lead_id" })
      .select("id,nvx_lead_id,is_test_lead,marketing_consent,applied_lead_id,captured_at,last_seen_at,reconciliation_status")
      .single();

    if (error) throw new Error(error.message);
    triggerReconciliation();
    return reply(origin, 200, { success: true, capture: data });
  } catch (error: any) {
    console.error("[lead-captured] error", String(error?.message || "error").slice(0, 200));
    const status = error instanceof ValidationError ? error.status : 500;
    return reply(origin, status, { success: false, message: status >= 500 ? (status === 503 ? "Runtime bootstrap required" : "Internal error") : error?.message || "Invalid request" });
  }
});