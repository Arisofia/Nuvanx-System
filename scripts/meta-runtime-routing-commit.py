from pathlib import Path


def replace_between(source: str, start_marker: str, end_marker: str, replacement: str, label: str) -> str:
    start = source.find(start_marker)
    end = source.find(end_marker, start + len(start_marker))
    if start < 0 or end < 0 or end <= start:
        raise RuntimeError(f"Unable to locate {label}")
    return source[:start] + replacement.rstrip() + "\n\n" + source[end:]


def replace_once(source: str, before: str, after: str, label: str) -> str:
    count = source.count(before)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return source.replace(before, after, 1)


def patch_function(source: str, function_start: str, function_end: str, transform, label: str) -> str:
    start = source.find(function_start)
    end = source.find(function_end, start + len(function_start))
    if start < 0 or end < 0 or end <= start:
        raise RuntimeError(f"Unable to locate {label}")
    block = source[start:end]
    return source[:start] + transform(block) + source[end:]


api_path = Path("supabase/functions/api/index.ts")
api = api_path.read_text()

meta_fetch_replacement = r'''function metaGraphSecretCandidates(appSecretOverride?: string | null): Array<string | null> {
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
    const url = new URL(`${META_GRAPH}${path}`);
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
  const metaErrorMessage = e.message ?? errorMessageFromBody ?? (textValue.trim() ? textValue : `Meta API ${lastError?.status ?? 502}`);
  throw new Error(`${metaErrorMessage} (code=${e.code ?? '?'}, sub=${e.error_subcode ?? '?'}, type=${e.type ?? '?'})`);
}'''
api = replace_between(api, "export async function metaFetch(", "async function metaFetchAll(", meta_fetch_replacement, "metaFetch")

meta_post_replacement = r'''async function metaPost(path: string, body: any, token: string, appSecretOverride?: string | null) {
  const candidates = metaGraphSecretCandidates(appSecretOverride);
  let lastError: { status: number; statusText: string; data: any; text: string } | null = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const url = new URL(`${META_GRAPH}${path}`);
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
  const message = err.message ?? lastError?.data?.message ?? lastError?.text ?? `Meta API ${lastError?.status ?? 502}`;
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
}'''
api = replace_between(api, "async function metaPost(", "async function trackMetaWhatsappConversion(", meta_post_replacement, "metaPost")

resolver_replacement = r'''async function resolveMetaCreds(adminClient: any, userId: string, qAccountId: string) {
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
    console.warn(`[CAPI-ROUTING] No pixel mapping found for account ${activeAccountId}`);
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
}'''
api = replace_between(api, "async function resolveMetaCreds(", "function selectCanonicalMetaIntegration(", resolver_replacement, "resolveMetaCreds")

selector_replacement = r'''function selectCanonicalMetaIntegration(rows: any[]) {
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
}'''
api = replace_between(api, "function selectCanonicalMetaIntegration(", "function validateMetaCredentialResult(", selector_replacement, "selectCanonicalMetaIntegration")

old_lookup = """  const { data: integ } = await adminClient.from('integrations')
    .select('metadata')
    .eq('user_id', userId)
    .eq('service', 'meta')
    .maybeSingle();

  const meta = (integ?.metadata ?? {}) as Record<string, any>;"""
new_lookup = """  const { data: integrations } = await adminClient.from('integrations')
    .select('service, metadata, status, updated_at')
    .eq('user_id', userId)
    .in('service', ['meta_ads', 'meta'])
    .eq('status', 'connected');

  const integ = selectCanonicalMetaIntegration(integrations ?? []);
  const meta = (integ?.metadata ?? {}) as Record<string, any>;"""
api = patch_function(api, "async function handleMetaOrganicGet(", "async function handleMetaIgGet(", lambda block: replace_once(block, old_lookup, new_lookup, "organic integration lookup"), "handleMetaOrganicGet")
api = patch_function(api, "async function handleMetaIgGet(", "function parseMetaBackfillDates(", lambda block: replace_once(block, old_lookup, new_lookup, "ig integration lookup"), "handleMetaIgGet")

wa_old = r'''  // Trigger Meta CAPI Contact event
  (async () => {
    try {
      const { data: credRow } = await adminClient.from('credentials')
        .select('encrypted_key')
        .eq('user_id', userId)
        .eq('service', 'meta')
        .single();
      
      if (credRow) {
        const accessToken = await publicRouteHelpers.decryptCred(credRow.encrypted_key);
        // For WhatsApp webhooks we don't have IP/UA context, but we have phone
        await trackMetaConversion('contact', accessToken, {
          pixelId: pixelId || undefined,
          eventId: `wa_${message.id}`,
          phone: phone || null,
          externalId: userId,
        });
      }
    } catch (err) {
      console.error('[CAPI] WhatsApp webhook tracking failed:', err);
    }
  })();'''
wa_new = r'''  // Trigger Meta CAPI Contact event using the same canonical/legacy resolver as the rest of the runtime.
  (async () => {
    try {
      const creds = await resolveMetaCreds(adminClient, userId, '');
      const validation = validateMetaCredentialResult(creds);
      if (!validation.ok || !creds.accessToken) return;
      await trackMetaConversion('contact', creds.accessToken, {
        pixelId: pixelId || creds.pixelId || undefined,
        eventId: `wa_${message.id}`,
        phone: phone || null,
        externalId: userId,
      });
    } catch (err) {
      console.error('[CAPI] WhatsApp webhook tracking failed:', err);
    }
  })();'''
api = patch_function(api, "async function processWhatsappWebhookMessage(", "function throwIfError(", lambda block: replace_once(block, wa_old, wa_new, "WhatsApp CAPI credential routing"), "processWhatsappWebhookMessage")

api_path.write_text(api)

web_path = Path("supabase/functions/web-events/index.ts")
web = web_path.read_text()
web = replace_once(
    web,
    'const META_APP_SECRET = Deno.env.get("META_APP_SECRET") || "";\n',
    'const META_APP_SECRET = Deno.env.get("META_APP_SECRET") || "";\nconst META_CANONICAL_APP_SECRET = Deno.env.get("META_CANONICAL_APP_SECRET") || Deno.env.get("META_REPORTING_APP_SECRET") || "";\n',
    "web-events canonical app secret",
)

proof_replacement = r'''async function appsecretProof(accessToken: string, appSecret: string): Promise<string | null> {
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
}'''
web = replace_between(web, "async function appsecretProof(", "function normalizeDigits(", proof_replacement, "web-events appsecretProof")

owner_replacement = r'''async function resolveOwnerAndMeta(admin: any) {
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

  let rows: any[] = [];
  if (userId) {
    const { data } = await admin
      .from("integrations")
      .select("user_id,service,metadata,status,updated_at")
      .eq("user_id", userId)
      .in("service", ["meta_ads", "meta"])
      .eq("status", "connected");
    rows = data || [];
  } else {
    const { data } = await admin
      .from("integrations")
      .select("user_id,service,metadata,status,updated_at")
      .in("service", ["meta_ads", "meta"])
      .eq("status", "connected")
      .order("updated_at", { ascending: false })
      .limit(20);
    rows = data || [];
  }

  const integration = [...rows].sort((a: any, b: any) =>
    scoreIntegration(b) - scoreIntegration(a) || String(b?.updated_at || "").localeCompare(String(a?.updated_at || ""))
  )[0];

  if (!integration) throw new Error("Connected Meta integration not found");
  userId = integration.user_id || userId;
  if (!userId) throw new Error("No Meta owner user resolved");

  const service = integration.service === "meta_ads" ? "meta_ads" : "meta";
  const { data: cred } = await admin
    .from("credentials")
    .select("encrypted_key")
    .eq("user_id", userId)
    .eq("service", service)
    .maybeSingle();
  if (!cred?.encrypted_key) throw new Error("Meta credential not found");

  const metadata = integration.metadata || {};
  const pixelId = normalizeDigits(metadata.pixelId || metadata.pixel_id || META_PIXEL_ID);
  if (!pixelId) throw new Error("Meta Pixel ID not configured");

  const appSecret = service === "meta_ads" ? META_CANONICAL_APP_SECRET : META_APP_SECRET;
  return { pixelId, accessToken: await decryptCred(cred.encrypted_key), appSecret };
}'''
web = replace_between(web, "async function resolveOwnerAndMeta(", "function getHeaderIp(", owner_replacement, "web-events resolveOwnerAndMeta")

web = replace_once(
    web,
    "async function sendMetaCapi(params: { pixelId: string; accessToken: string; body: any; req: Request }) {\n  const { pixelId, accessToken, body, req } = params;",
    "async function sendMetaCapi(params: { pixelId: string; accessToken: string; appSecret: string; body: any; req: Request }) {\n  const { pixelId, accessToken, appSecret, body, req } = params;",
    "web-events send signature",
)
web = replace_once(
    web,
    "  const proof = await appsecretProof(accessToken);\n",
    "  const proof = await appsecretProof(accessToken, appSecret);\n",
    "web-events proof call",
)
web = replace_once(
    web,
    "    const result = await sendMetaCapi({ pixelId: meta.pixelId, accessToken: meta.accessToken, body, req });",
    "    const result = await sendMetaCapi({ pixelId: meta.pixelId, accessToken: meta.accessToken, appSecret: meta.appSecret, body, req });",
    "web-events send call",
)
web_path.write_text(web)

print("patched api + web-events canonical Meta routing")
