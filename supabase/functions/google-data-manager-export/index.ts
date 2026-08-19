import { createClient } from "jsr:@supabase/supabase-js@2";

declare const Deno: any;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const OAUTH_CLIENT_ID = Deno.env.get("GOOGLE_DATA_MANAGER_CLIENT_ID") || "";
const OAUTH_CLIENT_SECRET = Deno.env.get("GOOGLE_DATA_MANAGER_CLIENT_SECRET") || "";
const OAUTH_REFRESH_TOKEN = Deno.env.get("GOOGLE_DATA_MANAGER_REFRESH_TOKEN") || "";
const CLOUD_PROJECT_ID = Deno.env.get("GOOGLE_DATA_MANAGER_PROJECT_ID") || "";
const CUSTOMER_ID_ENV = Deno.env.get("GOOGLE_DATA_MANAGER_CUSTOMER_ID") || "";
const LOGIN_CUSTOMER_ID = Deno.env.get("GOOGLE_DATA_MANAGER_LOGIN_CUSTOMER_ID") || "";
const ACTIONS_JSON = Deno.env.get("GOOGLE_DATA_MANAGER_CONVERSION_ACTIONS_JSON") || "";
const DATA_MANAGER_SCOPE = "https://www.googleapis.com/auth/datamanager";
const INGEST_URL = "https://datamanager.googleapis.com/v1/events:ingest";
const STATUS_URL = "https://datamanager.googleapis.com/v1/requestStatus:retrieve";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function digits(value: unknown): string {
  return String(value || "").replace(/\D/g, "");
}

function cleanActionMap(): Record<string, string> {
  try {
    const parsed = JSON.parse(ACTIONS_JSON || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([key, value]) => {
      const id = digits(value);
      return key && id ? [[String(key), id]] : [];
    }));
  } catch {
    return {};
  }
}

function safeProviderDiagnostics(result: any) {
  if (!result || typeof result !== "object") return null;
  const diagnostics: Record<string, unknown> = {};
  if (result.error && typeof result.error === "object") {
    diagnostics.error = {
      code: result.error.code ?? null,
      status: result.error.status ?? null,
      message: String(result.error.message || "").slice(0, 500) || null,
      details: Array.isArray(result.error.details) ? result.error.details.slice(0, 20) : null,
    };
  }
  if (result.errorInfo) diagnostics.errorInfo = result.errorInfo;
  if (Array.isArray(result.fieldWarnings)) diagnostics.fieldWarnings = result.fieldWarnings.slice(0, 50);
  if (result.requestId) diagnostics.requestId = String(result.requestId).slice(0, 200);
  return Object.keys(diagnostics).length ? diagnostics : null;
}

async function accessToken(): Promise<string> {
  if (!OAUTH_CLIENT_ID || !OAUTH_CLIENT_SECRET || !OAUTH_REFRESH_TOKEN) {
    throw new Error("Data Manager OAuth configuration missing");
  }
  const body = new URLSearchParams({
    client_id: OAUTH_CLIENT_ID,
    client_secret: OAUTH_CLIENT_SECRET,
    refresh_token: OAUTH_REFRESH_TOKEN,
    grant_type: "refresh_token",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const payload = await response.json().catch(() => ({}));
  const token = String(payload?.access_token || "");
  if (!response.ok || !token) throw new Error(`Data Manager OAuth failed ${response.status}`);
  return token;
}

async function customerId(admin: any): Promise<string> {
  const envId = digits(CUSTOMER_ID_ENV);
  if (envId) return envId;
  const { data, error } = await admin
    .from("integrations")
    .select("metadata")
    .eq("service", "google_ads")
    .eq("status", "connected")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("Google Ads integration lookup failed");
  const metadata = data?.metadata || {};
  const resolved = digits(metadata.customerId || metadata.customer_id);
  if (!resolved) throw new Error("Google Ads customer id missing");
  return resolved;
}

function requestHeaders(token: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  if (CLOUD_PROJECT_ID) headers["x-goog-user-project"] = CLOUD_PROJECT_ID;
  return headers;
}

function userData(row: any) {
  const identifiers: Record<string, string>[] = [];
  if (/^[0-9a-f]{64}$/i.test(String(row.email_hash || ""))) identifiers.push({ emailAddress: String(row.email_hash).toLowerCase() });
  if (/^[0-9a-f]{64}$/i.test(String(row.phone_hash || ""))) identifiers.push({ phoneNumber: String(row.phone_hash).toLowerCase() });
  return identifiers.length ? { userIdentifiers: identifiers } : null;
}

function adIdentifiers(row: any) {
  const result: Record<string, string> = {};
  if (row.gclid) result.gclid = String(row.gclid);
  if (row.gbraid) result.gbraid = String(row.gbraid);
  if (row.wbraid) result.wbraid = String(row.wbraid);
  return result;
}

function destination(customer: string, actionId: string) {
  const operatingAccount = { accountId: customer, accountType: "GOOGLE_ADS" };
  const output: Record<string, unknown> = {
    reference: "google_ads_conversion",
    operatingAccount,
    productDestinationId: actionId,
  };
  const loginId = digits(LOGIN_CUSTOMER_ID);
  if (loginId) output.loginAccount = { accountId: loginId, accountType: "GOOGLE_ADS" };
  return output;
}

function eventPayload(row: any) {
  const event: Record<string, unknown> = {
    destinationReferences: ["google_ads_conversion"],
    transactionId: String(row.transaction_id),
    eventTimestamp: new Date(row.event_timestamp).toISOString(),
    adIdentifiers: adIdentifiers(row),
    currency: row.currency_code || "EUR",
    eventSource: "WEB",
    eventName: String(row.event_name),
  };
  const users = userData(row);
  if (users) event.userData = users;
  const value = Number(row.conversion_value);
  if (Number.isFinite(value) && value >= 0) event.conversionValue = value;
  return { event, hasUserData: Boolean(users) };
}

async function mark(admin: any, id: string, patch: Record<string, unknown>) {
  const { error } = await admin.from("google_data_manager_outbox").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error("Outbox state update failed");
}

async function deliverOne(admin: any, row: any, token: string, customer: string, actions: Record<string, string>) {
  if (row.is_test_lead === true) {
    await mark(admin, row.id, { delivery_status: "suppressed", last_error: null });
    return { id: row.id, outcome: "suppressed" };
  }

  const actionId = digits(row.conversion_action_id) || actions[String(row.event_name)] || "";
  if (!actionId) {
    await mark(admin, row.id, { delivery_status: "configuration_required", last_error: "Conversion action not configured" });
    return { id: row.id, outcome: "configuration_required" };
  }

  const { event, hasUserData } = eventPayload(row);
  const payload: Record<string, unknown> = {
    destinations: [destination(customer, actionId)],
    events: [event],
    consent: { adUserData: "CONSENT_GRANTED" },
    validateOnly: false,
  };
  if (hasUserData) payload.encoding = "HEX";

  await mark(admin, row.id, {
    delivery_status: "sending",
    attempt_count: Number(row.attempt_count || 0) + 1,
    operating_customer_id: customer,
    conversion_action_id: actionId,
    last_error: null,
  });

  const response = await fetch(INGEST_URL, {
    method: "POST",
    headers: requestHeaders(token),
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result?.requestId) {
    const message = `Data Manager ingest failed ${response.status}`;
    await mark(admin, row.id, {
      delivery_status: "failed",
      last_error: message,
      diagnostics: safeProviderDiagnostics(result),
    });
    return { id: row.id, outcome: "failed", error: message };
  }

  const warnings = Array.isArray(result.fieldWarnings) ? result.fieldWarnings : [];
  await mark(admin, row.id, {
    delivery_status: "sent",
    provider_request_id: String(result.requestId),
    diagnostics: { fieldWarnings: warnings.slice(0, 50) },
    last_error: null,
  });
  return { id: row.id, outcome: "accepted", request_id: String(result.requestId) };
}

async function pollOne(admin: any, row: any, token: string) {
  const requestId = String(row.provider_request_id || "");
  if (!requestId) return { id: row.id, outcome: "skipped_missing_request_id" };

  const url = `${STATUS_URL}?requestId=${encodeURIComponent(requestId)}`;
  const response = await fetch(url, { method: "GET", headers: requestHeaders(token) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = `Data Manager status failed ${response.status}`;
    await mark(admin, row.id, { last_error: message, diagnostics: safeProviderDiagnostics(result) });
    return { id: row.id, outcome: "status_failed", error: message };
  }

  const statuses = Array.isArray(result?.requestStatusPerDestination) ? result.requestStatusPerDestination : [];
  const status = String(statuses[0]?.requestStatus || "REQUEST_STATUS_UNKNOWN");
  const diagnostics = {
    requestStatus: status,
    errorInfo: statuses[0]?.errorInfo || null,
    warningInfo: statuses[0]?.warningInfo || null,
    eventsIngestionStatus: statuses[0]?.eventsIngestionStatus || null,
  };

  if (status === "SUCCESS") {
    await mark(admin, row.id, { delivery_status: "sent", delivered_at: new Date().toISOString(), diagnostics, last_error: null });
    return { id: row.id, outcome: "delivered" };
  }
  if (status === "FAILED" || status === "PARTIAL_SUCCESS") {
    await mark(admin, row.id, { delivery_status: "failed", diagnostics, last_error: `Data Manager processing ${status}` });
    return { id: row.id, outcome: "failed", status };
  }

  await mark(admin, row.id, { delivery_status: "sent", diagnostics, last_error: null });
  return { id: row.id, outcome: "processing", status };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ success: false, message: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ success: false, message: "Server configuration error" }, 500);

  const body = await req.json().catch(() => ({}));
  const mode = body?.mode === "poll" ? "poll" : "deliver";
  const requestedLimit = Number(body?.limit || DEFAULT_LIMIT);
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number.isFinite(requestedLimit) ? Math.trunc(requestedLimit) : DEFAULT_LIMIT));
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  let token: string;
  try {
    token = await accessToken();
  } catch (error: any) {
    const message = String(error?.message || "Data Manager authentication unavailable").slice(0, 200);
    if (mode === "deliver") {
      await admin.from("google_data_manager_outbox")
        .update({ delivery_status: "configuration_required", last_error: message, updated_at: new Date().toISOString() })
        .in("delivery_status", ["pending", "failed"])
        .eq("is_test_lead", false);
    }
    return json({ success: false, configuration_required: true, message }, 503);
  }

  try {
    const results = [];
    if (mode === "poll") {
      const { data: rows, error } = await admin
        .from("google_data_manager_outbox")
        .select("id,provider_request_id,delivery_status")
        .eq("delivery_status", "sent")
        .not("provider_request_id", "is", null)
        .is("delivered_at", null)
        .order("updated_at", { ascending: true })
        .limit(limit);
      if (error) throw new Error("Outbox status query failed");
      for (const row of rows || []) results.push(await pollOne(admin, row, token));
    } else {
      const customer = await customerId(admin);
      const actions = cleanActionMap();
      const { data: rows, error } = await admin
        .from("google_data_manager_outbox")
        .select("id,lead_id,event_name,event_timestamp,operating_customer_id,conversion_action_id,gclid,gbraid,wbraid,email_hash,phone_hash,conversion_value,currency_code,transaction_id,is_test_lead,delivery_status,attempt_count")
        .in("delivery_status", ["pending", "failed", "configuration_required"])
        .order("created_at", { ascending: true })
        .limit(limit);
      if (error) throw new Error("Outbox delivery query failed");
      for (const row of rows || []) results.push(await deliverOne(admin, row, token, customer, actions));
    }

    return json({
      success: true,
      mode,
      processed: results.length,
      delivered_or_accepted: results.filter((r: any) => r.outcome === "accepted" || r.outcome === "delivered").length,
      suppressed: results.filter((r: any) => r.outcome === "suppressed").length,
      failed: results.filter((r: any) => r.outcome === "failed" || r.outcome === "status_failed").length,
      results,
    });
  } catch (error: any) {
    console.error("[google-data-manager-export]", error?.message || error);
    return json({ success: false, message: "Internal error", required_scope: DATA_MANAGER_SCOPE }, 500);
  }
});
