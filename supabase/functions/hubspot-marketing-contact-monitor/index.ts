import { createClient } from "jsr:@supabase/supabase-js@2";

declare const Deno: any;

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").trim();
const SERVICE_ROLE = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
const HUBSPOT_ACCESS_TOKEN_ENV = (Deno.env.get("HUBSPOT_ACCESS_TOKEN") || "").trim();
const HUBSPOT_SEARCH_URL = "https://api.hubapi.com/crm/v3/objects/contacts/search";
const MONITOR_KEY = "hubspot_marketing_contacts";
const MAX_BODY_BYTES = 1024;

type FailureCode =
  | "hubspot_credential_unavailable"
  | "hubspot_transport_failure"
  | "hubspot_unauthorized"
  | "hubspot_forbidden"
  | "hubspot_rate_limited"
  | "hubspot_unavailable"
  | "hubspot_provider_failure"
  | "hubspot_invalid_response"
  | "monitor_state_unavailable"
  | "monitor_state_invalid"
  | "monitor_persistence_failed";

class MonitorFailure extends Error {
  code: FailureCode;
  status: number;

  constructor(code: FailureCode, status: number) {
    super(code);
    this.name = "MonitorFailure";
    this.code = code;
    this.status = status;
  }
}

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function sha256(raw: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)));
}

async function secretMatches(received: string, expected: string): Promise<boolean> {
  if (!received || !expected) return false;
  const [leftHash, rightHash] = await Promise.all([sha256(received), sha256(expected)]);
  if (leftHash.length !== rightHash.length) return false;
  let diff = 0;
  for (let index = 0; index < leftHash.length; index += 1) diff |= leftHash[index] ^ rightHash[index];
  return diff === 0;
}

function normalizeFailure(error: unknown): MonitorFailure {
  if (error instanceof MonitorFailure) return error;
  return new MonitorFailure("monitor_state_unavailable", 500);
}

async function resolveHubSpotAccessToken(admin: any): Promise<string> {
  if (HUBSPOT_ACCESS_TOKEN_ENV) return HUBSPOT_ACCESS_TOKEN_ENV;
  const { data, error } = await admin.rpc("nvx_get_runtime_secret", { p_name: "HUBSPOT_ACCESS_TOKEN" });
  const token = String(data || "").trim();
  if (error || !token) throw new MonitorFailure("hubspot_credential_unavailable", 503);
  return token;
}

async function fetchMarketingContactCount(accessToken: string): Promise<number> {
  let response: Response;
  try {
    response = await fetch(HUBSPOT_SEARCH_URL, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filterGroups: [{
          filters: [{
            propertyName: "hs_marketable_status",
            operator: "EQ",
            value: "true",
          }],
        }],
        properties: ["hs_object_id"],
        limit: 1,
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new MonitorFailure("hubspot_transport_failure", 502);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new MonitorFailure("hubspot_invalid_response", 502);
  }

  if (!response.ok) {
    if (response.status === 401) throw new MonitorFailure("hubspot_unauthorized", 502);
    if (response.status === 403) throw new MonitorFailure("hubspot_forbidden", 502);
    if (response.status === 429) throw new MonitorFailure("hubspot_rate_limited", 503);
    if (response.status >= 500) throw new MonitorFailure("hubspot_unavailable", 503);
    throw new MonitorFailure("hubspot_provider_failure", 502);
  }

  const total = isRecord(payload) ? Number(payload.total) : Number.NaN;
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new MonitorFailure("hubspot_invalid_response", 502);
  }
  return total;
}

async function persistFailureState(admin: any, failure: MonitorFailure): Promise<void> {
  const now = new Date().toISOString();
  try {
    await admin
      .from("hubspot_marketing_contact_monitor_state")
      .update({
        last_error_code: failure.code,
        last_error_at: now,
        updated_at: now,
      })
      .eq("monitor_key", MONITOR_KEY);
  } catch {
    // The response remains fail-closed even when observability persistence is unavailable.
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply(405, { success: false, code: "method_not_allowed" });
  if (!SUPABASE_URL || !SERVICE_ROLE) return reply(500, { success: false, code: "server_configuration_error" });

  const declaredLength = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return reply(413, { success: false, code: "payload_too_large" });
  }
  const rawBody = await req.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return reply(413, { success: false, code: "payload_too_large" });
  }
  if (rawBody.trim()) {
    try {
      const parsed = JSON.parse(rawBody);
      if (!isRecord(parsed)) return reply(400, { success: false, code: "invalid_json" });
    } catch {
      return reply(400, { success: false, code: "invalid_json" });
    }
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const { data: expectedSecret, error: secretError } = await admin.rpc("nvx_get_runtime_secret", {
      p_name: "REVOPS_INTERNAL_SECRET",
    });
    if (secretError || !expectedSecret) {
      return reply(503, { success: false, code: "runtime_secret_unavailable" });
    }

    const receivedSecret = String(req.headers.get("x-nvx-internal-secret") || "").trim();
    if (!(await secretMatches(receivedSecret, String(expectedSecret)))) {
      return reply(403, { success: false, code: "forbidden" });
    }

    const accessToken = await resolveHubSpotAccessToken(admin);
    const count = await fetchMarketingContactCount(accessToken);

    const { data: state, error: stateError } = await admin
      .from("hubspot_marketing_contact_monitor_state")
      .select("threshold,above_threshold,last_triggered_at")
      .eq("monitor_key", MONITOR_KEY)
      .single();
    if (stateError || !state) throw new MonitorFailure("monitor_state_unavailable", 500);

    const threshold = Number(state.threshold);
    if (!Number.isSafeInteger(threshold) || threshold <= 0 || typeof state.above_threshold !== "boolean") {
      throw new MonitorFailure("monitor_state_invalid", 500);
    }

    const now = new Date().toISOString();
    const aboveThreshold = count >= threshold;
    const thresholdTransition = aboveThreshold && state.above_threshold === false;
    const updatePayload: Record<string, unknown> = {
      last_count: count,
      above_threshold: aboveThreshold,
      last_checked_at: now,
      last_error_code: null,
      last_error_at: null,
      updated_at: now,
    };
    if (thresholdTransition) updatePayload.last_triggered_at = now;

    const { error: updateError } = await admin
      .from("hubspot_marketing_contact_monitor_state")
      .update(updatePayload)
      .eq("monitor_key", MONITOR_KEY);
    if (updateError) throw new MonitorFailure("monitor_persistence_failed", 500);

    if (thresholdTransition) {
      console.warn(`[hubspot-marketing-contact-monitor] threshold_crossed count=${count} threshold=${threshold}`);
    } else {
      console.log(`[hubspot-marketing-contact-monitor] success count=${count} threshold=${threshold}`);
    }

    return reply(200, {
      success: true,
      count,
      threshold,
      above_threshold: aboveThreshold,
      threshold_transition: thresholdTransition,
      checked_at: now,
    });
  } catch (error) {
    const failure = normalizeFailure(error);
    await persistFailureState(admin, failure);
    console.error(`[hubspot-marketing-contact-monitor] failed code=${failure.code}`);
    return reply(failure.status, { success: false, code: failure.code });
  }
});
