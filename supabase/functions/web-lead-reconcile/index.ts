import { createClient } from "jsr:@supabase/supabase-js@2";

declare const Deno: any;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const HUBSPOT_ACCESS_TOKEN_ENV = Deno.env.get("HUBSPOT_ACCESS_TOKEN") || "";
const SYSTEM_USER_EMAIL = (Deno.env.get("DEFAULT_LANDING_USER_EMAIL") || "sistema@nuvanx.internal").trim().toLowerCase();
const HUBSPOT_SEARCH_URL = "https://api.hubapi.com/crm/objects/2026-03/contacts/search";
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function cleanUuidV4(value: unknown): string | null {
  const v = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v) ? v : null;
}

function cleanText(value: unknown, max = 1000): string | null {
  const v = String(value || "").trim();
  if (!v) return null;
  return v.slice(0, max);
}

function isTruthy(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || String(value || "").toLowerCase() === "true";
}

async function sha256Bytes(raw: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)));
}

async function sha256Hex(raw: string): Promise<string> {
  const digest = await sha256Bytes(raw.trim().toLowerCase());
  return Array.from(digest).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function secretMatches(received: string, expected: string): Promise<boolean> {
  if (!received || !expected) return false;
  const a = await sha256Bytes(received);
  const b = await sha256Bytes(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function requireServiceRole(req: Request): Promise<boolean> {
  const auth = String(req.headers.get("Authorization") || "").trim();
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? await secretMatches(match[1], SERVICE_ROLE) : false;
}

async function resolveHubspotToken(admin: any): Promise<string> {
  if (HUBSPOT_ACCESS_TOKEN_ENV.trim()) return HUBSPOT_ACCESS_TOKEN_ENV.trim();
  const { data, error } = await admin.rpc("nvx_get_runtime_secret", { p_name: "HUBSPOT_ACCESS_TOKEN" });
  if (error || !data) throw new Error("HubSpot runtime credential unavailable");
  return String(data).trim();
}

async function hubSpotContactByLeadId(token: string, nvxLeadId: string) {
  const properties = [
    "nvx_lead_id",
    "nvx_is_test_lead",
    "nvx_test_run_id",
    "email",
    "phone",
    "hubspot_owner_id",
    "nvx_utm_source",
    "nvx_utm_medium",
    "nvx_utm_campaign",
    "nvx_utm_content",
    "nvx_utm_term",
    "nvx_first_source",
    "nvx_first_medium",
    "nvx_first_campaign_id",
    "nvx_first_landing_url",
    "nvx_first_timestamp",
    "nvx_first_channel",
    "nvx_conversion_channel",
    "nvx_conversion_source",
    "nvx_conversion_medium",
    "nvx_conversion_campaign_id",
    "nvx_conversion_landing_url",
    "nvx_conversion_timestamp",
  ];
  const response = await fetch(HUBSPOT_SEARCH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: "nvx_lead_id", operator: "EQ", value: nvxLeadId }] }],
      properties,
      limit: 2,
      after: "0",
      sorts: [],
    }),
  });
  if (!response.ok) throw new Error(`HubSpot search failed ${response.status}`);
  const payload = await response.json();
  const results = Array.isArray(payload?.results) ? payload.results : [];
  if (results.length !== 1) throw new Error(`Expected one HubSpot contact, found ${results.length}`);
  return results[0];
}

async function resolveSystemUser(admin: any) {
  const { data, error } = await admin
    .from("users")
    .select("id,clinic_id")
    .eq("email", SYSTEM_USER_EMAIL)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("System user lookup failed");
  if (!data?.id) throw new Error("System user not configured");
  return data;
}

async function normalizedPhoneHash(admin: any, rawPhone: unknown): Promise<string | null> {
  const phone = cleanText(rawPhone, 80);
  if (!phone) return null;
  const { data, error } = await admin.rpc("normalize_phone", { raw_phone: phone });
  if (error || !data) return null;
  return await sha256Hex(String(data));
}

function attrValue(capture: any, key: string): string | null {
  const conversion = capture?.conversion_attribution && typeof capture.conversion_attribution === "object" ? capture.conversion_attribution : {};
  const first = capture?.first_attribution && typeof capture.first_attribution === "object" ? capture.first_attribution : {};
  return cleanText(conversion[key] ?? first[key], key === "landing_url" ? 1000 : 512);
}

async function markCapture(admin: any, id: string, patch: Record<string, unknown>) {
  const { error } = await admin
    .from("web_lead_captures")
    .update({ ...patch, last_reconciliation_attempt_at: new Date().toISOString(), last_seen_at: new Date().toISOString() })
    .eq("id", id)
    .is("applied_lead_id", null);
  if (error) throw new Error("Capture state update failed");
}

async function suppressGoogleLineage(admin: any, nvxLeadId: string, testRunId: string | null) {
  const { error } = await admin
    .from("google_click_attributions")
    .update({
      is_test_lead: true,
      test_run_id: testRunId,
      reconciliation_status: "qa_suppressed",
      reconciliation_error: null,
      last_reconciliation_attempt_at: new Date().toISOString(),
    })
    .eq("nvx_lead_id", nvxLeadId)
    .is("applied_lead_id", null);
  if (error) throw new Error("Google QA suppression failed");
}

async function googleAttributionForLead(admin: any, nvxLeadId: string) {
  const { data, error } = await admin
    .from("google_click_attributions")
    .select("gclid,gbraid,wbraid,gclsrc,landing_url,email_hash,form_id,captured_at,is_test_lead")
    .eq("nvx_lead_id", nvxLeadId)
    .eq("is_test_lead", false)
    .order("captured_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("Google attribution lookup failed");
  return data || null;
}

async function finalizeReconciliation(admin: any, captureId: string, leadId: string, hubspotContactId: string, ownerId: string | null) {
  const { error } = await admin.rpc("finalize_web_capture_reconciliation", {
    p_capture_id: captureId,
    p_lead_id: leadId,
    p_hubspot_contact_id: Number(hubspotContactId),
    p_owner_id: ownerId,
  });
  if (error) throw new Error("Atomic capture reconciliation finalization failed");
}

async function reconcileOne(admin: any, systemUser: any, hubspotToken: string, capture: any) {
  const nvxLeadId = cleanUuidV4(capture.nvx_lead_id);
  if (!nvxLeadId) return { id: capture.id, outcome: "skipped_missing_lineage" };

  if (capture.is_test_lead === true) {
    const testRunId = cleanText(capture.test_run_id, 128);
    await markCapture(admin, capture.id, {
      reconciliation_status: "qa_suppressed",
      reconciliation_error: null,
    });
    await suppressGoogleLineage(admin, nvxLeadId, testRunId);
    return { id: capture.id, outcome: "qa_suppressed" };
  }

  try {
    const contact = await hubSpotContactByLeadId(hubspotToken, nvxLeadId);
    const props = contact?.properties || {};
    if (cleanUuidV4(props.nvx_lead_id) !== nvxLeadId) throw new Error("HubSpot lineage mismatch");
    if (isTruthy(props.nvx_is_test_lead)) {
      const testRunId = cleanText(props.nvx_test_run_id, 128);
      await markCapture(admin, capture.id, {
        is_test_lead: true,
        test_run_id: testRunId,
        reconciliation_status: "qa_suppressed",
        reconciliation_error: null,
      });
      await suppressGoogleLineage(admin, nvxLeadId, testRunId);
      return { id: capture.id, outcome: "qa_suppressed_hubspot" };
    }

    const hubspotContactId = String(contact.id || "").trim();
    if (!/^\d+$/.test(hubspotContactId)) throw new Error("Invalid HubSpot contact id");
    if (capture.hubspot_contact_id && String(capture.hubspot_contact_id) !== hubspotContactId) {
      throw new Error("HubSpot contact id mismatch");
    }

    const expectedEmailHash = String(capture.email_hash || "").toLowerCase();
    const email = String(props.email || "").trim().toLowerCase();
    if (expectedEmailHash) {
      if (!email) throw new Error("HubSpot contact email missing");
      if ((await sha256Hex(email)) !== expectedEmailHash) throw new Error("HubSpot email hash mismatch");
    }

    const phoneHash = await normalizedPhoneHash(admin, props.phone);
    const google = await googleAttributionForLead(admin, nvxLeadId);
    if (google?.email_hash && expectedEmailHash && String(google.email_hash).toLowerCase() !== expectedEmailHash) {
      throw new Error("Google attribution email hash mismatch");
    }

    const leadPayload: Record<string, unknown> = {
      user_id: systemUser.id,
      clinic_id: systemUser.clinic_id || null,
      source: "website_hubspot",
      stage: "lead",
      external_id: `website:${nvxLeadId}`,
      nvx_lead_id: nvxLeadId,
      hubspot_contact_id: hubspotContactId,
      email_hash: expectedEmailHash || google?.email_hash || null,
      telefono_hash: phoneHash,
      gclid: attrValue(capture, "gclid") || google?.gclid || null,
      landing_url: attrValue(capture, "landing_url") || google?.landing_url || null,
      utm_source: cleanText(props.nvx_utm_source, 255) || attrValue(capture, "utm_source"),
      utm_medium: cleanText(props.nvx_utm_medium, 255) || attrValue(capture, "utm_medium"),
      utm_campaign: cleanText(props.nvx_utm_campaign, 255) || attrValue(capture, "utm_campaign"),
      utm_content: cleanText(props.nvx_utm_content, 255) || attrValue(capture, "utm_content"),
      utm_term: cleanText(props.nvx_utm_term, 255) || attrValue(capture, "utm_term"),
      form_id: capture.form_id,
      form_name: "Valoracion web",
      created_at: capture.captured_at,
      updated_at: new Date().toISOString(),
    };

    let { data: lead, error: leadLookupError } = await admin
      .from("leads")
      .select("id,source,hubspot_contact_id")
      .eq("nvx_lead_id", nvxLeadId)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    if (leadLookupError) throw new Error("Lead lookup failed");

    if (!lead) {
      const inserted = await admin.from("leads").insert(leadPayload).select("id,source,hubspot_contact_id").single();
      if (inserted.error) {
        if (inserted.error.code !== "23505") throw new Error("Web lead insert failed");
        const retry = await admin
          .from("leads")
          .select("id,source,hubspot_contact_id")
          .eq("nvx_lead_id", nvxLeadId)
          .is("deleted_at", null)
          .limit(1)
          .maybeSingle();
        if (retry.error || !retry.data) throw new Error("Web lead race resolution failed");
        lead = retry.data;
      } else {
        lead = inserted.data;
      }
    }

    if (lead.source !== "website_hubspot") throw new Error("Lineage already belongs to a different lead source");
    if (!lead.hubspot_contact_id) {
      const linked = await admin
        .from("leads")
        .update({ hubspot_contact_id: hubspotContactId, updated_at: new Date().toISOString() })
        .eq("id", lead.id)
        .is("hubspot_contact_id", null)
        .select("id,source,hubspot_contact_id")
        .single();
      if (linked.error) throw new Error("Lead contact link failed");
      lead = linked.data;
    }
    if (String(lead.hubspot_contact_id || "") !== hubspotContactId) {
      throw new Error("HubSpot contact already mapped to different lead episode");
    }

    await finalizeReconciliation(
      admin,
      capture.id,
      lead.id,
      hubspotContactId,
      cleanText(props.hubspot_owner_id, 80),
    );

    return { id: capture.id, lead_id: lead.id, google_attribution: Boolean(google), outcome: "reconciled" };
  } catch (error: any) {
    const message = String(error?.message || "Reconciliation failed").slice(0, 240);
    const conflict = /mismatch|different lead|different lead source|conflict/i.test(message);
    await markCapture(admin, capture.id, {
      reconciliation_status: conflict ? "conflict" : "failed",
      reconciliation_error: message,
    });
    return { id: capture.id, outcome: conflict ? "conflict" : "failed", error: message };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ success: false, message: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ success: false, message: "Server configuration error" }, 500);
  if (!(await requireServiceRole(req))) return json({ success: false, message: "Forbidden" }, 403);

  const body = await req.json().catch(() => ({}));
  const requestedLimit = Number(body?.limit || DEFAULT_LIMIT);
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number.isFinite(requestedLimit) ? Math.trunc(requestedLimit) : DEFAULT_LIMIT));
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  try {
    const [systemUser, hubspotToken] = await Promise.all([
      resolveSystemUser(admin),
      resolveHubspotToken(admin),
    ]);
    const { data: rows, error } = await admin
      .from("web_lead_captures")
      .select("id,nvx_lead_id,form_id,hubspot_contact_id,email_hash,is_test_lead,test_run_id,first_attribution,conversion_attribution,captured_at,reconciliation_status,applied_lead_id")
      .is("applied_lead_id", null)
      .in("reconciliation_status", ["pending", "failed", "qa_suppressed"])
      .order("captured_at", { ascending: true })
      .limit(limit);
    if (error) throw new Error("Pending capture query failed");

    const results = [];
    for (const row of rows || []) results.push(await reconcileOne(admin, systemUser, hubspotToken, row));

    return json({
      success: true,
      processed: results.length,
      reconciled: results.filter((r: any) => r.outcome === "reconciled").length,
      suppressed: results.filter((r: any) => String(r.outcome).startsWith("qa_suppressed")).length,
      conflicts: results.filter((r: any) => r.outcome === "conflict").length,
      failed: results.filter((r: any) => r.outcome === "failed").length,
      results,
    });
  } catch (error: any) {
    console.error("[web-lead-reconcile]", error?.message || error);
    return json({ success: false, message: "Internal error" }, 500);
  }
});
