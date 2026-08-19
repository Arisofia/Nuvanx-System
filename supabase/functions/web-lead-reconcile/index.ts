import { createClient } from "jsr:@supabase/supabase-js@2";

declare const Deno: any;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const HUBSPOT_ACCESS_TOKEN = Deno.env.get("HUBSPOT_ACCESS_TOKEN") || "";
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

async function sha256Hex(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw.trim().toLowerCase()));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hubSpotContactByLeadId(nvxLeadId: string) {
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
      Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
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

async function markAttribution(admin: any, id: string, patch: Record<string, unknown>) {
  const { error } = await admin
    .from("google_click_attributions")
    .update({ ...patch, last_reconciliation_attempt_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error("Attribution state update failed");
}

async function reconcileOne(admin: any, systemUser: any, attribution: any) {
  const nvxLeadId = cleanUuidV4(attribution.nvx_lead_id);
  if (!nvxLeadId) return { id: attribution.id, outcome: "skipped_missing_lineage" };

  if (attribution.is_test_lead === true) {
    await markAttribution(admin, attribution.id, {
      reconciliation_status: "qa_suppressed",
      reconciliation_error: null,
    });
    return { id: attribution.id, outcome: "qa_suppressed" };
  }

  try {
    const contact = await hubSpotContactByLeadId(nvxLeadId);
    const props = contact?.properties || {};
    if (cleanUuidV4(props.nvx_lead_id) !== nvxLeadId) throw new Error("HubSpot lineage mismatch");
    if (isTruthy(props.nvx_is_test_lead)) {
      await markAttribution(admin, attribution.id, {
        is_test_lead: true,
        test_run_id: cleanText(props.nvx_test_run_id, 100),
        reconciliation_status: "qa_suppressed",
        reconciliation_error: null,
      });
      return { id: attribution.id, outcome: "qa_suppressed_hubspot" };
    }

    const email = String(props.email || "").trim().toLowerCase();
    if (!email) throw new Error("HubSpot contact email missing");
    if ((await sha256Hex(email)) !== String(attribution.email_hash || "").toLowerCase()) {
      throw new Error("HubSpot email hash mismatch");
    }

    const hubspotContactId = String(contact.id || "").trim();
    if (!/^\d+$/.test(hubspotContactId)) throw new Error("Invalid HubSpot contact id");
    const phoneHash = await normalizedPhoneHash(admin, props.phone);

    const leadPayload: Record<string, unknown> = {
      user_id: systemUser.id,
      clinic_id: systemUser.clinic_id || null,
      source: "website_hubspot",
      stage: "lead",
      external_id: `website:${nvxLeadId}`,
      nvx_lead_id: nvxLeadId,
      hubspot_contact_id: hubspotContactId,
      email_hash: attribution.email_hash,
      telefono_hash: phoneHash,
      gclid: attribution.gclid,
      landing_url: attribution.landing_url,
      utm_source: cleanText(props.nvx_utm_source, 255),
      utm_medium: cleanText(props.nvx_utm_medium, 255),
      utm_campaign: cleanText(props.nvx_utm_campaign, 255),
      utm_content: cleanText(props.nvx_utm_content, 255),
      utm_term: cleanText(props.nvx_utm_term, 255),
      form_id: attribution.form_id,
      form_name: "Valoracion web",
      created_at: attribution.captured_at,
      updated_at: new Date().toISOString(),
    };

    let { data: lead, error: leadLookupError } = await admin
      .from("leads")
      .select("id,hubspot_contact_id")
      .eq("nvx_lead_id", nvxLeadId)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    if (leadLookupError) throw new Error("Lead lookup failed");

    if (!lead) {
      const inserted = await admin.from("leads").insert(leadPayload).select("id,hubspot_contact_id").single();
      if (inserted.error) {
        if (inserted.error.code !== "23505") throw new Error("Web lead insert failed");
        const retry = await admin
          .from("leads")
          .select("id,hubspot_contact_id")
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

    if (String(lead.hubspot_contact_id || "") !== hubspotContactId) {
      throw new Error("HubSpot contact already mapped to different lead episode");
    }

    const { error: attributionUpdateError } = await admin
      .from("google_click_attributions")
      .update({
        applied_lead_id: lead.id,
        applied_at: new Date().toISOString(),
        reconciliation_status: "reconciled",
        reconciliation_error: null,
        reconciled_at: new Date().toISOString(),
        last_reconciliation_attempt_at: new Date().toISOString(),
      })
      .eq("id", attribution.id)
      .is("applied_lead_id", null);
    if (attributionUpdateError) throw new Error("Attribution FK update failed");

    const { error: projectionError } = await admin.from("hubspot_deal_projections").upsert({
      lead_id: lead.id,
      hubspot_contact_id: hubspotContactId,
      owner_id: cleanText(props.hubspot_owner_id, 80),
      pipeline_id: "3707782370",
      stage_id: "5159669951",
      currency_code: "EUR",
      projection_status: "pending",
      updated_at: new Date().toISOString(),
    }, { onConflict: "lead_id", ignoreDuplicates: true });
    if (projectionError) throw new Error("Deal projection queue failed");

    const { error: queueError } = await admin.rpc("queue_google_data_manager_event", {
      p_lead_id: lead.id,
      p_event_name: "lead",
      p_event_timestamp: attribution.captured_at,
      p_conversion_value: null,
      p_transaction_id: `lead:${lead.id}`,
    });
    if (queueError) throw new Error("Google event queue failed");

    return { id: attribution.id, lead_id: lead.id, outcome: "reconciled" };
  } catch (error: any) {
    const message = String(error?.message || "Reconciliation failed").slice(0, 240);
    await markAttribution(admin, attribution.id, {
      reconciliation_status: "failed",
      reconciliation_error: message,
    });
    return { id: attribution.id, outcome: "failed", error: message };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ success: false, message: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE || !HUBSPOT_ACCESS_TOKEN) {
    return json({ success: false, message: "Server configuration error" }, 500);
  }

  const body = await req.json().catch(() => ({}));
  const requestedLimit = Number(body?.limit || DEFAULT_LIMIT);
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number.isFinite(requestedLimit) ? Math.trunc(requestedLimit) : DEFAULT_LIMIT));
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  try {
    const systemUser = await resolveSystemUser(admin);
    const { data: rows, error } = await admin
      .from("google_click_attributions")
      .select("id,nvx_lead_id,email_hash,gclid,gbraid,wbraid,gclsrc,form_id,landing_url,captured_at,is_test_lead,test_run_id,reconciliation_status,applied_lead_id")
      .not("nvx_lead_id", "is", null)
      .is("applied_lead_id", null)
      .in("reconciliation_status", ["pending", "failed", "qa_suppressed"])
      .order("captured_at", { ascending: true })
      .limit(limit);
    if (error) throw new Error("Pending attribution query failed");

    const results = [];
    for (const row of rows || []) results.push(await reconcileOne(admin, systemUser, row));

    return json({
      success: true,
      processed: results.length,
      reconciled: results.filter((r: any) => r.outcome === "reconciled").length,
      suppressed: results.filter((r: any) => String(r.outcome).startsWith("qa_suppressed")).length,
      failed: results.filter((r: any) => r.outcome === "failed").length,
      results,
    });
  } catch (error: any) {
    console.error("[web-lead-reconcile]", error?.message || error);
    return json({ success: false, message: "Internal error" }, 500);
  }
});
