import { createClient } from "jsr:@supabase/supabase-js@2";
import { GoogleAdsAuthFailure, resolveGoogleAdsAuth } from "../_shared/google-ads-auth.ts";

declare const Deno: any;

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").trim();
const SERVICE_ROLE = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
const SERVICE_ACCOUNT_RAW = (Deno.env.get("GOOGLE_ADS_SERVICE_ACCOUNT") || "").trim();
const OAUTH_CLIENT_ID = (Deno.env.get("GOOGLE_ADS_CLIENT_ID") || "").trim();
const OAUTH_CLIENT_SECRET = (Deno.env.get("GOOGLE_ADS_CLIENT_SECRET") || "").trim();
const OAUTH_REFRESH_TOKEN = (Deno.env.get("GOOGLE_ADS_REFRESH_TOKEN") || "").trim();
const LOGIN_CUSTOMER_ID_ENV = (Deno.env.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID") || "").replace(/\D/g, "");
const API_VERSION = "v25";
const CANONICAL_LOGIN_CUSTOMER_ID = "8265708501";
const TARGET_CUSTOMER_IDS = ["9084540447", "8201489748"] as const;
const MAX_BODY_BYTES = 4096;

type FailureKind = "request" | "configuration" | "oauth" | "provider" | "validation";
type FailureStage = "oauth_token" | "list_accessible_customers" | "gaql_908" | "gaql_820";

class PreflightFailure extends Error {
  kind: FailureKind;
  status: number;
  stage?: FailureStage;

  constructor(kind: FailureKind, status: number, message: string, stage?: FailureStage) {
    super(message);
    this.name = "PreflightFailure";
    this.kind = kind;
    this.status = status;
    this.stage = stage;
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

function digits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

function bounded(value: unknown, max = 240): string {
  return String(value ?? "").replace(/\s+/g, " ").slice(0, max);
}

function validateDeveloperToken(value: unknown): string {
  const token = String(value ?? "").trim();
  if (!token || token.length > 512) {
    throw new PreflightFailure("request", 422, "Google Ads developer token is missing or too long");
  }
  if (token.startsWith("{") || token.includes("private_key") || token.includes("client_email")) {
    throw new PreflightFailure("request", 422, "Google Ads developer token slot contains a service-account payload");
  }
  if (!/^[A-Za-z0-9._~-]+$/.test(token)) {
    throw new PreflightFailure("request", 422, "Google Ads developer token contains unsupported characters");
  }
  return token;
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

function normalizeFailure(error: unknown, stage?: FailureStage): PreflightFailure {
  if (error instanceof PreflightFailure) {
    return stage && !error.stage
      ? new PreflightFailure(error.kind, error.status, error.message, stage)
      : error;
  }
  if (error instanceof GoogleAdsAuthFailure) {
    return new PreflightFailure(error.kind, error.status, error.message, stage);
  }
  return new PreflightFailure(
    "configuration",
    500,
    bounded((error as any)?.message || "Google Ads runtime auth preflight failed"),
    stage,
  );
}

async function readProviderJson(response: Response, stage: FailureStage): Promise<any> {
  try {
    return await response.json();
  } catch {
    throw new PreflightFailure(
      "provider",
      502,
      `Google Ads API returned invalid non-JSON payload (HTTP ${response.status})`,
      stage,
    );
  }
}

function providerFailure(status: number, payload: unknown, stage: FailureStage): PreflightFailure {
  const error = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
  const providerStatus = bounded(error.status || "", 80);
  return new PreflightFailure(
    "provider",
    502,
    `Google Ads API ${status}${providerStatus ? ` ${providerStatus}` : ""}`,
    stage,
  );
}

async function listAccessibleCustomers(accessToken: string, developerToken: string) {
  const stage: FailureStage = "list_accessible_customers";
  const response = await fetch(`https://googleads.googleapis.com/${API_VERSION}/customers:listAccessibleCustomers`, {
    redirect: "error",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": developerToken,
    },
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await readProviderJson(response, stage);
  if (!response.ok || payload?.error) throw providerFailure(response.status, payload, stage);
  return Array.isArray(payload?.resourceNames)
    ? payload.resourceNames
      .map((value: unknown) => String(value))
      .filter((value: string) => /^customers\/\d+$/.test(value))
      .map((value: string) => digits(value))
    : [];
}

function customerFailureStage(customerId: string): FailureStage {
  if (customerId === "9084540447") return "gaql_908";
  if (customerId === "8201489748") return "gaql_820";
  throw new PreflightFailure("validation", 424, "Google Ads customer is outside the governed preflight set");
}

async function proveCustomerIdentity(
  customerId: string,
  loginCustomerId: string,
  developerToken: string,
  accessToken: string,
) {
  const stage = customerFailureStage(customerId);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": developerToken,
    "Content-Type": "application/json",
  };
  if (loginCustomerId) headers["login-customer-id"] = loginCustomerId;

  const response = await fetch(
    `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}/googleAds:search`,
    {
      method: "POST",
      redirect: "error",
      headers,
      body: JSON.stringify({ query: "SELECT customer.id FROM customer LIMIT 1" }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  const payload = await readProviderJson(response, stage);
  if (!response.ok || payload?.error) throw providerFailure(response.status, payload, stage);
  const returnedId = digits(payload?.results?.[0]?.customer?.id);
  if (returnedId !== customerId) {
    throw new PreflightFailure("validation", 424, `Google Ads customer identity mismatch for ${customerId}`, stage);
  }
  return { customer_id: customerId, identity_match: true };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply(405, { success: false, message: "Method not allowed" });
  if (!SUPABASE_URL || !SERVICE_ROLE) return reply(500, { success: false, message: "Server configuration error" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data: expectedSecret, error: secretError } = await admin.rpc("nvx_get_runtime_secret", {
    p_name: "REVOPS_INTERNAL_SECRET",
  });
  if (secretError || !expectedSecret) return reply(503, { success: false, message: "Runtime secret unavailable" });

  const receivedSecret = String(req.headers.get("x-nvx-internal-secret") || "").trim();
  if (!(await secretMatches(receivedSecret, String(expectedSecret)))) {
    return reply(403, { success: false, message: "Forbidden" });
  }

  const declaredLength = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return reply(413, { success: false, message: "Payload too large" });
  }
  const rawBody = await req.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return reply(413, { success: false, message: "Payload too large" });
  }

  try {
    const parsed = rawBody.trim() ? JSON.parse(rawBody) : {};
    if (!isRecord(parsed)) throw new PreflightFailure("request", 400, "Invalid JSON");
    const developerToken = validateDeveloperToken(parsed.developer_token);

    const { data: integrations, error: integrationError } = await admin
      .from("integrations")
      .select("id,metadata,status")
      .eq("service", "google_ads")
      .eq("status", "connected")
      .order("created_at", { ascending: true });
    if (integrationError) throw new PreflightFailure("configuration", 500, "Google Ads integration lookup failed");

    const byCustomer = new Map<string, any>();
    for (const integration of integrations || []) {
      const customerId = digits(integration?.metadata?.customerId || integration?.metadata?.customer_id);
      if (customerId && TARGET_CUSTOMER_IDS.includes(customerId as any)) byCustomer.set(customerId, integration);
    }
    const missing = TARGET_CUSTOMER_IDS.filter((customerId) => !byCustomer.has(customerId));
    if (missing.length > 0) {
      throw new PreflightFailure("validation", 424, `Missing connected Google Ads integration(s): ${missing.join(",")}`);
    }

    const loginCustomerIds = new Set<string>();
    for (const customerId of TARGET_CUSTOMER_IDS) {
      const integration = byCustomer.get(customerId);
      const loginCustomerId = digits(
        LOGIN_CUSTOMER_ID_ENV
        || integration?.metadata?.loginCustomerId
        || integration?.metadata?.login_customer_id,
      );
      if (!loginCustomerId) {
        throw new PreflightFailure("configuration", 500, `Google Ads login customer id missing for ${customerId}`);
      }
      loginCustomerIds.add(loginCustomerId);
    }
    if (loginCustomerIds.size !== 1) {
      throw new PreflightFailure("validation", 424, "Google Ads target integrations do not share one login customer id");
    }
    const loginCustomerId = [...loginCustomerIds][0];
    if (loginCustomerId !== CANONICAL_LOGIN_CUSTOMER_ID) {
      throw new PreflightFailure("validation", 424, "Google Ads login customer id is not the canonical MCC");
    }

    let googleAuth;
    try {
      googleAuth = await resolveGoogleAdsAuth({
        serviceAccountRaw: SERVICE_ACCOUNT_RAW,
        oauthClientId: OAUTH_CLIENT_ID,
        oauthClientSecret: OAUTH_CLIENT_SECRET,
        oauthRefreshToken: OAUTH_REFRESH_TOKEN,
      });
    } catch (error) {
      throw normalizeFailure(error, "oauth_token");
    }

    const accessibleCustomerIds = await listAccessibleCustomers(googleAuth.token, developerToken);
    if (!accessibleCustomerIds.includes(CANONICAL_LOGIN_CUSTOMER_ID)) {
      throw new PreflightFailure(
        "validation",
        424,
        "Canonical Google Ads MCC is not directly accessible",
        "list_accessible_customers",
      );
    }

    const customerProofs = [];
    for (const customerId of TARGET_CUSTOMER_IDS) {
      customerProofs.push(await proveCustomerIdentity(
        customerId,
        loginCustomerId,
        developerToken,
        googleAuth.token,
      ));
    }

    return reply(200, {
      success: true,
      provider: "google_ads",
      api_version: API_VERSION,
      auth_mode: googleAuth.mode,
      login_customer_id: CANONICAL_LOGIN_CUSTOMER_ID,
      login_customer_accessible: true,
      accessible_customer_count: accessibleCustomerIds.length,
      target_customer_ids: TARGET_CUSTOMER_IDS,
      customer_proofs: customerProofs,
      persistence_performed: false,
    });
  } catch (error) {
    const failure = normalizeFailure(error);
    console.error(
      "[google-ads-auth-preflight]",
      failure.kind,
      failure.stage || "unknown",
      bounded(failure.message),
    );
    return reply(failure.status, {
      success: false,
      provider: "google_ads",
      api_version: API_VERSION,
      kind: failure.kind,
      stage: failure.stage || "unknown",
      message: bounded(failure.message),
      persistence_performed: false,
    });
  }
});
