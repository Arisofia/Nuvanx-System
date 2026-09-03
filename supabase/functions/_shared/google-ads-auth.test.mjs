import { describe, expect, it, vi } from "vitest";
import {
  GoogleAdsAuthFailure,
  googleAdsRefreshConfigState,
  mintGoogleAdsServiceAccountAccessToken,
  parseGoogleAdsServiceAccount,
  resolveGoogleAdsAuth,
} from "./google-ads-auth.ts";

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function generatedServiceAccount() {
  const keys = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keys.privateKey));
  let binary = "";
  for (const byte of pkcs8) binary += String.fromCharCode(byte);
  const encoded = btoa(binary).match(/.{1,64}/g)?.join("\n") || "";
  return JSON.stringify({
    type: "service_account",
    client_email: "runtime-auth-test@example.iam.gserviceaccount.com",
    private_key: `-----BEGIN PRIVATE KEY-----\n${encoded}\n-----END PRIVATE KEY-----\n`,
    token_uri: "https://oauth2.googleapis.com/token",
  });
}

describe("shared Google Ads runtime auth", () => {
  it("classifies refresh configuration deterministically", () => {
    expect(googleAdsRefreshConfigState({})).toBe("absent");
    expect(googleAdsRefreshConfigState({ oauthClientId: "id" })).toBe("partial");
    expect(googleAdsRefreshConfigState({
      oauthClientId: "id",
      oauthClientSecret: "secret",
      oauthRefreshToken: "refresh",
    })).toBe("complete");
  });

  it("fails closed on partial OAuth refresh configuration instead of falling back", async () => {
    await expect(resolveGoogleAdsAuth({
      oauthClientId: "id",
      serviceAccountRaw: await generatedServiceAccount(),
    })).rejects.toMatchObject({
      name: "GoogleAdsAuthFailure",
      kind: "configuration",
      status: 500,
    });
  });

  it("prefers a complete OAuth refresh identity and rejects credential-bearing redirects", async () => {
    const fetchImpl = vi.fn(async (_input, init) => {
      expect(init?.redirect).toBe("error");
      expect(String(init?.body)).toContain("grant_type=refresh_token");
      return jsonResponse(200, { access_token: "oauth-access" });
    });

    const result = await resolveGoogleAdsAuth({
      oauthClientId: "client-id",
      oauthClientSecret: "client-secret",
      oauthRefreshToken: "refresh-token",
      serviceAccountRaw: await generatedServiceAccount(),
    }, fetchImpl);

    expect(result).toEqual({ token: "oauth-access", mode: "oauth_refresh" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("falls back to service account only when OAuth refresh configuration is absent", async () => {
    const serviceAccountRaw = await generatedServiceAccount();
    const fetchImpl = vi.fn(async (_input, init) => {
      expect(init?.redirect).toBe("error");
      expect(String(init?.body)).toContain("urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer");
      return jsonResponse(200, { access_token: "service-access" });
    });

    const result = await resolveGoogleAdsAuth({ serviceAccountRaw }, fetchImpl);
    expect(result).toEqual({ token: "service-access", mode: "service_account" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-canonical service-account token endpoint before any network call", async () => {
    const raw = JSON.stringify({
      client_email: "runtime-auth-test@example.iam.gserviceaccount.com",
      private_key: "not-used",
      token_uri: "https://example.invalid/token",
    });
    expect(() => parseGoogleAdsServiceAccount(raw)).toThrow(GoogleAdsAuthFailure);

    const fetchImpl = vi.fn();
    await expect(mintGoogleAdsServiceAccountAccessToken(raw, fetchImpl)).rejects.toMatchObject({
      kind: "configuration",
      status: 500,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not expose OAuth provider payloads in failures", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(400, {
      error: "invalid_grant",
      error_description: "sensitive-provider-detail",
    }));

    await expect(resolveGoogleAdsAuth({
      oauthClientId: "client-id",
      oauthClientSecret: "client-secret",
      oauthRefreshToken: "refresh-token",
    }, fetchImpl)).rejects.toSatisfy((error) => {
      expect(error).toBeInstanceOf(GoogleAdsAuthFailure);
      expect(String(error?.message)).not.toContain("sensitive-provider-detail");
      expect(String(error?.message)).not.toContain("invalid_grant");
      return true;
    });
  });
});
