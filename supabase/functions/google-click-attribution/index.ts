import { createClient } from "jsr:@supabase/supabase-js@2";

declare const Deno: any;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const HUBSPOT_ACCESS_TOKEN = Deno.env.get("HUBSPOT_ACCESS_TOKEN") || "";
const FORM_ID = "5042522a-0bc5-4381-ac3e-5aee8649b69c";
const STAGING_ORIGIN = "https://staging2.nuvanx.com";
const HMAC_CONTEXT = "nuvanx-google-click-attribution-hmac-key-v1";
const MAX_SIGNATURE_SKEW_SECONDS = 300;
const ALLOWED_ORIGINS = new Set([
  "https://nuvanx.com",
  "https://www.nuvanx.com",
  STAGING_ORIGIN,
]);
const ALLOWED_LANDING_HOSTS = new Set([
  "nuvanx.com",
  "www.nuvanx.com",
  "staging2.nuvanx.com",
]);

function headers(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "content-type,x-nvx-timestamp,x-nvx-signature",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}

function reply(origin: string, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: headers(origin) });
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(keyText: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(keyText),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return bytesToHex(new Uint8Array(signature));
}

function timingSafeHexEqual(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)) return false;
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function authenticateRelay(req: Request, rawBody: string): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  if (!HUBSPOT_ACCESS_TOKEN) {
    console.error("[google-click-attribution] missing HMAC signing credential");
    return { ok: false, status: 503, message: "Authentication unavailable" };
  }

  const timestampRaw = (req.headers.get("x-nvx-timestamp") || "").trim();
  const signature = (req.headers.get("x-nvx-signature") || "").trim().toLowerCase();
  if (!/^\d{10}$/.test(timestampRaw) || !/^[0-9a-f]{64}$/.test(signature)) {
    return { ok: false, status: 401, message: "Missing or invalid authentication" };
  }

  const timestamp = Number(timestampRaw);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > MAX_SIGNATURE_SKEW_SECONDS) {
    return { ok: false, status: 403, message: "Stale authentication" };
  }

  // Match the WordPress sender exactly:
  // 1) HMAC-SHA256(context, HUBSPOT_ACCESS_TOKEN) -> lowercase hex string.
  // 2) HMAC-SHA256(`${timestamp}.${rawBody}`, derived hex string) -> signature.
  const derivedKey = await hmacHex(HUBSPOT_ACCESS_TOKEN, HMAC_CONTEXT);
  const expected = await hmacHex(derivedKey, `${timestampRaw}.${rawBody}`);
  if (!timingSafeHexEqual(expected, signature)) {
    return { ok: false, status: 403, message: "Invalid authentication" };
  }

  return { ok: true };
}

function cleanClickId(value: unknown, max = 512): string | null {
  if (value === null || value === undefined || value === "") return null;
  const v = String(value).trim();
  if (!v || v.length > max) return null;
  if (!/^[A-Za-z0-9._~:+-]+$/.test(v)) return null;
  return v;
}

function cleanUuidV4(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const v = String(value).trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v) ? v : null;
}

function cleanLanding(value: unknown): string | null {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:" || !ALLOWED_LANDING_HOSTS.has(url.hostname.toLowerCase())) return null;
    return `${url.origin}${url.pathname}`.slice(0, 1000);
  } catch {
    return null;
  }
}

function qaContext(origin: string, rawTestRunId: unknown) {
  const isTestLead = origin === STAGING_ORIGIN;
  if (!isTestLead) return { is_test_lead: false, test_run_id: null };
  const candidate = String(rawTestRunId || "").trim();
  const testRunId = /^staging2-sha-[A-Za-z0-9._:-]{4,80}$/.test(candidate) ? candidate : "staging2-origin";
  return { is_test_lead: true, test_run_id: testRunId };
}

async function attachLineageIfMissing(
  admin: any,
  rowId: string,
  existingLeadId: string | null,
  nvxLeadId: string | null,
  qa: { is_test_lead: boolean; test_run_id: string | null },
) {
  const updates: Record<string, unknown> = {};
  if (nvxLeadId && !existingLeadId) updates.nvx_lead_id = nvxLeadId;
  if (qa.is_test_lead) {
    updates.is_test_lead = true;
    updates.test_run_id = qa.test_run_id;
  }
  if (Object.keys(updates).length === 0) return false;

  let query = admin.from("google_click_attributions").update(updates).eq("id", rowId);
  if (updates.nvx_lead_id) query = query.is("nvx_lead_id", null);
  const { error } = await query;
  if (error) {
    console.error("[google-click-attribution] lineage/qa update failed", error.message);
    return false;
  }
  return true;
}

async function findDedupeRow(admin: any, params: {
  emailHash: string;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
}) {
  let query = admin
    .from("google_click_attributions")
    .select("id,nvx_lead_id,is_test_lead,test_run_id")
    .eq("email_hash", params.emailHash)
    .eq("form_id", FORM_ID);

  query = params.gclid ? query.eq("gclid", params.gclid) : query.is("gclid", null);
  query = params.gbraid ? query.eq("gbraid", params.gbraid) : query.is("gbraid", null);
  query = params.wbraid ? query.eq("wbraid", params.wbraid) : query.is("wbraid", null);

  return await query.limit(1).maybeSingle();
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin") || "";
  if (!ALLOWED_ORIGINS.has(origin)) {
    return new Response(JSON.stringify({ success: false, message: "Origin not allowed" }), {
      status: 403,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(origin) });
  if (req.method !== "POST") return reply(origin, 405, { success: false, message: "Method not allowed" });

  const length = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(length) && length > 8192) {
    return reply(origin, 413, { success: false, message: "Payload too large" });
  }

  const rawBody = await req.text();
  if (new TextEncoder().encode(rawBody).byteLength > 8192) {
    return reply(origin, 413, { success: false, message: "Payload too large" });
  }

  // Authentication is intentionally completed before JSON parsing, service-role
  // client creation, or any database access. Origin remains defense-in-depth.
  const authentication = await authenticateRelay(req, rawBody);
  if (!authentication.ok) {
    return reply(origin, authentication.status, { success: false, message: authentication.message });
  }

  if (!SUPABASE_URL || !SERVICE_ROLE) {
    console.error("[google-click-attribution] missing Supabase runtime config");
    return reply(origin, 500, { success: false, message: "Server configuration error" });
  }

  let body: unknown = null;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return reply(origin, 400, { success: false, message: "Invalid JSON" });
  }
  if (!body || typeof body !== "object") return reply(origin, 400, { success: false, message: "Invalid JSON" });

  const emailHash = String((body as any).email_hash || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(emailHash)) {
    return reply(origin, 400, { success: false, message: "Invalid email hash" });
  }

  const formId = String((body as any).form_id || "").trim();
  if (formId !== FORM_ID) return reply(origin, 400, { success: false, message: "Unsupported form" });

  const rawSubmissionId = (body as any).submission_id;
  const submissionId = cleanUuidV4(rawSubmissionId);
  if (rawSubmissionId !== undefined && rawSubmissionId !== null && rawSubmissionId !== "" && !submissionId) {
    return reply(origin, 400, { success: false, message: "Invalid submission id" });
  }

  const rawNvxLeadId = (body as any).nvx_lead_id;
  const nvxLeadId = cleanUuidV4(rawNvxLeadId);
  if (rawNvxLeadId !== undefined && rawNvxLeadId !== null && rawNvxLeadId !== "" && !nvxLeadId) {
    return reply(origin, 400, { success: false, message: "Invalid NUVANX lead id" });
  }

  const gclid = cleanClickId((body as any).gclid);
  const gbraid = cleanClickId((body as any).gbraid);
  const wbraid = cleanClickId((body as any).wbraid);
  const gclsrc = cleanClickId((body as any).gclsrc, 128);
  if (!gclid && !gbraid && !wbraid) {
    return reply(origin, 400, { success: false, message: "No Google click identifier" });
  }

  const landingUrl = cleanLanding((body as any).landing_url);
  const qa = qaContext(origin, (body as any).nvx_test_run_id);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  if (submissionId) {
    const { data: duplicateRow, error: duplicateError } = await admin
      .from("google_click_attributions")
      .select("id,nvx_lead_id,is_test_lead,test_run_id")
      .eq("submission_id", submissionId)
      .limit(1)
      .maybeSingle();

    if (duplicateError) {
      console.error("[google-click-attribution] idempotency query failed", duplicateError.message);
      return reply(origin, 500, { success: false, message: "Server error" });
    }
    if (duplicateRow) {
      const updated = await attachLineageIfMissing(admin, duplicateRow.id, duplicateRow.nvx_lead_id, nvxLeadId, qa);
      return reply(origin, 200, {
        success: true,
        stored: false,
        duplicate: true,
        lineage_stored: updated || Boolean(duplicateRow.nvx_lead_id),
        qa_suppressed: qa.is_test_lead,
      });
    }
  }

  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count, error: countError } = await admin
    .from("google_click_attributions")
    .select("id", { count: "exact", head: true })
    .eq("email_hash", emailHash)
    .gte("captured_at", since);

  if (countError) {
    console.error("[google-click-attribution] rate query failed", countError.message);
    return reply(origin, 500, { success: false, message: "Server error" });
  }
  if ((count || 0) >= 5) return reply(origin, 429, { success: false, message: "Rate limit" });

  const { error } = await admin.from("google_click_attributions").insert({
    submission_id: submissionId,
    nvx_lead_id: nvxLeadId,
    email_hash: emailHash,
    gclid,
    gbraid,
    wbraid,
    gclsrc,
    form_id: FORM_ID,
    landing_url: landingUrl,
    source: "hubspot_web",
    is_test_lead: qa.is_test_lead,
    test_run_id: qa.test_run_id,
    reconciliation_status: qa.is_test_lead ? "qa_suppressed" : "pending",
  });

  if (error) {
    if (error.code === "23505") {
      const { data: existingRow, error: lookupError } = await findDedupeRow(admin, { emailHash, gclid, gbraid, wbraid });
      if (lookupError) {
        console.error("[google-click-attribution] duplicate lookup failed", lookupError.message);
      }
      const updated = existingRow
        ? await attachLineageIfMissing(admin, existingRow.id, existingRow.nvx_lead_id, nvxLeadId, qa)
        : false;
      return reply(origin, 200, {
        success: true,
        stored: false,
        duplicate: true,
        lineage_stored: updated || Boolean(existingRow?.nvx_lead_id),
        qa_suppressed: qa.is_test_lead,
      });
    }
    console.error("[google-click-attribution] insert failed", error.message);
    return reply(origin, 500, { success: false, message: "Server error" });
  }

  return reply(origin, 200, {
    success: true,
    stored: true,
    lineage_stored: Boolean(nvxLeadId),
    qa_suppressed: qa.is_test_lead,
  });
});
