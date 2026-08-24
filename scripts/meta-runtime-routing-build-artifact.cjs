'use strict';

const fs = require('node:fs');

function replaceBetween(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) throw new Error(`Unable to locate ${label}`);
  return `${source.slice(0, start)}${replacement.trimEnd()}\n\n${source.slice(end)}`;
}

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`);
  return source.replace(before, after);
}

function patchFunctionBody(source, functionStart, functionEnd, transform, label) {
  const start = source.indexOf(functionStart);
  const end = source.indexOf(functionEnd, start + functionStart.length);
  if (start < 0 || end < 0 || end <= start) throw new Error(`Unable to locate ${label}`);
  const block = source.slice(start, end);
  return `${source.slice(0, start)}${transform(block)}${source.slice(end)}`;
}

const apiPath = 'supabase/functions/api/index.ts';
let api = fs.readFileSync(apiPath, 'utf8');

const metaFetchReplacement = `function metaGraphSecretCandidates(appSecretOverride?: string | null): Array<string | null> {
  if (appSecretOverride !== undefined) return [appSecretOverride || null];
  const values = [META_CANONICAL_APP_SECRET, META_APP_SECRET]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
  return [...new Set(values)].map((value) => value || null).concat(values.length === 0 ? [null] : []);
}

function isInvalidAppsecretProof(body: any): boolean {
  const message = String(body?.error?.message ?? body?.message ?? '').toLowerCase();
  return message.includes('appsecret_proof') || message.includes('app secret proof');
}

export async function metaFetch(path: string, params: Record<string, string>, token: string, appSecretOverride?: string | null) {
  const candidates = metaGraphSecretCandidates(appSecretOverride);
  let lastError: { status: number; body: any; text: string } | null = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const url = new URL(\`${META_GRAPH}\${path}\`);
    url.searchParams.set('access_token', token);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const appSecret = candidates[index];
    if (appSecret) url.searchParams.set('appsecret_proof', await computeAppsecretProof(token, appSecret));

    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(20_000) });
    const { data, text } = await parseJsonOrText(response);
    if (response.ok) return data;

    lastError = { status: response.status, body: data, text };
    const canRetrySecret = index + 1 < candidates.length && isInvalidAppsecretProof(data);
    if (!canRetrySecret) break;
  }

  const errorBody = lastError?.body ?? {};
  const e = errorBody?.error ?? {};
  const errorMessageFromBody = errorBody?.message;
  const textValue = typeof lastError?.text === 'string' ? lastError.text : '';
  const metaErrorMessage = e.message ?? errorMessageFromBody ?? (textValue.trim() ? textValue : \`Meta API \${lastError?.status ?? 502}\`);
  throw new Error(\`${metaErrorMessage} (code=\${e.code ?? '?'}, sub=\${e.error_subcode ?? '?'}, type=\${e.type ?? '?'})\`);
}`;
api = replaceBetween(api, 'export async function metaFetch(', 'async function metaFetchAll(', metaFetchReplacement, 'metaFetch');

const metaPostReplacement = `async function metaPost(path: string, body: any, token: string, appSecretOverride?: string | null) {
  const candidates = metaGraphSecretCandidates(appSecretOverride);
  let lastError: { status: number; statusText: string; data: any; text: string } | null = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const url = new URL(\`${META_GRAPH}\${path}\`);
    url.searchParams.set('access_token', token);
    const appSecret = candidates[index];
    if (appSecret) url.searchParams.set('appsecret_proof', await computeAppsecretProof(token, appSecret));

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });

    const { data, text } = await parseJsonOrText(response);
    if (response.ok) return data;

    lastError = { status: response.status, statusText: response.statusText, data, text };
    const canRetrySecret = index + 1 < candidates.length && isInvalidAppsecretProof(data);
    if (!canRetrySecret) break;
  }

  const err = lastError?.data?.error ?? {};
  const message = err.message ?? lastError?.data?.message ?? lastError?.text ?? \`Meta API \${lastError?.status ?? 502}\`;
  console.error('[CAPI] Meta Graph API error', {
    path,
    status: lastError?.status ?? 502,
    statusText: lastError?.statusText ?? '',
    message,
    code: err?.code ?? null,
    type: err?.type ?? null,
    fbtrace_id: err?.fbtrace_id ?? null,
  });
  throw new Error(message);
}`;
api = replaceBetween(api, 'async function metaPost(', 'async function trackMetaWhatsappConversion(', metaPostReplacement, 'metaPost');

const resolverReplacement = `async function resolveMetaCreds(adminClient: any, userId: string, qAccountId: string) {
  const { data: integrations } = await adminClient
    .from('integrations')
    .select('service, metadata, status, updated_at')
    .eq('user_id', userId)
    .in('service', ['meta_ads', 'meta'])
    .eq('status', 'connected');

  const connected = integrations ?? [];
  const requestedAccountIds = normalizeMetaAccountIds(qAccountId);
  const matchingRows = requestedAccountIds.length > 0
    ? connected.filter((row: any) => {
        const metadata = row?.metadata ?? {};
        const ids = normalizeMetaAccountIds(
          metadata.adAccountIds ?? metadata.ad_account_ids ?? metadata.adAccountId ?? metadata.ad_account_id ?? '',
        );
        return requestedAccountIds.some((id) => ids.includes(id));
      })
    : connected;

  const intg = selectCanonicalMetaIntegration(matchingRows);
  if (!intg) {
    return { notConnected: true, accessToken: '', adAccountIds: [] as string[], adAccountId: '', decryptionError: '' };
  }

  const credentialService = intg.service === 'meta_ads' ? 'meta_ads' : 'meta';
  const { data: credRow } = await adminClient.from('credentials')
    .select('encrypted_key')
    .eq('user_id', userId)
    .eq('service', credentialService)
    .maybeSingle();
  if (!credRow?.encrypted_key) {
    return { notConnected: true, accessToken: '', adAccountIds: [] as string[], adAccountId: '', decryptionError: '' };
  }

  let accessToken = '';
  let decryptionError = '';
  try {
    accessToken = await decryptCred(credRow.encrypted_key);
  } catch (err: any) {
    decryptionError = err?.message ?? 'Failed to decrypt Meta credential';
  }

  const metadata = intg.metadata ?? {};
  const metadataRawAccountIds = metadata.adAccountIds ?? metadata.ad_account_ids ?? metadata.adAccountId ?? metadata.ad_account_id ?? '';
  const metadataAccountIds = normalizeMetaAccountIds(metadataRawAccountIds);
  const adAccountIds = requestedAccountIds.length > 0 ? requestedAccountIds : metadataAccountIds;

  let pixelId = metadata.pixelId ?? metadata.pixel_id ?? '';
  const activeAccountId = adAccountIds[0] ?? '';
  const mappingStr = Deno.env.get('META_PIXEL_MAPPING');
  if (mappingStr) {
    try {
      const mapping = JSON.parse(mappingStr);
      if (mapping[activeAccountId]) pixelId = mapping[activeAccountId];
    } catch (e) {
      console.error('[CAPI-ROUTING] Error parsing META_PIXEL_MAPPING:', e);
    }
  }

  if (!pixelId && !mappingStr) {
    console.warn(\`[CAPI-ROUTING] No pixel mapping found for account \${activeAccountId}\`);
  }

  console.log('[CAPI-ROUTING] Meta stack selected', {
    service: credentialService,
    accountId: activeAccountId,
    hasPixel: Boolean(pixelId),
  });

  return {
    notConnected: false,
    accessToken,
    adAccountIds,
    adAccountId: activeAccountId,
    pixelId,
    pageId: metadata.pageId ?? metadata.page_id ?? '',
    igId: metadata.igBusinessAccountId ?? metadata.ig_business_account_id ?? '',
    credentialService,
    decryptionError,
  } as const;
}`;
api = replaceBetween(api, 'async function resolveMetaCreds(', 'function selectCanonicalMetaIntegration(', resolverReplacement, 'resolveMetaCreds');

const selectorReplacement = `function selectCanonicalMetaIntegration(rows: any[]) {
  return [...rows].sort((a: any, b: any) => {
    const score = (row: any) => {
      const metadata = row?.metadata ?? {};
      let value = 0;
      if (row?.status === 'connected') value += 100;
      if (row?.service === 'meta_ads') value += 50;
      if (row?.service === 'meta_ads' && metadata?.canonical === true) value += 100;
      if (String(metadata.pageId ?? metadata.page_id ?? '').trim()) value += 5;
      return value;
    };
    const scoreDelta = score(b) - score(a);
    if (scoreDelta !== 0) return scoreDelta;
    return String(b?.updated_at ?? '').localeCompare(String(a?.updated_at ?? ''));
  })[0] ?? null;
}`;
api = replaceBetween(api, 'function selectCanonicalMetaIntegration(', 'function validateMetaCredentialResult(', selectorReplacement, 'selectCanonicalMetaIntegration');

const oldIntegrationLookup = `  const { data: integ } = await adminClient.from('integrations')
    .select('metadata')
    .eq('user_id', userId)
    .eq('service', 'meta')
    .maybeSingle();

  const meta = (integ?.metadata ?? {}) as Record<string, any>;`;
const newIntegrationLookup = `  const { data: integrations } = await adminClient.from('integrations')
    .select('service, metadata, status, updated_at')
    .eq('user_id', userId)
    .in('service', ['meta_ads', 'meta'])
    .eq('status', 'connected');

  const integ = selectCanonicalMetaIntegration(integrations ?? []);
  const meta = (integ?.metadata ?? {}) as Record<string, any>;`;
api = patchFunctionBody(api, 'async function handleMetaOrganicGet(', 'async function handleMetaIgGet(', (block) => replaceOnce(block, oldIntegrationLookup, newIntegrationLookup, 'organic integration lookup'), 'handleMetaOrganicGet');
api = patchFunctionBody(api, 'async function handleMetaIgGet(', 'function parseMetaBackfillDates(', (block) => replaceOnce(block, oldIntegrationLookup, newIntegrationLookup, 'ig integration lookup'), 'handleMetaIgGet');

api = patchFunctionBody(api, 'async function processWhatsappWebhookMessage(', 'function throwIfError(', (block) => {
  const start = `  // Trigger Meta CAPI Contact event\n  (async () => {\n    try {\n      const { data: credRow } = await adminClient.from('credentials')\n        .select('encrypted_key')\n        .eq('user_id', userId)\n        .eq('service', 'meta')\n        .single();\n      \n      if (credRow) {\n        const accessToken = await publicRouteHelpers.decryptCred(credRow.encrypted_key);\n        // For WhatsApp webhooks we don't have IP/UA context, but we have phone\n        await trackMetaConversion('contact', accessToken, {\n          pixelId: pixelId || undefined,\n          eventId: \`wa_\${message.id}\`,\n          phone: phone || null,\n          externalId: userId,\n        });\n      }\n    } catch (err) {\n      console.error('[CAPI] WhatsApp webhook tracking failed:', err);\n    }\n  })();`;
  const replacement = `  // Trigger Meta CAPI Contact event using the same canonical/legacy resolver as the rest of the runtime.\n  (async () => {\n    try {\n      const creds = await resolveMetaCreds(adminClient, userId, '');\n      const validation = validateMetaCredentialResult(creds);\n      if (!validation.ok || !creds.accessToken) return;\n      await trackMetaConversion('contact', creds.accessToken, {\n        pixelId: pixelId || creds.pixelId || undefined,\n        eventId: \`wa_\${message.id}\`,\n        phone: phone || null,\n        externalId: userId,\n      });\n    } catch (err) {\n      console.error('[CAPI] WhatsApp webhook tracking failed:', err);\n    }\n  })();`;
  return replaceOnce(block, start, replacement, 'WhatsApp CAPI credential routing');
}, 'processWhatsappWebhookMessage');

fs.writeFileSync(apiPath, api);

const webPath = 'supabase/functions/web-events/index.ts';
let web = fs.readFileSync(webPath, 'utf8');
web = replaceOnce(
  web,
  'const META_APP_SECRET = Deno.env.get("META_APP_SECRET") || "";\n',
  'const META_APP_SECRET = Deno.env.get("META_APP_SECRET") || "";\nconst META_CANONICAL_APP_SECRET = Deno.env.get("META_CANONICAL_APP_SECRET") || Deno.env.get("META_REPORTING_APP_SECRET") || "";\n',
  'web-events canonical app secret',
);

const proofReplacement = `async function appsecretProof(accessToken: string, appSecret: string): Promise<string | null> {
  if (!appSecret) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(accessToken)));
  return bytesToHex(sig);
}`;
web = replaceBetween(web, 'async function appsecretProof(', 'function normalizeDigits(', proofReplacement, 'web-events appsecretProof');

const ownerReplacement = `async function resolveOwnerAndMeta(admin: any) {
  let userId = "";
  if (DEFAULT_LANDING_USER_EMAIL) {
    const { data: userByEmail } = await admin.from("users").select("id").eq("email", DEFAULT_LANDING_USER_EMAIL).maybeSingle();
    userId = userByEmail?.id || "";
  }

  const scoreIntegration = (row: any) => {
    const metadata = row?.metadata ?? {};
    if (row?.service === "meta_ads" && metadata?.canonical === true) return 2;
    if (row?.service === "meta_ads") return 1;
    return 0;
  };

  if (!userId) {
    const { data: fallbackRows } = await admin
      .from("integrations")
      .select("user_id,service,metadata,status,updated_at")
      .in("service", ["meta_ads", "meta"])
      .eq("status", "connected")
      .order("updated_at", { ascending: false })
      .limit(20);
    const preferred = [...(fallbackRows || [])].sort((a: any, b: any) =>
      scoreIntegration(b) - scoreIntegration(a) || String(b?.updated_at || "").localeCompare(String(a?.updated_at || ""))
    )[0];
    userId = preferred?.user_id || "";
  }

  if (!userId) throw new Error("No Meta owner user resolved");

  const { data: integrations } = await admin
    .from("integrations")
    .select("service,metadata,status,updated_at")
    .eq("user_id", userId)
    .in("service", ["meta_ads", "meta"])
    .eq("status", "connected")
    .order("updated_at", { ascending: false });

  const integration = [...(integrations || [])].sort((a: any, b: any) =>
    scoreIntegration(b) - scoreIntegration(a) || String(b?.updated_at || "").localeCompare(String(a?.updated_at || ""))
  )[0];
  if (!integration) throw new Error("Connected Meta integration not found");

  const credentialService = integration.service === "meta_ads" ? "meta_ads" : "meta";
  const { data: cred } = await admin
    .from("credentials")
    .select("encrypted_key")
    .eq("user_id", userId)
    .eq("service", credentialService)
    .maybeSingle();
  if (!cred?.encrypted_key) throw new Error("Meta credential not found");

  const metadata = integration.metadata || {};
  const pixelId = normalizeDigits(metadata.pixelId || metadata.pixel_id || META_PIXEL_ID);
  if (!pixelId) throw new Error("Meta Pixel ID not configured");

  const appSecret = credentialService === "meta_ads" ? META_CANONICAL_APP_SECRET : META_APP_SECRET;
  return { pixelId, accessToken: await decryptCred(cred.encrypted_key), appSecret, credentialService };
}`;
web = replaceBetween(web, 'async function resolveOwnerAndMeta(', 'function getHeaderIp(', ownerReplacement, 'web-events resolveOwnerAndMeta');

web = replaceOnce(
  web,
  'async function sendMetaCapi(params: { pixelId: string; accessToken: string; body: any; req: Request }) {\n  const { pixelId, accessToken, body, req } = params;',
  'async function sendMetaCapi(params: { pixelId: string; accessToken: string; appSecret: string; body: any; req: Request }) {\n  const { pixelId, accessToken, appSecret, body, req } = params;',
  'web-events sendMetaCapi signature',
);
web = replaceOnce(web, '  const proof = await appsecretProof(accessToken);', '  const proof = await appsecretProof(accessToken, appSecret);', 'web-events proof call');
web = replaceOnce(
  web,
  'const result = await sendMetaCapi({ pixelId: meta.pixelId, accessToken: meta.accessToken, body, req });',
  'const result = await sendMetaCapi({ pixelId: meta.pixelId, accessToken: meta.accessToken, appSecret: meta.appSecret, body, req });',
  'web-events send call',
);
fs.writeFileSync(webPath, web);

console.log('META_RUNTIME_ROUTING_ARTIFACT=PASS');
