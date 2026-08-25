import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.1';

const EXPECTED_SYSTEM_USER_ID = '122098243371455164';
const EXPECTED_AD_ACCOUNT_ID = 'act_718120894191565';
const EXPECTED_APP_ID = '1836302544001572';
const EXPECTED_OPERATION = 'meta-runtime-credential-reencrypt-v1';
const MAX_REQUEST_AGE_MS = 5 * 60 * 1000;
const GRAPH = 'https://graph.facebook.com/v22.0';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(hex.length >>> 1);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < hex.length; i += 2) out[i >>> 1] = Number.parseInt(hex.slice(i, i + 2), 16);
  return out;
}

async function deriveKey(
  masterKey: string,
  salt: Uint8Array<ArrayBuffer>,
  usage: KeyUsage[],
) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(masterKey),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usage,
  );
}

async function encryptCredential(raw: string, masterKey: string): Promise<string> {
  const salt = new Uint8Array(new ArrayBuffer(32));
  crypto.getRandomValues(salt);
  const iv = new Uint8Array(new ArrayBuffer(12));
  crypto.getRandomValues(iv);
  const key = await deriveKey(masterKey, salt, ['encrypt']);
  const ciphertextWithTag = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(raw)),
  );
  const tag = ciphertextWithTag.slice(ciphertextWithTag.length - 16);
  const ciphertext = ciphertextWithTag.slice(0, ciphertextWithTag.length - 16);
  return [bytesToHex(salt), bytesToHex(iv), bytesToHex(tag), bytesToHex(ciphertext)].join(':');
}

async function decryptCredential(encoded: string, masterKey: string): Promise<string> {
  const parts = encoded.split(':');
  if (parts.length !== 4) throw new Error('malformed ciphertext');
  const [saltHex, ivHex, tagHex, ciphertextHex] = parts;
  const salt = hexToBytes(saltHex);
  const iv = hexToBytes(ivHex);
  const tag = hexToBytes(tagHex);
  const ciphertext = hexToBytes(ciphertextHex);
  const combined = new Uint8Array(new ArrayBuffer(ciphertext.length + tag.length));
  combined.set(ciphertext);
  combined.set(tag, ciphertext.length);
  const key = await deriveKey(masterKey, salt, ['decrypt']);
  return new TextDecoder().decode(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, combined),
  );
}

function normalizeAdAccountId(raw: unknown): string {
  const value = String(raw ?? '').trim();
  if (!/^(?:act_)?\d+$/i.test(value)) return '';
  return `act_${value.replace(/^act_/i, '')}`;
}

function bearerToken(req: Request): string {
  const authorization = req.headers.get('authorization') ?? '';
  return authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';
}

function requestIsFresh(req: Request): boolean {
  const issuedAt = Number(req.headers.get('x-nuvanx-issued-at') ?? '');
  if (!Number.isSafeInteger(issuedAt)) return false;
  const ageMs = Date.now() - issuedAt;
  return ageMs >= 0 && ageMs <= MAX_REQUEST_AGE_MS;
}

async function appSecretProof(token: string, appSecret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token)),
  );
  return bytesToHex(signature);
}

async function debugToken(token: string, appSecret: string) {
  const url = new URL(`${GRAPH}/debug_token`);
  url.searchParams.set('input_token', token);
  url.searchParams.set('access_token', `${EXPECTED_APP_ID}|${appSecret}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Meta token debug failed (${response.status})`);
  return body?.data ?? null;
}

async function graph(path: string, token: string, appSecret: string) {
  const url = new URL(`${GRAPH}${path}`);
  url.searchParams.set('access_token', token);
  url.searchParams.set('fields', 'id');
  url.searchParams.set('appsecret_proof', await appSecretProof(token, appSecret));
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Graph validation failed (${response.status})`);
  return body;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function canonicalIntegrationMatches(row: any): boolean {
  const metadata = objectValue(row?.metadata);
  const systemUserId = String(metadata.systemUserId ?? metadata.system_user_id ?? '').trim();
  const adAccountId = normalizeAdAccountId(
    metadata.adAccountId ?? metadata.ad_account_id ??
      (Array.isArray(metadata.adAccountIds) ? metadata.adAccountIds[0] : ''),
  );
  const appId = String(metadata.appId ?? metadata.app_id ?? '').trim();
  return (
    metadata.canonical === true &&
    row?.status === 'connected' &&
    systemUserId === EXPECTED_SYSTEM_USER_ID &&
    adAccountId === EXPECTED_AD_ACCOUNT_ID &&
    appId === EXPECTED_APP_ID
  );
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ success: false, message: 'method_not_allowed' }, 405);
  if (req.headers.get('x-nuvanx-operation') !== EXPECTED_OPERATION) {
    return json({ success: false, message: 'operation_mismatch' }, 403);
  }
  if (!requestIsFresh(req)) {
    return json({ success: false, message: 'request_expired' }, 403);
  }

  const token = bearerToken(req);
  if (!token) return json({ success: false, message: 'canonical_token_required' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY') ?? '';
  const appSecret = Deno.env.get('META_CANONICAL_APP_SECRET')
    ?? Deno.env.get('META_REPORTING_APP_SECRET')
    ?? '';
  if (!supabaseUrl || !serviceRoleKey || !encryptionKey || !appSecret) {
    return json({ success: false, message: 'runtime_configuration_missing' }, 500);
  }

  let debug;
  let me;
  let account;
  try {
    debug = await debugToken(token, appSecret);
    me = await graph('/me', token, appSecret);
    account = await graph(`/${EXPECTED_AD_ACCOUNT_ID}`, token, appSecret);
  } catch {
    return json({ success: false, message: 'graph_validation_failed' }, 403);
  }
  if (debug?.is_valid !== true || String(debug?.app_id ?? '') !== EXPECTED_APP_ID) {
    return json({ success: false, message: 'app_id_mismatch' }, 403);
  }
  if (String(debug?.user_id ?? '') !== EXPECTED_SYSTEM_USER_ID) {
    return json({ success: false, message: 'debug_system_user_mismatch' }, 403);
  }
  if (String(me?.id ?? '') !== EXPECTED_SYSTEM_USER_ID) {
    return json({ success: false, message: 'system_user_mismatch' }, 403);
  }
  if (normalizeAdAccountId(account?.id) !== EXPECTED_AD_ACCOUNT_ID) {
    return json({ success: false, message: 'ad_account_mismatch' }, 403);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: integrations, error: integrationError } = await admin
    .from('integrations')
    .select('id,user_id,status,metadata')
    .eq('service', 'meta_ads');
  if (integrationError) return json({ success: false, message: 'integration_read_failed' }, 500);

  const canonicalIntegrations = (integrations ?? []).filter(canonicalIntegrationMatches);
  if (canonicalIntegrations.length === 0) {
    return json({ success: false, message: 'canonical_integration_missing' }, 409);
  }
  if (canonicalIntegrations.length !== 1) {
    return json({ success: false, message: 'canonical_integration_ambiguous' }, 409);
  }
  const integration = canonicalIntegrations[0];

  const { data: credential, error: credentialError } = await admin
    .from('credentials')
    .select('id,user_id,encrypted_key,metadata')
    .eq('user_id', integration.user_id)
    .eq('service', 'meta_ads')
    .maybeSingle();
  if (credentialError) return json({ success: false, message: 'credential_read_failed' }, 500);
  if (!credential?.id || !credential.encrypted_key) {
    return json({ success: false, message: 'canonical_credential_missing' }, 409);
  }

  const credentialMetadata = objectValue(credential.metadata);
  const previousMarker = objectValue(credentialMetadata.runtime_reencrypt);
  if (
    previousMarker.operation === EXPECTED_OPERATION &&
    previousMarker.state === 'COMPLETED'
  ) {
    return json({ success: false, message: 'operation_already_completed' }, 409);
  }

  let beforeDecryptable = false;
  let alreadyMatches = false;
  try {
    const current = await decryptCredential(String(credential.encrypted_key), encryptionKey);
    beforeDecryptable = true;
    alreadyMatches = current === token;
  } catch {
    beforeDecryptable = false;
  }

  let encrypted = String(credential.encrypted_key);
  if (!alreadyMatches) {
    encrypted = await encryptCredential(token, encryptionKey);
    const roundTrip = await decryptCredential(encrypted, encryptionKey);
    if (roundTrip !== token) return json({ success: false, message: 'roundtrip_failed' }, 500);
  }

  const completedAt = new Date().toISOString();
  const updatedMetadata = {
    ...credentialMetadata,
    runtime_reencrypt: {
      operation: EXPECTED_OPERATION,
      state: 'COMPLETED',
      completed_at: completedAt,
      app_id: EXPECTED_APP_ID,
      system_user_id: EXPECTED_SYSTEM_USER_ID,
      ad_account_id: EXPECTED_AD_ACCOUNT_ID,
    },
  };

  const { data: updatedCredential, error: updateError } = await admin
    .from('credentials')
    .update({
      encrypted_key: encrypted,
      metadata: updatedMetadata,
      last_used: completedAt,
    })
    .eq('id', credential.id)
    .eq('user_id', integration.user_id)
    .eq('service', 'meta_ads')
    .select('id')
    .single();
  if (updateError || updatedCredential?.id !== credential.id) {
    return json({ success: false, message: 'credential_update_failed' }, 500);
  }

  return json({
    success: true,
    service: 'meta_ads',
    before_decryptable: beforeDecryptable,
    rotated: !alreadyMatches,
    roundtrip_verified: true,
    app_id_verified: true,
    system_user_verified: true,
    ad_account_verified: true,
    operation_marked_completed: true,
  });
});
