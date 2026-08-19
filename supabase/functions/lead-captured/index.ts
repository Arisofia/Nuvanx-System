// NUVANX canonical lead-captured ingestion.
// Authenticated server-to-server only. Persists lineage; produces no Deal/CAPI/Google side effects.
import { createClient } from "jsr:@supabase/supabase-js@2";

declare const Deno: any;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SHARED_SECRET = (Deno.env.get("NUVANX_LEAD_CAPTURE_SECRET") || "").trim();
const CANONICAL_FORM_ID = "5042522a-0bc5-4381-ac3e-5aee8649b69c";
const ALLOWED_ORIGINS = new Set(["https://nuvanx.com", "https://www.nuvanx.com", "https://staging2.nuvanx.com"]);

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
    "Access-Control-Allow-Headers": "content-type,x-nvx-lead-capture-secret",
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

async function sha256(raw: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)));
}

async function secretMatches(received: string, expected: string): Promise<boolean> {
  if (!received || !expected) return false;
  const a = await sha256(received);
  const b = await sha256(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
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
]);

function cleanAttribution(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!ATTR_KEYS.has(key) || value === null || value === undefined || value === "") continue;
    const normalized = String(value).trim();
    if (!normalized) continue;
    out[key] = normalized.slice(0, key === "landing_url" ? 1000 : 512);
  }
  return out;
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

  if (!SHARED_SECRET || !SUPABASE_URL || !SERVICE_ROLE) {
    console.error("[lead-captured] required runtime configuration missing");
    return reply(origin, 500, { success: false, message: "Server configuration error" });
  }
  const receivedSecret = req.headers.get("x-nvx-lead-capture-secret") || "";
  if (!(await secretMatches(receivedSecret, SHARED_SECRET))) return reply(origin, 401, { success: false, message: "Unauthorized" });

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ValidationError("Invalid JSON", 400);

    const leadId = uuidV4((body as any).nvx_lead_id);
    const formId = String((body as any).form_id || "").trim().toLowerCase();
    if (formId !== CANONICAL_FORM_ID) throw new ValidationError("Unsupported form_id");

    const isTest = booleanValue((body as any).nvx_is_test_lead);
    const testRunId = bounded((body as any).nvx_test_run_id, 128);
    if (isTest && (!testRunId || !testRunId.startsWith("staging2-"))) {
      throw new ValidationError("Test lead requires server-owned staging2 test_run_id");
    }
    if (!isTest && testRunId) throw new ValidationError("Production lead cannot carry test_run_id");

    // Missing/legacy senders are deliberately fail-closed as false.
    const marketingConsent = booleanValue((body as any).marketing_consent);

    const row = {
      nvx_lead_id: leadId,
      form_id: formId,
      hubspot_contact_id: hubspotContactId((body as any).hubspot_contact_id),
      hubspot_submission_id: bounded((body as any).hubspot_submission_id, 180),
      email_hash: emailHash((body as any).email_hash),
      is_test_lead: isTest,
      test_run_id: testRunId,
      marketing_consent: marketingConsent,
      first_attribution: cleanAttribution((body as any).first_attribution),
      conversion_attribution: cleanAttribution((body as any).conversion_attribution),
      source: "hubspot_web",
      last_seen_at: new Date().toISOString(),
      metadata: { schema_version: 2 },
    };

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const { data, error } = await admin
      .from("web_lead_captures")
      .upsert(row, { onConflict: "nvx_lead_id" })
      .select("id,nvx_lead_id,is_test_lead,marketing_consent,applied_lead_id,captured_at,last_seen_at")
      .single();

    if (error) throw new Error(error.message);
    return reply(origin, 200, { success: true, capture: data });
  } catch (error: any) {
    console.error("[lead-captured] error", error?.message || error);
    const status = error instanceof ValidationError ? error.status : 500;
    return reply(origin, status, { success: false, message: status >= 500 ? "Internal error" : error?.message || "Invalid request" });
  }
});
