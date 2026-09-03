import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  GoogleAdsAuthFailure,
  resolveGoogleAdsAuth,
} from "../_shared/google-ads-auth.ts";
import { parseServiceAccount } from "./parse-service-account.ts";

export { parseServiceAccount };

declare const Deno: any;

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").trim();
const SERVICE_ROLE = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
const ENCRYPTION_KEY = (Deno.env.get("ENCRYPTION_KEY") || "").trim();
const SERVICE_ACCOUNT_RAW = (Deno.env.get("GOOGLE_ADS_SERVICE_ACCOUNT") || "").trim();
const OAUTH_CLIENT_ID = (Deno.env.get("GOOGLE_ADS_CLIENT_ID") || "").trim();
const OAUTH_CLIENT_SECRET = (Deno.env.get("GOOGLE_ADS_CLIENT_SECRET") || "").trim();
const OAUTH_REFRESH_TOKEN = (Deno.env.get("GOOGLE_ADS_REFRESH_TOKEN") || "").trim();
const LOGIN_CUSTOMER_ID_ENV = (Deno.env.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID") || "").replace(/\D/g, "");
const API_VERSION = "v25";
const CANONICAL_CONVERSION_ACTION_ID = "7713427085";
const LOCAL_CONVERSION_ACTION_ID = "7717850116";
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

function validateDeveloperToken(value: unknown): string {
  const token = String(value ?? "").trim();
  if (!token || token.length > 512) {
    throw new HealthFailure("request", 422, "Google Ads developer token is missing or too long");
  }
  if (token.startsWith("{") || token.includes("private_key") || token.includes("client_email")) {
    throw new HealthFailure("request", 422, "Google Ads developer token slot contains a service-account payload");
  }
  if (!/^[A-Za-z0-9._~-]+$/.test(token)) {
    throw new HealthFailure("request", 422, "Google Ads developer token contains unsupported characters");
  }
  return token;
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

function bytesToHex(bytes: Uint8Array<ArrayBuffer>): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function deriveCredentialKey(
  salt: Uint8Array<ArrayBuffer>,
  usage: "encrypt" | "decrypt",
): Promise<CryptoKey> {
  if (!ENCRYPTION_KEY) throw new HealthFailure("configuration", 500, "Credential encryption key unavailable");
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(ENCRYPTION_KEY),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    [usage],
  );
}

async function encryptCredential(secret: string): Promise<string> {
  if (!secret) throw new HealthFailure("configuration", 500, "Google Ads developer credential is empty");
  const salt = new Uint8Array(new ArrayBuffer(16));
  crypto.getRandomValues(salt);
  const iv = new Uint8Array(new ArrayBuffer(12));
  crypto.getRandomValues(iv);
  const key = await deriveCredentialKey(salt, "encrypt");
  const sealed = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(secret),
  ));
  const tagLength = 16;
  if (sealed.length <= tagLength) throw new HealthFailure("configuration", 500, "Google Ads credential encryption failed");
  const ciphertext = sealed.slice(0, sealed.length - tagLength);
  const tag = sealed.slice(sealed.length - tagLength);
  return [salt, iv, tag, ciphertext].map(bytesToHex).join(":");
}

async function decryptCredential(encoded: string): Promise<string> {
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
  const key = await deriveCredentialKey(salt, "decrypt");
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, combined);
    return new TextDecoder().decode(plain).trim();
  } catch {
    throw new HealthFailure("configuration", 500, "Google Ads developer credential decryption failed");
  }
}

function providerError(status: number, payload: unknown): HealthFailure {
  const value = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
  const providerStatus = String(value.status || "").slice(0, 80);
  const message = String(value.message || "").replace(/\s+/g, " ").slice(0, 300);
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
    let payload: any;
    try {
      payload = await response.json();
    } catch {
      throw new HealthFailure(
        "provider",
        502,
        `Google Ads API returned invalid non-JSON payload (HTTP ${response.status})`,
      );
    }

    if (!response.ok || payload?.error) throw providerError(response.status, payload);
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new HealthFailure("provider", 502, "Google Ads API returned non-object payload");
    }

    let resultsArray: unknown[];
    if (payload.results === undefined) resultsArray = [];
    else if (Array.isArray(payload.results)) resultsArray = payload.results;
    else throw new HealthFailure("provider", 502, "Google Ads API results field is not an array");

    rows.push(...resultsArray);
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
  if (error instanceof GoogleAdsAuthFailure) {
    return new HealthFailure(error.kind, error.status, error.message);
  }
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

  const operation = cleanSelector(body.operation) || "health";
  if (operation !== "health" && operation !== "provision") {
    return reply(422, { success: false, kind: "request", message: "Unsupported Google Ads health operation" });
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
  if (operation === "provision" && selectors[0][0] !== "integration_id") {
    return reply(422, {
      success: false,
      kind: "request",
      message: "Google Ads provisioning requires an exact integration_id",
    });
  }

  let integrationId = "";
  try {
    const [selectorKey, selectorValue] = selectors[0];
    let integrationQuery = admin
      .from("integrations")
      .select("id,user_id,clinic_id,metadata,status")
      .eq("service", "google_ads");
    if (selectorKey === "integration_id") {
      integrationQuery = integrationQuery.eq("id", selectorValue);
    } else {
      integrationQuery = integrationQuery.eq("status", "connected");
      if (selectorKey === "user_id") integrationQuery = integrationQuery.eq("user_id", selectorValue);
      if (selectorKey === "clinic_id") integrationQuery = integrationQuery.eq("clinic_id", selectorValue);
    }
    const { data: integrations, error: integrationError } = await integrationQuery.limit(2);
    if (integrationError) throw new HealthFailure("configuration", 500, "Google Ads integration lookup failed");
    if (!Array.isArray(integrations) || integrations.length !== 1) {
      throw new HealthFailure("validation", 424, "Google Ads integration selector did not resolve exactly one eligible integration");
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

    let credential: { id: string; encrypted_key: string } | null = null;
    let developerToken = "";
    if (operation === "provision") {
      developerToken = validateDeveloperToken(body.developer_token);
    } else {
      const { data: storedCredential, error: credentialError } = await admin
        .from("credentials")
        .select("id,encrypted_key")
        .eq("user_id", integration.user_id)
        .eq("service", "google_ads")
        .maybeSingle();
      if (credentialError || !storedCredential?.encrypted_key) {
        throw new HealthFailure("configuration", 500, "Google Ads developer credential not found");
      }
      credential = storedCredential;
      developerToken = await decryptCredential(String(storedCredential.encrypted_key));
      if (!developerToken) throw new HealthFailure("configuration", 500, "Google Ads developer credential is empty");
    }

    const googleAuth = await resolveGoogleAdsAuth({
      serviceAccountRaw: SERVICE_ACCOUNT_RAW,
      oauthClientId: OAUTH_CLIENT_ID,
      oauthClientSecret: OAUTH_CLIENT_SECRET,
      oauthRefreshToken: OAUTH_REFRESH_TOKEN,
    });
    const accessToken = googleAuth.token;
    const canonicalActionId = customerId === "8201489748" ? LOCAL_CONVERSION_ACTION_ID : CANONICAL_CONVERSION_ACTION_ID;

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
        WHERE conversion_action.id = ${canonicalActionId}
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
    if (!conversion || String(conversion.id || "") !== canonicalActionId) {
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
    if (operation === "provision") {
      const encryptedKey = await encryptCredential(developerToken);
      const { data: committedCredentialId, error: commitError } = await admin.rpc(
        "nvx_commit_google_ads_credential_provision",
        {
          p_integration_id: integration.id,
          p_encrypted_key: encryptedKey,
          p_committed_at: now,
        },
      );
      if (commitError || !committedCredentialId) {
        throw new HealthFailure("persistence", 500, "Google Ads atomic credential provision persistence failed");
      }
    } else {
      const credentialUpdate = await admin
        .from("credentials")
        .update({ last_used: now })
        .eq("id", credential!.id);
      if (credentialUpdate.error) {
        throw new HealthFailure("persistence", 500, "Google Ads provider proof persistence failed");
      }

      const integrationUpdate = await admin.from("integrations").update({
        status: "connected",
        last_sync: now,
        last_error: null,
        updated_at: now,
      }).eq("id", integration.id);
      if (integrationUpdate.error) {
        throw new HealthFailure("persistence", 500, "Google Ads provider proof persistence failed");
      }
    }

    return reply(200, {
      success: true,
      provider: "google_ads",
      api_version: API_VERSION,
      auth_mode: googleAuth.mode,
      operation,
      credential_provisioned: operation === "provision",
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
