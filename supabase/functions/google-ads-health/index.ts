import { createClient } from "jsr:@supabase/supabase-js@2";
import { parseServiceAccount } from "./parse-service-account.ts";

export { parseServiceAccount };

declare const Deno: any;

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").trim();
const SERVICE_ROLE = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
const ENCRYPTION_KEY = (Deno.env.get("ENCRYPTION_KEY") || "").trim();
const SERVICE_ACCOUNT_RAW = (Deno.env.get("GOOGLE_ADS_SERVICE_ACCOUNT") || "").trim();
const LOGIN_CUSTOMER_ID_ENV = (Deno.env.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID") || "").replace(/\D/g, "");
const API_VERSION = "v25";
const CANONICAL_CONVERSION_ACTION_ID = "7713427085";
const MAX_RANGE_DAYS = 92;
const MAX_BODY_BYTES = 8192;
const MAX_PROVIDER_PAGES = 20;
const MAX_PROVIDER_ROWS = 10_000;

type FailureKind = "request" | "configuration" | "oauth" | "provider" | "validation" | "persistence";

class HealthFailure extends Error {
  kind: FailureKind;
  status: number;

  constructor(kind: FailureKind, status: number, message: string) {
    super(message);
    this.name = "HealthFailure";
    this.kind = kind;
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

function digits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

function cleanSelector(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new HealthFailure("configuration", 500, "Malformed encrypted Google Ads credential");
  }
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  return bytes;
}

async function decryptCredential(encoded: string): Promise<string> {
  if (!ENCRYPTION_KEY) throw new HealthFailure("configuration", 500, "Credential encryption key unavailable");
  const parts = String(encoded || "").split(":");
  if (parts.length !== 4) throw new HealthFailure("configuration", 500, "Malformed encrypted Google Ads credential");
  const [saltHex, ivHex, tagHex, ciphertextHex] = parts;
  const salt = hexToBytes(saltHex);
  const iv = hexToBytes(ivHex);
  const tag = hexToBytes(tagHex);
  const ciphertext = hexToBytes(ciphertextHex);
  const combined = new Uint8Array(new ArrayBuffer(ciphertext.length + tag.length));
  combined.set(ciphertext);
  combined.set(tag, ciphertext.length);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(ENCRYPTION_KEY),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const aesKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, combined);
    return new TextDecoder().decode(plain).trim();
  } catch {
    throw new HealthFailure("configuration", 500, "Google Ads developer credential decryption failed");
  }
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlText(value: string): string {
  return base64Url(new TextEncoder().encode(value));
}

function pemBytes(pem: string): Uint8Array<ArrayBuffer> {
  const clean = String(pem || "")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  if (!clean) throw new HealthFailure("configuration", 500, "Google Ads service-account private key unavailable");
  const binary = atob(clean);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function googleAccessToken(serviceAccount: Record<string, any>): Promise<string> {
  const email = String(serviceAccount.client_email || "").trim();
  const tokenUri = String(serviceAccount.token_uri || "https://oauth2.googleapis.com/token").trim();
  const privateKey = String(serviceAccount.private_key || "");
  if (!email || !privateKey) throw new HealthFailure("configuration", 500, "Google Ads service account is incomplete");

  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64UrlText(JSON.stringify({
    iss: email,
    scope: "https://www.googleapis.com/auth/adwords",
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  }));
  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemBytes(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  ));
  const assertion = `${signingInput}.${base64Url(signature)}`;
  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const tokenPayload = await response.json().catch(() => ({}));
  const token = String(tokenPayload?.access_token || "").trim();
  if (!response.ok || !token) throw new HealthFailure("oauth", 424, `Google OAuth failed ${response.status}`);
  return token;
}

function providerError(status: number, payload: unknown): HealthFailure {
  const value = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
  const providerStatus = String(value.status || "").slice(0, 80);
  let message = String(value.message || "").replace(/\s+/g, " ").slice(0, 300);
  const detailErrors = Array.isArray(value.details)
    ? value.details.flatMap((d: any) => Array.isArray(d?.errors) ? d.errors.map((e: any) => e?.message || JSON.stringify(e?.errorCode)) : []).filter(Boolean)
    : [];
  if (detailErrors.length > 0) {
    message += ` (${detailErrors.join("; ")})`;
  }
  return new HealthFailure(
    "provider",
    502,
    `Google Ads API ${status}${providerStatus ? ` ${providerStatus}` : ""}${message ? `: ${message}` : ""}`,
  );
}

async function googleAdsSearch(
  customerId: string,
  developerToken: string,
  accessToken: string,
  query: string,
  loginCustomerId: string,
): Promise<any[]> {
  const rows: any[] = [];
  const seenPageTokens = new Set<string>();
  let pageToken = "";
  let pageCount = 0;

  do {
    pageCount += 1;
    if (pageCount > MAX_PROVIDER_PAGES) {
      throw new HealthFailure("provider", 502, `Google Ads pagination exceeded ${MAX_PROVIDER_PAGES} pages`);
    }
    if (pageToken) {
      if (seenPageTokens.has(pageToken)) throw new HealthFailure("provider", 502, "Google Ads repeated a pagination token");
      seenPageTokens.add(pageToken);
    }

    const requestBody: Record<string, unknown> = { query };
    if (pageToken) requestBody.pageToken = pageToken;
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
        headers,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(30_000),
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) throw providerError(response.status, payload);
    if (payload?.results !== undefined && !Array.isArray(payload.results)) {
      throw new HealthFailure("provider", 502, "Google Ads response has invalid results");
    }
    const results = Array.isArray(payload?.results) ? payload.results : [];
    rows.push(...results);
    if (rows.length > MAX_PROVIDER_ROWS) {
      throw new HealthFailure("provider", 502, `Google Ads result set exceeded ${MAX_PROVIDER_ROWS} rows`);
    }
    pageToken = String(payload?.nextPageToken || "").trim();
  } while (pageToken);
  return rows;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function resolveRange(body: Record<string, any>): { from: string; to: string } {
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(body.to || "")) ? String(body.to) : isoDate(new Date());
  const defaultFromDate = new Date(`${to}T00:00:00Z`);
  defaultFromDate.setUTCDate(defaultFromDate.getUTCDate() - 29);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(body.from || "")) ? String(body.from) : isoDate(defaultFromDate);
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  const days = Math.floor((end - start) / 86_400_000) + 1;
  if (!Number.isFinite(days) || days < 1 || days > MAX_RANGE_DAYS) {
    throw new HealthFailure("request", 422, "Invalid Google Ads date range");
  }
  return { from, to };
}

function micros(value: unknown): number {
  const raw = Number(value ?? 0);
  return Number.isFinite(raw) ? raw / 1_000_000 : 0;
}

function normalizeFailure(error: unknown): HealthFailure {
  if (error instanceof HealthFailure) return error;
  return new HealthFailure("configuration", 500, String((error as any)?.message || "Google Ads health check failed"));
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
  if (!(await secretMatches(receivedSecret, String(expectedSecret)))) return reply(403, { success: false, message: "Forbidden" });

  const declaredLength = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return reply(413, { success: false, message: "Payload too large" });
  }
  const rawBody = await req.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return reply(413, { success: false, message: "Payload too large" });
  }
  let body: Record<string, any>;
  try {
    const parsed = rawBody.trim() ? JSON.parse(rawBody) : {};
    if (!isRecord(parsed)) return reply(400, { success: false, message: "Invalid JSON" });
    body = parsed;
  } catch {
    return reply(400, { success: false, message: "Invalid JSON" });
  }

  let range: { from: string; to: string };
  try {
    range = resolveRange(body);
  } catch (error) {
    const failure = normalizeFailure(error);
    return reply(failure.status, { success: false, kind: failure.kind, message: failure.message });
  }

  const selectors = [
    ["integration_id", cleanSelector(body.integration_id)],
    ["user_id", cleanSelector(body.user_id)],
    ["clinic_id", cleanSelector(body.clinic_id)],
  ].filter(([, value]) => value);
  if (selectors.length !== 1) {
    return reply(422, {
      success: false,
      kind: "request",
      message: "Exactly one of integration_id, user_id or clinic_id is required",
    });
  }

  let integrationId = "";
  try {
    const serviceAccount = parseServiceAccount(SERVICE_ACCOUNT_RAW);

    let integrationQuery = admin
      .from("integrations")
      .select("id,user_id,clinic_id,metadata,status")
      .eq("service", "google_ads")
      .eq("status", "connected");
    const [selectorKey, selectorValue] = selectors[0];
    if (selectorKey === "integration_id") integrationQuery = integrationQuery.eq("id", selectorValue);
    if (selectorKey === "user_id") integrationQuery = integrationQuery.eq("user_id", selectorValue);
    if (selectorKey === "clinic_id") integrationQuery = integrationQuery.eq("clinic_id", selectorValue);
    const { data: integrations, error: integrationError } = await integrationQuery.limit(2);
    if (integrationError) throw new HealthFailure("configuration", 500, "Google Ads integration lookup failed");
    if (!Array.isArray(integrations) || integrations.length !== 1) {
      throw new HealthFailure("validation", 424, "Google Ads integration selector did not resolve exactly one connected integration");
    }
    const integration = integrations[0];
    integrationId = String(integration.id || "");

    const customerId = digits(integration?.metadata?.customerId || integration?.metadata?.customer_id);
    if (!customerId) throw new HealthFailure("configuration", 500, "Google Ads customer id missing");
    const loginCustomerId = digits(
      LOGIN_CUSTOMER_ID_ENV
      || integration?.metadata?.loginCustomerId
      || integration?.metadata?.login_customer_id,
    );

    const { data: credential, error: credentialError } = await admin
      .from("credentials")
      .select("id,encrypted_key")
      .eq("user_id", integration.user_id)
      .eq("service", "google_ads")
      .maybeSingle();
    if (credentialError || !credential?.encrypted_key) {
      throw new HealthFailure("configuration", 500, "Google Ads developer credential not found");
    }
    let developerToken = "";
    try {
      developerToken = await decryptCredential(String(credential.encrypted_key));
    } catch {
      developerToken = String(
        integration?.metadata?.developer_token ||
        integration?.metadata?.developerToken ||
        Deno.env.get("GOOGLE_ADS_DEVELOPER_TOKEN") ||
        ""
      ).trim();
    }
    if (!developerToken) throw new HealthFailure("configuration", 500, "Google Ads developer credential is empty");

    const accessToken = await googleAccessToken(serviceAccount);
    const [customerRows, campaignRows, performanceRows, conversionRows] = await Promise.all([
      googleAdsSearch(customerId, developerToken, accessToken, `
        SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone
        FROM customer
        LIMIT 1
      `, loginCustomerId),
      googleAdsSearch(customerId, developerToken, accessToken, `
        SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
               campaign_budget.amount_micros
        FROM campaign
        ORDER BY campaign.id
      `, loginCustomerId),
      googleAdsSearch(customerId, developerToken, accessToken, `
        SELECT campaign.id, metrics.impressions, metrics.clicks, metrics.cost_micros,
               metrics.conversions, metrics.ctr, metrics.average_cpc, metrics.cost_per_conversion
        FROM campaign
        WHERE segments.date BETWEEN '${range.from}' AND '${range.to}'
      `, loginCustomerId),
      googleAdsSearch(customerId, developerToken, accessToken, `
        SELECT conversion_action.id, conversion_action.name, conversion_action.status,
               conversion_action.type, conversion_action.category, conversion_action.origin,
               conversion_action.primary_for_goal
        FROM conversion_action
        WHERE conversion_action.id = ${CANONICAL_CONVERSION_ACTION_ID}
      `, loginCustomerId),
    ]);

    const customer = customerRows[0]?.customer || null;
    if (!customer || String(customer.id || "") !== customerId) {
      throw new HealthFailure("validation", 424, "Google Ads customer identity validation failed");
    }

    if (conversionRows.length !== 1) {
      throw new HealthFailure("validation", 424, "Canonical Google Ads conversion action missing");
    }
    const conversion = conversionRows[0]?.conversionAction || null;
    if (!conversion || String(conversion.id || "") !== CANONICAL_CONVERSION_ACTION_ID) {
      throw new HealthFailure("validation", 424, "Canonical Google Ads conversion identity mismatch");
    }
    if (conversion.primaryForGoal !== true) {
      throw new HealthFailure("validation", 424, "Canonical Google Ads conversion is not primary_for_goal");
    }
    if (String(conversion.status || "").toUpperCase() !== "ENABLED") {
      throw new HealthFailure("validation", 424, "Canonical Google Ads conversion is not enabled");
    }

    const performance = new Map<string, any>();
    for (const row of performanceRows) performance.set(String(row?.campaign?.id || ""), row?.metrics || {});
    const campaigns = campaignRows.map((row) => {
      const id = String(row?.campaign?.id || "");
      const metrics = performance.get(id) || {};
      return {
        id,
        name: row?.campaign?.name ?? null,
        status: row?.campaign?.status ?? null,
        channel: row?.campaign?.advertisingChannelType ?? null,
        daily_budget: micros(row?.campaignBudget?.amountMicros),
        impressions: Number(metrics?.impressions || 0),
        clicks: Number(metrics?.clicks || 0),
        spend: micros(metrics?.costMicros),
        conversions: Number(metrics?.conversions || 0),
        ctr: Number(metrics?.ctr || 0),
        cpc: micros(metrics?.averageCpc),
        cost_per_conversion: micros(metrics?.costPerConversion),
      };
    });

    const now = new Date().toISOString();
    const [credentialUpdate, integrationUpdate] = await Promise.all([
      admin.from("credentials").update({ last_used: now }).eq("id", credential.id),
      admin.from("integrations").update({ last_sync: now, last_error: null, updated_at: now }).eq("id", integration.id),
    ]);
    if (credentialUpdate.error || integrationUpdate.error) {
      throw new HealthFailure("persistence", 500, "Google Ads provider proof persistence failed");
    }

    return reply(200, {
      success: true,
      provider: "google_ads",
      api_version: API_VERSION,
      verified_at: now,
      date_range: range,
      integration_id: integrationId,
      customer: {
        id: String(customer.id),
        descriptive_name: customer.descriptiveName ?? null,
        currency_code: customer.currencyCode ?? null,
        time_zone: customer.timeZone ?? null,
      },
      campaigns,
      canonical_conversion: {
        id: String(conversion.id),
        name: conversion.name ?? null,
        status: conversion.status ?? null,
        type: conversion.type ?? null,
        category: conversion.category ?? null,
        origin: conversion.origin ?? null,
        primary_for_goal: conversion.primaryForGoal,
      },
    });
  } catch (error) {
    const failure = normalizeFailure(error);
    const message = failure.message.replace(/\s+/g, " ").slice(0, 500);
    if (integrationId) {
      const { error: persistError } = await admin.from("integrations")
        .update({ last_error: message, updated_at: new Date().toISOString() })
        .eq("id", integrationId);
      if (persistError) console.error("[google-ads-health] failed to persist bounded health error");
    }
    console.error("[google-ads-health]", failure.kind, message);
    return reply(failure.status, {
      success: false,
      provider: "google_ads",
      api_version: API_VERSION,
      kind: failure.kind,
      message,
    });
  }
});
