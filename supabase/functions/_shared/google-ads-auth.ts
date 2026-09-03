export type GoogleAdsAuthMode = "oauth_refresh" | "service_account";

export type GoogleAdsAuth = {
  token: string;
  mode: GoogleAdsAuthMode;
};

export type GoogleAdsAuthConfig = {
  serviceAccountRaw?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
  oauthRefreshToken?: string;
};

type AuthFailureKind = "configuration" | "oauth";

type FetchLike = typeof fetch;

const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";
const GOOGLE_ADS_SCOPE = "https://www.googleapis.com/auth/adwords";

export class GoogleAdsAuthFailure extends Error {
  kind: AuthFailureKind;
  status: number;

  constructor(kind: AuthFailureKind, status: number, message: string) {
    super(message);
    this.name = "GoogleAdsAuthFailure";
    this.kind = kind;
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

export function googleAdsRefreshConfigState(config: GoogleAdsAuthConfig): "absent" | "partial" | "complete" {
  const values = [config.oauthClientId, config.oauthClientSecret, config.oauthRefreshToken].map(clean);
  const present = values.filter(Boolean).length;
  if (present === 0) return "absent";
  if (present === values.length) return "complete";
  return "partial";
}

export function parseGoogleAdsServiceAccount(rawValue: string): Record<string, any> {
  const raw = clean(rawValue);
  if (!raw) throw new GoogleAdsAuthFailure("configuration", 500, "Google Ads service account not configured");

  const candidates: string[] = [];
  const add = (value: string) => {
    const valueClean = clean(value);
    if (valueClean && !candidates.includes(valueClean)) candidates.push(valueClean);
  };

  add(raw);
  if (raw.startsWith("GOOGLE_ADS_SERVICE_ACCOUNT=")) add(raw.slice("GOOGLE_ADS_SERVICE_ACCOUNT=".length));
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) add(raw.slice(1, -1));
  if (raw.startsWith("base64:") || raw.startsWith("b64:")) add(raw.split(":", 2)[1] || "");
  if (raw.includes('\\"')) add(raw.replaceAll('\\"', '"'));

  for (const candidate of [...candidates]) {
    if ((candidate.startsWith('"') && candidate.endsWith('"')) || (candidate.startsWith("'") && candidate.endsWith("'"))) {
      add(candidate.slice(1, -1));
    }
    if (candidate.includes('\\"')) add(candidate.replaceAll('\\"', '"'));
  }

  for (const candidate of [...candidates]) {
    const compact = candidate.replace(/\s+/g, "");
    const padded = compact + "=".repeat((4 - (compact.length % 4)) % 4);
    for (const encoded of [padded, padded.replaceAll("-", "+").replaceAll("_", "/")]) {
      try {
        add(atob(encoded));
      } catch {
        // Not base64; continue with other representations.
      }
    }
  }

  for (const candidate of candidates) {
    try {
      let parsed: any = JSON.parse(candidate);
      if (typeof parsed === "string") parsed = JSON.parse(parsed);
      if (!isRecord(parsed) || !clean(parsed.client_email) || !clean(parsed.private_key)) continue;
      const tokenUri = clean(parsed.token_uri || GOOGLE_TOKEN_URI);
      if (tokenUri !== GOOGLE_TOKEN_URI) {
        throw new GoogleAdsAuthFailure(
          "configuration",
          500,
          "Google Ads service-account token_uri is not the canonical Google OAuth endpoint",
        );
      }
      return parsed;
    } catch (error) {
      if (error instanceof GoogleAdsAuthFailure) throw error;
      // Try next representation.
    }
  }

  throw new GoogleAdsAuthFailure("configuration", 500, "Google Ads service account is malformed");
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
  const compact = String(pem || "")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  if (!compact) {
    throw new GoogleAdsAuthFailure("configuration", 500, "Google Ads service-account private key unavailable");
  }
  let binary: string;
  try {
    binary = atob(compact);
  } catch {
    throw new GoogleAdsAuthFailure("configuration", 500, "Google Ads service-account private key is malformed");
  }
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function readToken(response: Response, label: string): Promise<string> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Keep provider payload private; status is sufficient for the diagnostic.
  }
  const token = isRecord(payload) ? clean(payload.access_token) : "";
  if (!response.ok || !token) {
    throw new GoogleAdsAuthFailure("oauth", 424, `${label} failed HTTP ${response.status}`);
  }
  return token;
}

export async function mintGoogleAdsRefreshAccessToken(
  config: GoogleAdsAuthConfig,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const clientId = clean(config.oauthClientId);
  const clientSecret = clean(config.oauthClientSecret);
  const refreshToken = clean(config.oauthRefreshToken);
  if (!clientId || !clientSecret || !refreshToken) {
    throw new GoogleAdsAuthFailure("configuration", 500, "Google Ads OAuth refresh configuration is incomplete");
  }

  let response: Response;
  try {
    response = await fetchImpl(GOOGLE_TOKEN_URI, {
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }).toString(),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new GoogleAdsAuthFailure("oauth", 424, "Google OAuth refresh token exchange failed");
  }
  return readToken(response, "Google OAuth refresh token exchange");
}

export async function mintGoogleAdsServiceAccountAccessToken(
  rawServiceAccount: string,
  fetchImpl: FetchLike = fetch,
  now: () => number = () => Date.now(),
): Promise<string> {
  const serviceAccount = parseGoogleAdsServiceAccount(rawServiceAccount);
  const email = clean(serviceAccount.client_email);
  const privateKey = String(serviceAccount.private_key || "");
  const issuedAt = Math.floor(now() / 1000);
  const header = base64UrlText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64UrlText(JSON.stringify({
    iss: email,
    scope: GOOGLE_ADS_SCOPE,
    aud: GOOGLE_TOKEN_URI,
    iat: issuedAt,
    exp: issuedAt + 3600,
  }));
  const signingInput = `${header}.${claims}`;

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "pkcs8",
      pemBytes(privateKey),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch (error) {
    if (error instanceof GoogleAdsAuthFailure) throw error;
    throw new GoogleAdsAuthFailure("configuration", 500, "Google Ads service-account private key import failed");
  }

  let signature: Uint8Array;
  try {
    signature = new Uint8Array(await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      key,
      new TextEncoder().encode(signingInput),
    ));
  } catch {
    throw new GoogleAdsAuthFailure("configuration", 500, "Google Ads service-account assertion signing failed");
  }
  const assertion = `${signingInput}.${base64Url(signature)}`;

  let response: Response;
  try {
    response = await fetchImpl(GOOGLE_TOKEN_URI, {
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new GoogleAdsAuthFailure("oauth", 424, "Google service-account OAuth token exchange failed");
  }
  return readToken(response, "Google service-account OAuth token exchange");
}

export async function resolveGoogleAdsAuth(
  config: GoogleAdsAuthConfig,
  fetchImpl: FetchLike = fetch,
): Promise<GoogleAdsAuth> {
  const refreshState = googleAdsRefreshConfigState(config);
  if (refreshState === "partial") {
    throw new GoogleAdsAuthFailure("configuration", 500, "Google Ads OAuth refresh configuration is incomplete");
  }
  if (refreshState === "complete") {
    return {
      token: await mintGoogleAdsRefreshAccessToken(config, fetchImpl),
      mode: "oauth_refresh",
    };
  }

  if (clean(config.serviceAccountRaw)) {
    return {
      token: await mintGoogleAdsServiceAccountAccessToken(clean(config.serviceAccountRaw), fetchImpl),
      mode: "service_account",
    };
  }

  throw new GoogleAdsAuthFailure("configuration", 500, "No Google Ads OAuth mode is configured");
}
