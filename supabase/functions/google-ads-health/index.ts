import { createClient } from "jsr:@supabase/supabase-js@2";

declare const Deno: any;

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") || "").trim();
const SERVICE_ROLE = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
const ENCRYPTION_KEY = (Deno.env.get("ENCRYPTION_KEY") || "").trim();
const SERVICE_ACCOUNT_RAW = (Deno.env.get("GOOGLE_ADS_SERVICE_ACCOUNT") || "").trim();
const LOGIN_CUSTOMER_ID_ENV = (Deno.env.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID") || "").replace(/\D/g, "");
const API_VERSION = "v25";
const CANONICAL_CONVERSION_ACTION_ID = "7713427085";
const MAX_RANGE_DAYS = 92;

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

function hexToBytes(hex: string): Uint8Array {
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) throw new Error("Malformed encrypted credential");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  return bytes;
}

async function decryptCredential(encoded: string): Promise<string> {
  if (!ENCRYPTION_KEY) throw new Error("Credential encryption key unavailable");
  const parts = String(encoded || "").split(":");
  if (parts.length !== 4) throw new Error("Malformed encrypted credential");
  const [saltHex, ivHex, tagHex, ciphertextHex] = parts;
  const salt = hexToBytes(saltHex);
  const iv = hexToBytes(ivHex);
  const tag = hexToBytes(tagHex);
  const ciphertext = hexToBytes(ciphertextHex);
  const combined = new Uint8Array(ciphertext.length + tag.length);
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
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, combined);
  return new TextDecoder().decode(plain).trim();
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlText(value: string): string {
  return base64Url(new TextEncoder().encode(value));
}

function pemBytes(pem: string): Uint8Array {
  const clean = String(pem || "")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  if (!clean) throw new Error("Google Ads service-account private key unavailable");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function googleAccessToken(serviceAccount: Record<string, any>): Promise<string> {
  const email = String(serviceAccount.client_email || "").trim();
  const tokenUri = String(serviceAccount.token_uri || "https://oauth2.googleapis.com/token").trim();
  const privateKey = String(serviceAccount.private_key || "");
  if (!email || !privateKey) throw new Error("Google Ads service account is incomplete");

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
  if (!response.ok || !token) throw new Error(`Google OAuth failed ${response.status}`);
  return token;
}

function providerError(status: number, payload: unknown): Error {
  const value = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
  const providerStatus = String(value.status || "").slice(0, 80);
  const message = String(value.message || "").replace(/\s+/g, " ").slice(0, 300);
  return new Error(`Google Ads API ${status}${providerStatus ? ` ${providerStatus}` : ""}${message ? `: ${message}` : ""}`);
}

async function googleAdsSearch(
  customerId: string,
  developerToken: string,
  accessToken: string,
  query: string,
  loginCustomerId: string,
): Promise<any[]> {
  const rows: any[] = [];
  let pageToken = "";
  do {
    const requestBody: Record<string, unknown> = { query, pageSize: 1000 };
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
    if (!Array.isArray(payload?.results)) throw new Error("Google Ads API returned malformed results");
    rows.push(...payload.results);
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
  if (!Number.isFinite(days) || days < 1 || days > MAX_RANGE_DAYS) throw new Error("Invalid Google Ads date range");
  return { from, to };
}

function micros(value: unknown): number {
  const raw = Number(value ?? 0);
  return Number.isFinite(raw) ? raw / 1_000_000 : 0;
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
  if (Number(req.headers.get("content-length") || "0") > 8192) return reply(413, { success: false, message: "Payload too large" });

  const body = await req.json().catch(() => ({}));
  if (!isRecord(body)) return reply(400, { success: false, message: "Invalid JSON" });
  let range: { from: string; to: string };
  try {
    range = resolveRange(body);
  } catch (error: any) {
    return reply(422, { success: false, message: String(error?.message || "Invalid date range") });
  }

  let integrationId = "";
  try {
    if (!SERVICE_ACCOUNT_RAW) throw new Error("Google Ads service account not configured");
    let serviceAccount: Record<string, any>;
    try {
      serviceAccount = JSON.parse(SERVICE_ACCOUNT_RAW);
    } catch {
      throw new Error("Google Ads service account is malformed");
    }

    const { data: integration, error: integrationError } = await admin
      .from("integrations")
      .select("id,user_id,metadata,status")
      .eq("service", "google_ads")
      .eq("status", "connected")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (integrationError || !integration) throw new Error("Google Ads connected integration not found");
    integrationId = String(integration.id || "");

    const customerId = digits(integration?.metadata?.customerId || integration?.metadata?.customer_id);
    if (!customerId) throw new Error("Google Ads customer id missing");
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
    if (credentialError || !credential?.encrypted_key) throw new Error("Google Ads developer credential not found");
    const developerToken = await decryptCredential(String(credential.encrypted_key));
    if (!developerToken) throw new Error("Google Ads developer credential is empty");

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
    if (!customer || String(customer.id || "") !== customerId) throw new Error("Google Ads customer identity validation failed");

    if (conversionRows.length !== 1) throw new Error("Canonical Google Ads conversion action missing");
    const conversion = conversionRows[0]?.conversionAction || null;
    if (!conversion || String(conversion.id || "") !== CANONICAL_CONVERSION_ACTION_ID) {
      throw new Error("Canonical Google Ads conversion identity mismatch");
    }
    if (conversion.primaryForGoal !== true) throw new Error("Canonical Google Ads conversion is not primary_for_goal");
    if (String(conversion.status || "").toUpperCase() !== "ENABLED") throw new Error("Canonical Google Ads conversion is not enabled");

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
      throw new Error("Google Ads provider proof persistence failed");
    }

    return reply(200, {
      success: true,
      provider: "google_ads",
      api_version: API_VERSION,
      verified_at: now,
      date_range: range,
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
  } catch (error: any) {
    const message = String(error?.message || "Google Ads health check failed").replace(/\s+/g, " ").slice(0, 500);
    if (integrationId) {
      const { error: persistError } = await admin.from("integrations")
        .update({ last_error: message, updated_at: new Date().toISOString() })
        .eq("id", integrationId);
      if (persistError) console.error("[google-ads-health] failed to persist bounded provider error");
    }
    console.error("[google-ads-health]", message);
    return reply(502, {
      success: false,
      provider: "google_ads",
      api_version: API_VERSION,
      message,
    });
  }
});
