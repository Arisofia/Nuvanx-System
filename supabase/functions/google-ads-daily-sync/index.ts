import { createClient } from "jsr:@supabase/supabase-js@2";
import { GoogleAdsAuthFailure, resolveGoogleAdsAuth } from "../_shared/google-ads-auth.ts";

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
const MAX_PAGES = 50;
const MAX_RANGE_DAYS = 92;

type FailureKind = "request" | "configuration" | "oauth" | "provider" | "persistence";

class SyncFailure extends Error {
  kind: FailureKind;
  status: number;
  constructor(kind: FailureKind, status: number, message: string) {
    super(message);
    this.name = "SyncFailure";
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

function digits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function secretMatches(received: string, expected: string): Promise<boolean> {
  if (!received || !expected) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(received)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new SyncFailure("configuration", 500, "Malformed encrypted Google Ads developer credential");
  }
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  return bytes;
}

async function decryptCredential(encoded: string): Promise<string> {
  if (!ENCRYPTION_KEY) throw new SyncFailure("configuration", 500, "Credential encryption key unavailable");
  const parts = String(encoded || "").split(":");
  if (parts.length !== 4) throw new SyncFailure("configuration", 500, "Malformed encrypted Google Ads developer credential");
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
    throw new SyncFailure("configuration", 500, "Google Ads developer credential decryption failed");
  }
}

function providerError(status: number, payload: unknown): SyncFailure {
  const value = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
  const providerStatus = String(value.status || "").slice(0, 80);
  const message = String(value.message || "").replace(/\s+/g, " ").slice(0, 300);
  return new SyncFailure(
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
  const seen = new Set<string>();
  let pageToken = "";
  let pages = 0;
  do {
    pages += 1;
    if (pages > MAX_PAGES) throw new SyncFailure("provider", 502, `Google Ads pagination exceeded ${MAX_PAGES} pages`);
    if (pageToken) {
      if (seen.has(pageToken)) throw new SyncFailure("provider", 502, "Google Ads repeated a page token");
      seen.add(pageToken);
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": developerToken,
      "Content-Type": "application/json",
    };
    if (loginCustomerId) headers["login-customer-id"] = loginCustomerId;
    const body: Record<string, unknown> = { query };
    if (pageToken) body.pageToken = pageToken;
    const response = await fetch(
      `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}/googleAds:search`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      },
    );
    let payload: any;
    try {
      payload = await response.json();
    } catch {
      throw new SyncFailure(
        "provider",
        502,
        `Google Ads API returned invalid non-JSON payload (HTTP ${response.status})`,
      );
    }
    if (!response.ok || payload?.error) throw providerError(response.status, payload);
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new SyncFailure("provider", 502, "Google Ads API returned non-object payload");
    }
    if (!isRecord(payload)) throw new SyncFailure("provider", 502, "Google Ads API returned malformed payload");
    let resultsArray: unknown[];
    if (payload.results === undefined) resultsArray = [];
    else if (Array.isArray(payload.results)) resultsArray = payload.results;
    else throw new SyncFailure("provider", 502, "Google Ads API results field is not an array");
    rows.push(...resultsArray);
    pageToken = String(payload?.nextPageToken || "").trim();
  } while (pageToken);
  return rows;
}

function micros(value: unknown): number {
  const raw = Number(value ?? 0);
  return Number.isFinite(raw) ? raw / 1_000_000 : 0;
}

function numeric(value: unknown): number {
  const raw = Number(value ?? 0);
  return Number.isFinite(raw) ? raw : 0;
}

function resolveRange(body: Record<string, any>): { from: string; to: string } {
  const today = new Date().toISOString().slice(0, 10);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(body.to || "")) ? String(body.to) : today;
  const start = new Date(`${to}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 29);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(body.from || "")) ? String(body.from) : start.toISOString().slice(0, 10);
  const days = Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  if (!Number.isFinite(days) || days < 1 || days > MAX_RANGE_DAYS) {
    throw new SyncFailure("request", 422, "Invalid Google Ads date range");
  }
  return { from, to };
}

function normalizeFailure(error: unknown, fallbackKind: FailureKind = "configuration"): SyncFailure {
  if (error instanceof SyncFailure) return error;
  if (error instanceof GoogleAdsAuthFailure) {
    return new SyncFailure(error.kind, error.status, error.message);
  }
  const status = fallbackKind === "provider" ? 502 : fallbackKind === "request" ? 422 : 500;
  return new SyncFailure(fallbackKind, status, String((error as any)?.message || "Google Ads daily sync failed"));
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply(405, { success: false, message: "Method not allowed" });
  if (!SUPABASE_URL || !SERVICE_ROLE) return reply(500, { success: false, message: "Server configuration error" });

  const bearer = String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!(await secretMatches(bearer, SERVICE_ROLE))) {
    return reply(403, { success: false, message: "Forbidden" });
  }

  let body: Record<string, any> = {};
  try {
    const raw = await req.text();
    body = raw.trim() ? JSON.parse(raw) : {};
    if (!isRecord(body)) throw new Error("not object");
  } catch {
    return reply(400, { success: false, kind: "request", message: "Invalid JSON" });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  let range: { from: string; to: string };
  try {
    range = resolveRange(body);
  } catch (error) {
    const failure = normalizeFailure(error, "request");
    return reply(failure.status, { success: false, kind: failure.kind, message: failure.message });
  }

  try {
    const googleAuth = await resolveGoogleAdsAuth({
      serviceAccountRaw: SERVICE_ACCOUNT_RAW,
      oauthClientId: OAUTH_CLIENT_ID,
      oauthClientSecret: OAUTH_CLIENT_SECRET,
      oauthRefreshToken: OAUTH_REFRESH_TOKEN,
    });
    const accessToken = googleAuth.token;
    const requestedCustomerId = digits(body.customer_id || "");
    const { data: integrations, error: integrationError } = await admin
      .from("integrations")
      .select("id,user_id,clinic_id,status,metadata")
      .eq("service", "google_ads")
      .eq("status", "connected")
      .order("created_at", { ascending: true });
    if (integrationError) throw new SyncFailure("configuration", 500, "Google Ads integration lookup failed");
    const selected = (integrations || []).filter((row: any) => {
      const customerId = digits(row?.metadata?.customerId || row?.metadata?.customer_id);
      return customerId && (!requestedCustomerId || customerId === requestedCustomerId);
    });
    if (selected.length === 0) {
      throw new SyncFailure("configuration", 424, "No connected Google Ads integration matched the request");
    }

    const tokenCache = new Map<string, string>();
    const summaries: Record<string, unknown>[] = [];
    const failures: Record<string, unknown>[] = [];

    for (const integration of selected) {
      const customerId = digits(integration?.metadata?.customerId || integration?.metadata?.customer_id);
      const loginCustomerId = digits(
        LOGIN_CUSTOMER_ID_ENV || integration?.metadata?.loginCustomerId || integration?.metadata?.login_customer_id,
      );
      const now = new Date().toISOString();
      try {
        let developerToken = tokenCache.get(String(integration.user_id)) || "";
        if (!developerToken) {
          const { data: credential, error: credentialError } = await admin
            .from("credentials")
            .select("encrypted_key")
            .eq("user_id", integration.user_id)
            .eq("service", "google_ads")
            .maybeSingle();
          if (credentialError || !credential?.encrypted_key) {
            throw new SyncFailure("configuration", 500, "Google Ads developer credential not found");
          }
          developerToken = await decryptCredential(String(credential.encrypted_key));
          tokenCache.set(String(integration.user_id), developerToken);
        }

        const query = `
          SELECT
            segments.date,
            customer.currency_code,
            campaign.id,
            campaign.name,
            campaign.status,
            campaign.advertising_channel_type,
            metrics.impressions,
            metrics.clicks,
            metrics.cost_micros,
            metrics.conversions,
            metrics.conversions_value,
            metrics.ctr,
            metrics.average_cpc,
            metrics.cost_per_conversion
          FROM campaign
          WHERE segments.date BETWEEN '${range.from}' AND '${range.to}'
          ORDER BY segments.date, campaign.id
        `;
        const providerRows = await googleAdsSearch(customerId, developerToken, accessToken, query, loginCustomerId);
        const rows = providerRows.map((row: any) => ({
          user_id: integration.user_id,
          clinic_id: integration.clinic_id || null,
          integration_id: integration.id,
          customer_id: customerId,
          campaign_id: String(row?.campaign?.id || ""),
          campaign_name: String(row?.campaign?.name || "(unnamed)"),
          date: String(row?.segments?.date || ""),
          campaign_status: row?.campaign?.status ?? null,
          campaign_type: row?.campaign?.advertisingChannelType ?? null,
          impressions: numeric(row?.metrics?.impressions),
          clicks: numeric(row?.metrics?.clicks),
          spend: micros(row?.metrics?.costMicros),
          conversions: numeric(row?.metrics?.conversions),
          conversion_value: numeric(row?.metrics?.conversionsValue),
          ctr: numeric(row?.metrics?.ctr),
          average_cpc: micros(row?.metrics?.averageCpc),
          cost_per_conversion: micros(row?.metrics?.costPerConversion),
          currency_code: row?.customer?.currencyCode ?? null,
          synced_at: now,
          updated_at: now,
        }));
        if (rows.some((row: any) => !row.campaign_id || !row.date)) {
          throw new SyncFailure("provider", 502, "Google Ads returned a row without campaign/date identity");
        }
        for (let offset = 0; offset < rows.length; offset += 500) {
          const { error: upsertError } = await admin
            .from("google_ads_daily_insights")
            .upsert(rows.slice(offset, offset + 500), { onConflict: "user_id,customer_id,campaign_id,date" });
          if (upsertError) throw new SyncFailure("persistence", 500, `Google Ads insight upsert failed: ${upsertError.message}`);
        }
        const { error: integrationUpdateError } = await admin
          .from("integrations")
          .update({ last_sync: now, last_error: null, updated_at: now })
          .eq("id", integration.id);
        if (integrationUpdateError) {
          throw new SyncFailure("persistence", 500, "Google Ads integration status update failed");
        }

        const summary = rows.reduce((acc: any, row: any) => {
          acc.impressions += row.impressions;
          acc.clicks += row.clicks;
          acc.spend += row.spend;
          acc.conversions += row.conversions;
          return acc;
        }, { customer_id: customerId, rows: rows.length, impressions: 0, clicks: 0, spend: 0, conversions: 0 });
        summary.spend = Number(summary.spend.toFixed(6));
        summary.conversions = Number(summary.conversions.toFixed(6));
        summaries.push(summary);
      } catch (error) {
        const failure = normalizeFailure(error, "provider");
        const message = failure.message.replace(/\s+/g, " ").slice(0, 500);
        await admin.from("integrations").update({ last_error: message, updated_at: now }).eq("id", integration.id);
        failures.push({ customer_id: customerId, kind: failure.kind, message });
      }
    }

    const success = failures.length === 0;
    return reply(success ? 200 : 502, {
      success,
      provider: "google_ads",
      api_version: API_VERSION,
      auth_mode: googleAuth.mode,
      date_range: range,
      accounts: summaries,
      failures,
    });
  } catch (error) {
    const failure = normalizeFailure(error, "configuration");
    return reply(failure.status, {
      success: false,
      provider: "google_ads",
      api_version: API_VERSION,
      kind: failure.kind,
      message: failure.message.replace(/\s+/g, " ").slice(0, 500),
    });
  }
});
