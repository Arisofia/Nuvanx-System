// Nuvanx API Edge Function — v44
/** @ts-ignore: Deno global is provided by Supabase Edge Runtime */
declare const Deno: any;

import { createClient } from '@supabase/supabase-js';
export { createClient };

function requireSupabaseEnv(value: string | null | undefined, name: string): string {
  const normalized = value?.trim() ?? '';
  if (!normalized) {
    throw new Error(`${name} is required. Refusing to create a Supabase client with empty credentials.`);
  }
  return normalized;
}

export const supabaseClientFactory = {
  create(url: string | null, key: string | null, options: any) {
    return createClient(
      requireSupabaseEnv(url, 'SUPABASE_URL'),
      requireSupabaseEnv(key, 'SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY'),
      options,
    );
  },
};
export function createSupabaseClient(url: string | null, key: string | null, options: any) {
  return supabaseClientFactory.create(url, key, options);
}

const rawFrontendUrl = Deno.env.get('FRONTEND_URL')?.trim() || '';
const IS_DEVELOPMENT = (Deno.env.get('DENO_ENV') ?? Deno.env.get('NODE_ENV') ?? '').toLowerCase() !== 'production';

export function normalizeFrontendUrl(url: string): string | null {
  if (!url) return null;
  if (url === '*' || url.toLowerCase() === 'null') return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

const normalizedFrontendUrl = normalizeFrontendUrl(rawFrontendUrl);

if (!IS_DEVELOPMENT && !normalizedFrontendUrl) {
  console.warn('FRONTEND_URL is not set or is not a valid HTTPS URL. CORS will use the production Vercel URL as fallback.');
}

// Hard-coded production Vercel URL as a CORS safety-net in case FRONTEND_URL secret is misconfigured.
const PRODUCTION_FALLBACK_URL = 'https://frontend-arisofias-projects-c2217452.vercel.app';
const FRONTEND_URL = normalizedFrontendUrl ?? (IS_DEVELOPMENT ? 'http://localhost:5173' : PRODUCTION_FALLBACK_URL);
export const DEFAULT_CORS_ORIGIN = IS_DEVELOPMENT
  ? 'http://localhost:5173'
  : FRONTEND_URL;

export const ALLOWED_CORS_ORIGINS = new Set([
  DEFAULT_CORS_ORIGIN,
  // Always include the production Vercel URL regardless of NODE_ENV so that
  // POST requests from the browser (which send Origin) are never rejected in production.
  PRODUCTION_FALLBACK_URL,
  'https://nuvanx.com',
  'https://www.nuvanx.com',
]);

export const DEFAULT_CORS_HEADERS = {
  'Access-Control-Allow-Origin': DEFAULT_CORS_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
};

export function buildCorsHeaders(origin: string | null) {
  const allowedOrigin = origin && ALLOWED_CORS_ORIGINS.has(origin)
    ? origin
    : DEFAULT_CORS_ORIGIN;
  return {
    ...DEFAULT_CORS_HEADERS,
    'Access-Control-Allow-Origin': allowedOrigin,
  };
}

// ── Web Crypto helpers (PBKDF2 + AES-256-GCM — mirrors backend encryption) ───
export function hexToBytes(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length >>> 1);
  for (let i = 0; i < hex.length; i += 2) arr[i >>> 1] = Number.parseInt(hex.slice(i, i + 2), 16);
  return arr;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function encryptCred(raw: string): Promise<string> {
  const masterKey = Deno.env.get('ENCRYPTION_KEY');
  if (!masterKey) throw new Error('ENCRYPTION_KEY not set in Edge Function secrets');
  const salt = new Uint8Array(32);
  crypto.getRandomValues(salt);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(masterKey), 'PBKDF2', false, ['deriveKey']);
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, ['encrypt'],
  );
  const ciphertextWithTag = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      new TextEncoder().encode(raw),
    ),
  );
  const tagLen = 16;
  if (ciphertextWithTag.length < tagLen) throw new Error('failed to encrypt credential');
  const ct = ciphertextWithTag.slice(0, ciphertextWithTag.length - tagLen);
  const tag = ciphertextWithTag.slice(ciphertextWithTag.length - tagLen);
  return [bytesToHex(salt), bytesToHex(iv), bytesToHex(tag), bytesToHex(ct)].join(':');
}

export async function decryptCred(encoded: string): Promise<string> {
  const masterKey = Deno.env.get('ENCRYPTION_KEY');
  if (!masterKey) throw new Error('ENCRYPTION_KEY not set in Edge Function secrets');
  const parts = encoded.split(':');
  if (parts.length !== 4) throw new Error('malformed ciphertext');
  const [saltH, ivH, tagH, ctH] = parts;
  const salt = hexToBytes(saltH), iv = hexToBytes(ivH);
  const tag = hexToBytes(tagH), ct = hexToBytes(ctH);
  // Web Crypto AES-GCM expects ciphertext || authTag concatenated
  const combined = new Uint8Array(ct.length + tag.length);
  combined.set(ct); combined.set(tag, ct.length);
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(masterKey), 'PBKDF2', false, ['deriveKey']);
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: 100_000, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
  );
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv.buffer as ArrayBuffer }, aesKey, combined.buffer as ArrayBuffer));
}

// ── Meta Graph API ────────────────────────────────────────────────────────────
export const META_GRAPH = 'https://graph.facebook.com/v21.0';

async function computeAppsecretProof(accessToken: string, appSecret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(accessToken)));
  return bytesToHex(sig);
}

export async function metaFetch(path: string, params: Record<string, string>, token: string) {
  const url = new URL(`${META_GRAPH}${path}`);
  url.searchParams.set('access_token', token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const appSecret = Deno.env.get('META_APP_SECRET');
  if (appSecret) {
    url.searchParams.set('appsecret_proof', await computeAppsecretProof(token, appSecret));
  }
  const r = await fetch(url.toString(), { signal: AbortSignal.timeout(20_000) });
  const { data: d, text } = await parseJsonOrText(r);
  if (!r.ok) {
    const msg = d?.error?.message ?? d?.message ?? (text || `Meta API ${r.status}`);
    throw new Error(msg);
  }
  return d;
}

export function parseMetaMetric(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  if (typeof raw === 'string') {
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) ? n : 0;
  }
  if (Array.isArray(raw)) {
    return raw.reduce((sum: number, item: any) => {
      const n = parseMetaMetric(item?.value ?? item);
      return sum + n;
    }, 0);
  }
  if (raw && typeof raw === 'object') {
    const rawObj = raw as Record<string, unknown>;
    const n = Number.parseFloat(String(rawObj.value ?? 0));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function actionValue(actions: any, matcher: (type: string) => boolean): number {
  if (!Array.isArray(actions)) return 0;
  return actions.reduce((sum: number, action: any) => {
    const type = String(action?.action_type ?? '').toLowerCase();
    if (!matcher(type)) return sum;
    return sum + parseMetaMetric(action?.value ?? 0);
  }, 0);
}

function isMessagingConversationAction(type: string): boolean {
  return type.includes('conversation_started')
    || type.includes('messaging')
    || type.includes('whatsapp')
    || type === 'onsite_conversion.messaging_conversation_started_7d';
}

async function resolveClinicId(adminClient: any, userId: string): Promise<string | null> {
  const { data: usr } = await adminClient.from('users').select('clinic_id').eq('id', userId).single();
  return usr?.clinic_id ?? null;
}

async function persistAgentOutput(adminClient: any, userId: string, agentType: string, output: any, metadata?: any) {
  const clinicId = await resolveClinicId(adminClient, userId);
  const outputText = typeof output === 'string'
    ? output
    : JSON.stringify(output ?? {});
  const inputContext = metadata && typeof metadata.context === 'string'
    ? metadata.context
    : '';
  const { data, error } = await adminClient
    .from('agent_outputs')
    .insert({
      user_id: userId,
      clinic_id: clinicId,
      agent_type: agentType,
      output_text: outputText,
      output,
      metadata,
      input_context: inputContext,
      output_data: output ?? {},
    })
    .select('id')
    .single();
  if (error) throw error;
  return data?.id ?? null;
}

async function linkAgentOutputToPlaybookExecution(adminClient: any, userId: string, playbookExecutionId: string, agentOutputId: string) {
  if (!playbookExecutionId || !agentOutputId) return;
  const { data: current, error: getErr } = await adminClient
    .from('playbook_executions')
    .select('id, metadata')
    .eq('id', playbookExecutionId)
    .eq('user_id', userId)
    .maybeSingle();
    if (getErr || !current) return;

    const nextMetadata = current.metadata
      ? { ...current.metadata, agent_output_id: agentOutputId }
      : { agent_output_id: agentOutputId };

  await adminClient
    .from('playbook_executions')
    .update({ agent_output_id: agentOutputId, metadata: nextMetadata })
    .eq('id', playbookExecutionId)
    .eq('user_id', userId);
}

async function resolveAiApiKey(cred: any, envKey: string): Promise<string> {
  if (!cred) return envKey;
  try {
    return await decryptCred(cred.encrypted_key);
  } catch (decryptErr) {
    if (envKey) return envKey;
    throw decryptErr;
  }
}

type AiProvider = 'gemini' | 'openai';

interface AiProviderConfig {
  provider: AiProvider;
  cred: any;
  envKey: string;
}

function orderAiProviderConfigs(preferredProvider: string, configs: AiProviderConfig[]) {
  const order: AiProvider[] = preferredProvider === 'openai'
    ? ['openai', 'gemini']
    : ['gemini', 'openai'];
  return order.flatMap((provider) => configs.filter((config) => config.provider === provider));
}

type AiAttemptSuccess = { text: string };
type AiAttemptFailure = { error: string };
type AiAttemptResult = AiAttemptSuccess | AiAttemptFailure;

function isAiAttemptSuccess(result: AiAttemptResult): result is AiAttemptSuccess {
  return 'text' in result;
}

async function attemptAiProvider(config: AiProviderConfig, prompt: string): Promise<AiAttemptResult> {
  try {
    const apiKey = await resolveAiApiKey(config.cred, config.envKey);
    const text = config.provider === 'gemini'
      ? await callGemini(prompt, apiKey)
      : await callOpenAI(prompt, apiKey);

    if (typeof text === 'string' && text.trim()) {
      return { text };
    }
    return { error: `${config.provider}: empty response` };
  } catch (err: any) {
    return { error: `${config.provider}: ${err?.message ?? 'unknown error'}` };
  }
}

async function runAiPrompt(
  adminClient: any,
  userId: string,
  prompt: string,
  preferredProvider = '',
): Promise<{ text: string; provider: 'gemini' | 'openai'; providerErrors: string[] }> {
  const { data: creds } = await adminClient
    .from('credentials').select('service, encrypted_key').eq('user_id', userId).in('service', ['gemini', 'openai']);
  const geminiCred = (creds ?? []).find((c: any) => c.service === 'gemini');
  const openaiCred = (creds ?? []).find((c: any) => c.service === 'openai');

  const envOpenAiKey = Deno.env.get('OPENAI_API_KEY') ?? Deno.env.get('OPENAI_KEY') ?? '';
  const envGeminiKey = Deno.env.get('GEMINI_API_KEY') ?? Deno.env.get('GEMINI_KEY') ?? '';

  const configs: AiProviderConfig[] = [
    { provider: 'gemini', cred: geminiCred, envKey: envGeminiKey },
    { provider: 'openai', cred: openaiCred, envKey: envOpenAiKey },
  ];
  const availableConfigs = configs.filter((config) => Boolean(config.cred || config.envKey));

  if (availableConfigs.length === 0) {
    throw new Error('No AI integration connected. Add Gemini or OpenAI in Integrations, or configure OPENAI_API_KEY/GEMINI_API_KEY in function secrets.');
  }

  const providerErrors: string[] = [];
  for (const config of orderAiProviderConfigs(preferredProvider, availableConfigs)) {
    const result = await attemptAiProvider(config, prompt);
    if (isAiAttemptSuccess(result)) {
      return { text: result.text, provider: config.provider, providerErrors };
    }
    providerErrors.push(result.error);
  }

  const error = new Error(`AI request failed for all connected providers. ${providerErrors.join(' | ')}`);
  Object.assign(error, { providerErrors });
  throw error;
}

// ── AI helpers ────────────────────────────────────────────────────────────────
export async function parseJsonOrText(response: Response): Promise<{ data: any; text: string }> {
  const text = await response.text();
  try {
    return { data: JSON.parse(text), text };
  } catch {
    return { data: null, text };
  }
}

const GEMINI_MODELS = ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro'];
const OPENAI_MODELS = ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo'];

async function callGemini(prompt: string, apiKey: string): Promise<string> {
  const errors: string[] = [];
  for (const model of GEMINI_MODELS) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.6, maxOutputTokens: 1500 },
          }),
        },
      );
      const { data, text } = await parseJsonOrText(r);
      if (!r.ok) {
        const msg = data?.error?.message ?? data?.message ?? text ?? `Gemini ${r.status}`;
        errors.push(`${model}: ${msg}`);
        continue;
      }
      const output = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (output && typeof output === 'string' && output.trim()) {
        return output;
      }
      errors.push(`${model}: response missing generated text`);
    } catch (fetchErr: any) {
      errors.push(`${model}: fetch failed - ${fetchErr.message}`);
    }
  }
  throw new Error(`Gemini error: ${errors.join(' | ')}`);
}

async function callOpenAI(prompt: string, apiKey: string): Promise<string> {
  const errors: string[] = [];
  for (const model of OPENAI_MODELS) {
    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.6,
          max_tokens: 1500,
        }),
      });

      const { data, text } = await parseJsonOrText(r);
      if (!r.ok) {
        errors.push(getOpenAIErrorMessage(model, data, text, r.status));
        continue;
      }

      const output = extractOpenAIOutput(data);
      if (output) return output;
      errors.push(`${model}: response missing generated text`);
    } catch (fetchErr: any) {
      errors.push(`${model}: fetch failed - ${fetchErr.message}`);
    }
  }
  throw new Error(`OpenAI error: ${errors.join(' | ')}`);
}

function extractOpenAIOutput(data: any): string | null {
  const output = data?.choices?.[0]?.message?.content;
  return typeof output === 'string' && output.trim() ? output : null;
}

function getOpenAIErrorMessage(model: string, data: any, text: string, status: number): string {
  const fallbackMessage = `OpenAI ${status}`;
  const innerMessage = data?.error?.message ?? data?.message ?? text ?? fallbackMessage;
  return `${model}: ${innerMessage}`;
}

export async function processLeadData(adminClient: any, userId: string, leadData: any) {
  // Parse field_data array into a flat map
  const fields: Record<string, string> = {};
  for (const f of (leadData.field_data ?? [])) {
    fields[(f.name ?? '').toLowerCase()] = f.values?.[0] ?? '';
  }

  const leadgen_id = leadData.id;
  const leadName = fields['full_name'] ?? fields['nombre'] ?? fields['name'] ?? `Lead ${leadgen_id.slice(-6)}`;
  const email    = fields['email']        ?? null;
  const phone    = fields['phone_number'] ?? fields['telefono'] ?? fields['phone'] ?? null;
  const dni      = fields['dni']          ?? fields['nif']      ?? fields['national_id'] ?? null;

  // Any non-standard custom fields (e.g. 'Tratamiento de interés') → notes JSON
  const KNOWN_STANDARD = new Set(['full_name','nombre','name','email','phone_number','telefono','phone','dni','nif','national_id']);
  const customFields = Object.fromEntries(
    Object.entries(fields).filter(([k]) => !KNOWN_STANDARD.has(k))
  );
  const notes = Object.keys(customFields).length > 0 ? JSON.stringify(customFields) : null;

  // Priority detection — scan all form values for high-demand treatment keywords
  const HIGH_PRIORITY_KEYWORDS = /botox|bótox|neuromodulador|toxina\s*botulínica|botulínica|relleno|hialu|hialurón|rinomodelación|bichectomía|lifting/i;
  const allValues = Object.values(fields).join(' ') + ' ' + (notes ?? '');
  const priority = HIGH_PRIORITY_KEYWORDS.test(allValues) ? 'high' : 'normal';

  // Upsert lead — idempotent via partial unique index (user_id, source, external_id)
  let createdAt: string;
  try {
    const rawTime = leadData.created_time;
    if (!rawTime) {
      createdAt = new Date().toISOString();
    } else if (typeof rawTime === 'number') {
      createdAt = new Date(rawTime * 1000).toISOString();
    } else if (typeof rawTime === 'string' && /^\d+$/.test(rawTime)) {
      createdAt = new Date(Number(rawTime) * 1000).toISOString();
    } else {
      const d = new Date(rawTime);
      createdAt = Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
    }
  } catch {
    createdAt = new Date().toISOString();
  }

  const { data: lead } = await adminClient
    .from('leads')
    .upsert({
      user_id:     userId,
      external_id: leadgen_id,
      source:      'meta_leadgen',
      name:        leadName,
      email,
      phone,
      dni:         dni || null,
      notes:       notes || null,
      priority,
      stage:       'lead',
      campaign_id: leadData.campaign_id ?? null,
      adset_id:    leadData.adset_id    ?? null,
      ad_id:       leadData.ad_id       ?? null,
      form_id:     leadData.form_id     ?? null,
      form_name:   leadData.form_name   ?? null,
      created_at:  createdAt,
    }, { onConflict: 'user_id,source,external_id', ignoreDuplicates: true })
    .select('id')
    .maybeSingle();

  // Record attribution details
  if (lead?.id) {
    await adminClient
      .from('meta_attribution')
      .upsert({
        lead_id:     lead.id,
        leadgen_id,
        page_id:     leadData.page_id     ?? null,
        form_id:     leadData.form_id     ?? null,
        campaign_id: leadData.campaign_id ?? null,
        adset_id:    leadData.adset_id    ?? null,
        ad_id:       leadData.ad_id       ?? null,
        ad_name:     leadData.ad_name     ?? null,
        form_name:   leadData.form_name   ?? null,
      }, { onConflict: 'leadgen_id' });
    return true;
  }
  return false;
}

export const publicRouteHelpers = {
  decryptCred,
  metaFetch,
  processLeadData,
};

async function resolveClinicMetadata(adminClient: any, userId: string) {
  const clinicId = await resolveClinicId(adminClient, userId);
  if (!clinicId) return { name: 'una clínica', city: 'Madrid', specialty: 'medicina estética' };
  
  const { data } = await adminClient.from('clinics').select('name, metadata').eq('id', clinicId).single();
  const meta = data?.metadata ?? {};
  return {
    name: data?.name ?? 'una clínica',
    city: meta.city ?? 'Madrid',
    specialty: meta.specialty ?? 'medicina estética'
  };
}

// ── Meta credential resolver ──────────────────────────────────────────────────
async function resolveMetaCreds(adminClient: any, userId: string, qAccountId: string) {
  const { data: credRow } = await adminClient
    .from('credentials').select('encrypted_key').eq('user_id', userId).eq('service', 'meta').single();
  if (!credRow) return { notConnected: true, accessToken: '', adAccountId: '', decryptionError: '' } as const;

  let accessToken = '';
  let decryptionError = '';
  try {
    accessToken = await decryptCred(credRow.encrypted_key);
  } catch (err: any) {
    decryptionError = err?.message ?? 'Failed to decrypt Meta credential';
  }

  let adAccountId = qAccountId;
  if (!adAccountId) {
    const { data: intg } = await adminClient
      .from('integrations').select('metadata').eq('user_id', userId).eq('service', 'meta').single();
    adAccountId = intg?.metadata?.adAccountId ?? intg?.metadata?.ad_account_id ?? '';
  }
  adAccountId = normalizeMetaAccountId(adAccountId);
  return { notConnected: false, accessToken, adAccountId, decryptionError } as const;
}

function validateMetaCredentialResult(creds: any) {
  if (creds.notConnected) {
    return { ok: false, message: 'Meta Ads not connected', statusCode: 400 };
  }
  if (creds.decryptionError) {
    return { ok: false, message: creds.decryptionError, statusCode: 502 };
  }
  if (!creds.adAccountId) {
    return { ok: false, message: 'Meta Ad Account ID not configured', statusCode: 400 };
  }
  return { ok: true, message: '' };
}

export function extractMetaAccountRawValue(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw === 'object' && raw !== null) {
    const rawObj = raw as Record<string, unknown>;
    return String(rawObj.adAccountId ?? rawObj.ad_account_id ?? '').trim();
  }
  if (typeof raw === 'string' || typeof raw === 'number') {
    return String(raw).trim();
  }
  return '';
}

function normalizeMetaAccountId(raw: unknown): string {
  const value = extractMetaAccountRawValue(raw);
  if (!value) return '';

  const normalizedValue = parseMetaAccountIdString(value);
  if (!normalizedValue) return '';

  const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const unprefixedValue = normalizedValue.replace(/^act_/, '');
  if (uuidLike.test(normalizedValue) || uuidLike.test(unprefixedValue)) return '';

  const digitsOnly = unprefixedValue.replaceAll(/[^\d]/g, '');
  return digitsOnly ? `act_${digitsOnly}` : '';
}

function parseMetaAccountIdString(value: string): string {
  if (!value) return '';

  if ((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('"') && value.endsWith('"'))) {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'string') return parsed.trim();
      if (parsed && typeof parsed === 'object') {
        const nested = parsed.adAccountId ?? parsed.ad_account_id ?? '';
        return String(nested).trim();
      }
    } catch {
      // Keep original value if JSON parsing fails.
    }
  }

  return value;
}

function percentChange(c: number, p: number): number {
  if (p === 0) return c > 0 ? 100 : 0;
  return Number.parseFloat(((c - p) / p * 100).toFixed(1));
}

async function getMetaCache(adminClient: any, userId: string, cacheId: string) {
  const { data } = await adminClient
    .from('meta_cache')
    .select('data, updated_at')
    .eq('user_id', userId)
    .eq('id', cacheId)
    .maybeSingle();
  return data;
}

async function setMetaCache(adminClient: any, userId: string, cacheId: string, data: any) {
  await adminClient
    .from('meta_cache')
    .upsert(
      { id: cacheId, user_id: userId, data, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,id' },
    );
}

function requireMetaAccountId(raw: unknown): string {
  const normalized = normalizeMetaAccountId(raw);
  if (!normalized) {
    throw new Error('Invalid Meta Ad Account ID. Use a numeric ID or act_<digits>.');
  }
  return normalized;
}

async function updateIntegrationStatus(adminClient: any, userId: string, service: string, status: string, message: string | null = null) {
  await adminClient
    .from('integrations')
    .update({ status, last_error: message, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('service', service);
}

async function ensurePublicUserRow(adminClient: any, user: any) {
  if (!user?.id) return;

  const { data: existingUser, error: existingError } = await adminClient
    .from('users')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existingUser) return;

  const userName = user.user_metadata?.name ?? user.raw_user_meta_data?.name ?? user.email ?? '';
  const { error: insertError } = await adminClient
    .from('users')
    .insert({
      id: user.id,
      email: user.email ?? '',
      name: userName,
      password_hash: '',
    });
  if (insertError) throw insertError;
}

function isValidEncryptionKey(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length >= 32;
}

function requireRuntimeSecret(name: string): string {
  const value = Deno.env.get(name)?.trim() ?? '';
  if (!value) {
    throw new Error(`${name} is required. Refusing to run with missing Supabase runtime configuration.`);
  }
  return value;
}

function validateSupabaseRuntimeConfig() {
  requireRuntimeSecret('SUPABASE_URL');
  requireRuntimeSecret('SUPABASE_SERVICE_ROLE_KEY');

  if (!isValidEncryptionKey(Deno.env.get('ENCRYPTION_KEY'))) {
    throw new Error('ENCRYPTION_KEY is required and must be at least 32 characters.');
  }

  if (!IS_DEVELOPMENT && !normalizedFrontendUrl) {
    console.warn('FRONTEND_URL secret is missing or invalid; using hard-coded production fallback for CORS.');
  }
}

try {
  validateSupabaseRuntimeConfig();
} catch (initErr: any) {
  console.error('validateSupabaseRuntimeConfig failed:', initErr?.message ?? initErr);
}

function normalizePhoneNumberId(raw: unknown): string {
  let value = '';
  if (typeof raw === 'string') {
    value = raw.trim();
  } else if (typeof raw === 'number') {
    value = String(raw).trim();
  }

  if (!value || /^act_/i.test(value)) return '';
  if (/[a-z]/i.test(value)) return '';
  const digits = value.replaceAll(/\D/g, '');
  if (digits.length < 8 || digits.length > 20) return '';
  return digits;
}

// ── Google Ads helpers ────────────────────────────────────────────────────────
function b64url(data: ArrayBuffer | string): string {
  let str: string;
  if (typeof data === 'string') {
    str = btoa(data);
  } else {
    str = btoa(String.fromCodePoint(...new Uint8Array(data)));
  }
  return str.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function importRSAPrivateKey(pem: string): Promise<CryptoKey> {
  const pemBody = pem.replaceAll('-----BEGIN PRIVATE KEY-----', '')
    .replaceAll('-----END PRIVATE KEY-----', '')
    .replaceAll(/\s+/g, '');
  const binary = atob(pemBody);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.codePointAt(i) ?? 0;
  return crypto.subtle.importKey(
    'pkcs8', bytes.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign'],
  );
}

async function getGoogleAccessToken(serviceAccount: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const headerB64 = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payloadB64 = b64url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/adwords',
    aud: serviceAccount.token_uri ?? 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await importRSAPrivateKey(serviceAccount.private_key);
  const sigBytes = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput),
  );
  const jwt = `${signingInput}.${b64url(sigBytes)}`;
  const tokenRes = await fetch(serviceAccount.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) throw new Error(tokenData.error_description ?? `Google OAuth: ${tokenData.error}`);
  return tokenData.access_token;
}

async function googleAdsSearch(customerId: string, devToken: string, accessToken: string, query: string) {
  const cleanId = customerId.replaceAll('-', '');
  const r = await fetch(`https://googleads.googleapis.com/v17/customers/${cleanId}/googleAds:search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'developer-token': devToken,
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(20_000),
  });
  const d = await r.json();
  if (!r.ok) {
    const msg = d.error?.details?.[0]?.errors?.[0]?.message ?? d.error?.message ?? `Google Ads ${r.status}`;
    throw new Error(msg);
  }
  const { results } = d;
  return Array.isArray(results) ? results : [];
}

type GoogleAdsCreds =
  | { noServiceAccount: true }
  | { notConnected: true }
  | { notConnected: false; noServiceAccount: false; devToken: string; customerId: string; serviceAccount: any };

async function resolveGoogleAdsCreds(adminClient: any, userId: string, qCustomerId: string): Promise<GoogleAdsCreds> {
  const saRaw = Deno.env.get('GOOGLE_ADS_SERVICE_ACCOUNT');
  if (!saRaw) return { noServiceAccount: true } as const;
  let serviceAccount: any;
  try { serviceAccount = JSON.parse(saRaw); } catch { return { noServiceAccount: true } as const; }

  const { data: credRow } = await adminClient
    .from('credentials').select('encrypted_key').eq('user_id', userId).eq('service', 'google_ads').single();
  if (!credRow) return { notConnected: true } as const;
  const devToken = await decryptCred(credRow.encrypted_key);

  let customerId = qCustomerId;
  if (!customerId) {
    const { data: intg } = await adminClient
      .from('integrations').select('metadata').eq('user_id', userId).eq('service', 'google_ads').single();
    customerId = intg?.metadata?.customerId ?? intg?.metadata?.customer_id ?? '';
  }
  return { notConnected: false, noServiceAccount: false, devToken, customerId, serviceAccount } as const;
}

type SupabaseAuthUser = { id: string; [key: string]: unknown };

async function verifySupabaseUser(adminClient: any, token: string, anonKey: string): Promise<SupabaseAuthUser | null> {
  if (!token || token === anonKey) return null;
  const authResult = await adminClient.auth.getUser(token);
  const user = authResult.data?.user as SupabaseAuthUser | undefined;
  if (authResult.error || !user) return null;
  return user;
}

async function handleRequest(req: Request): Promise<Response> {
  const requestOrigin = req.headers.get('Origin');
  const corsHeaders = buildCorsHeaders(requestOrigin);
  const originIsRejectable = requestOrigin && !ALLOWED_CORS_ORIGINS.has(requestOrigin);
  if (req.method === 'OPTIONS') {
    if (originIsRejectable) return new Response('Forbidden', { status: 403 });
    return new Response('ok', { headers: corsHeaders });
  }
  if (originIsRejectable) return new Response('Forbidden', { status: 403, headers: corsHeaders });

  const sendJson = (data: unknown, status = 200, extraHeaders: Record<string, string> = {}) => {
    return json(data, status, { ...corsHeaders, ...extraHeaders });
  };

  const url = new URL(req.url);
  // Support both direct Supabase Function URLs and rewrite paths.
  // Direct path: /functions/v1/api/<resource>/...
  // Rewrite path: /api/<resource>/...
  const rawParts = url.pathname.split('/').filter(Boolean);
  const parts = [...rawParts];
  if (parts[0] === 'functions' && parts[1] === 'v1') {
    parts.splice(0, 2);
  }
  if (parts[0] === 'api') {
    parts.splice(0, 1);
  }
  // parts[0] = resource, parts[1] = sub, parts[2] = sub2
  const resource = parts[0] ?? '';
  const sub = parts[1] ?? '';
  const sub2 = parts[2] ?? '';

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  // This function is deployed with  so Supabase will not reject
  // requests before this handler runs. Every non-public route must therefore
  // enforce JWT validation here. Only health checks and Meta webhook handshake
  // routes are intentionally public.
  // Note: the Edge Function uses SUPABASE_SERVICE_ROLE_KEY for server-side
  // credential vault access and RLS bypass where needed. The `credentials` table
  // is not expected to be accessible via an authenticated client-side SELECT
  // policy in this architecture.
  // Auth — verify Supabase JWT
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');

  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // ── PUBLIC routes — no JWT required ──────────────────────────────────────
  const publicResponse = await handlePublicRoutes({ req, url, resource, sub, sendJson });
  if (publicResponse) return publicResponse;

  // ── All other routes require a valid JWT ──────────────────────────────────
  // Centralized auth guard: this checks the incoming Supabase user JWT once for all
  // non-public API routes in api/index.ts.
  const authUser = await verifySupabaseUser(adminClient, token, anonKey);
  if (!authUser) {
    return sendJson({ success: false, message: 'Unauthorized' }, 401);
  }

  const userId = authUser.id;

  return await handleAuthenticatedRoutes({
    adminClient,
    userId,
    authUser,
    resource,
    sub,
    sub2,
    req,
    url,
    sendJson,
    token,
  });
}

type RouteHandler = (ctx: AuthenticatedRouteContext) => Promise<Response | null>;

const AUTHENTICATED_ROUTE_HANDLERS = new Map<string, RouteHandler>([
  ['health|*|*', handleHealth],
  ['auth|me|GET', handleAuthMeGet],
  ['production|audit|GET', handleProductionAuditGet],
  ['leads||GET', handleLeadsGet],
  ['leads||POST', handleLeadsPost],
  ['leads||PATCH', handleLeadsPatch],
  ['leads||DELETE', handleLeadsDelete],
  ['dashboard|metrics|*', handleDashboardMetrics],
  ['dashboard|lead-flow|*', handleDashboardLeadFlow],
  ['dashboard|meta-trends|*', handleDashboardMetaTrends],
  ['meta|insights|GET', handleMetaInsightsGet],
  ['meta|backfill|POST', handleMetaBackfillPost],
  ['health|meta|*', handleHealthMeta],
  ['meta|campaigns|GET', handleMetaCampaignsGet],
  ['ai|analyze|POST', handleAiAnalyzePost],
  ['integrations||PATCH', handleIntegrationsPatch],
  ['integrations|validate-all|GET', handleIntegrationsValidateAllGet],
  ['integrations||GET', handleIntegrationsGet],
  ['integrations|connect|POST', handleIntegrationsConnectPost],
  ['integrations|test|POST', handleIntegrationsTestPost],
  ['playbooks||GET', handlePlaybooksGet],
  ['playbooks|run|POST', handlePlaybooksRunPost],
  ['ai|status|*', handleAiStatus],
  ['ai|generate|POST', handleAiGeneratePost],
  ['ai|analyze-campaign|POST', handleAiAnalyzeCampaignPost],
  ['ai|suggestions|POST', handleAiSuggestionsPost],
  ['ai|outputs|GET', handleAiOutputsGet],
  ['google-ads|insights|GET', handleGoogleAdsInsightsGet],
  ['google-ads|campaigns|GET', handleGoogleAdsCampaignsGet],
  ['financials|summary|*', handleFinancialsSummary],
  ['financials|settlements|*', handleFinancialsSettlements],
  ['financials|patients|*', handleFinancialsPatients],
  ['traceability|leads|*', handleTraceabilityLeads],
  ['traceability|funnel|*', handleTraceabilityFunnel],
  ['traceability|campaigns|*', handleTraceabilityCampaigns],
  ['conversations||*', handleConversations],
  ['figma-events||*', handleFigmaEvents],
  ['whatsapp|send|POST', handleWhatsappSend],
  ['kpis||GET', handleKpisGet],
  ['reports|doctoralia-financials|GET', handleReportsDoctoraliaFinancialsGet],
  ['reports|campaign-performance|GET', handleReportsCampaignPerformanceGet],
  ['reports|source-comparison|GET', handleReportsSourceComparisonGet],
  ['reports|whatsapp-conversion|GET', handleReportsWhatsappConversionGet],
  ['reports|doctor-performance|GET', handleReportsDoctorPerformanceGet],
  ['leads|reconcile|POST', handleLeadsReconcilePost],
]);


interface PublicRouteContext {
  req: Request;
  url: URL;
  resource: string;
  sub: string;
  sendJson: (data: unknown, status?: number, extraHeaders?: Record<string, string>) => Response;
}

export async function handlePublicRoutes(ctx: PublicRouteContext): Promise<Response | null> {
  const { req, url, resource, sub, sendJson } = ctx;

  if (resource === 'webhooks' && sub === 'meta' && req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const challenge = url.searchParams.get('hub.challenge');
    const verifyToken = url.searchParams.get('hub.verify_token');
    const expected = Deno.env.get('META_WEBHOOK_VERIFY_TOKEN') ?? Deno.env.get('META_VERIFY_TOKEN');
    if (!expected) return new Response('Verify token not configured', { status: 503 });
    if (mode === 'subscribe' && verifyToken === expected) {
      return new Response(challenge ?? '', { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }
    return new Response('Forbidden', { status: 403 });
  }

  if (resource === 'webhooks' && sub === 'meta' && req.method === 'POST') {
    const appSecret = Deno.env.get('META_APP_SECRET');
    const rawBody = await req.text();

    if (!appSecret && !IS_DEVELOPMENT) {
      return new Response('Meta App Secret not configured', { status: 500 });
    }

    if (appSecret) {
      const signature = req.headers.get('X-Hub-Signature-256') ?? '';
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw', enc.encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
      );
      const sig = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
      const expectedSig = 'sha256=' + Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
      if (signature !== expectedSig) return new Response('Unauthorized', { status: 403 });
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response('ok', { status: 200 });
    }
    if (payload.object !== 'page') return new Response('ok', { status: 200 });

    const adminClient = supabaseClientFactory.create(Deno.env.get('SUPABASE_URL') ?? null, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? null, {
      auth: { persistSession: false },
    });

    for (const entry of (payload.entry ?? [])) {
      for (const change of (entry.changes ?? [])) {
        if (change.field !== 'leadgen') continue;
        const val = change.value ?? {};
        const { leadgen_id, page_id } = val;
        if (!leadgen_id) continue;

        const { data: intgs } = await adminClient
          .from('integrations')
          .select('user_id, metadata')
          .eq('service', 'meta')
          .eq('status', 'connected');

        const connected = intgs ?? [];
        let matchingIntg = connected.find((i: any) => {
          const m = i.metadata ?? {};
          return m.pageId === page_id || m.page_id === page_id;
        });
        if (matchingIntg == null) {
          const noPageIdSet = connected.every((i: any) => !i.metadata?.pageId && !i.metadata?.page_id);
          if (noPageIdSet && connected.length === 1) {
            matchingIntg = connected[0];
          }
        }

        if (matchingIntg == null) {
          continue;
        }

        const webhookUserId = matchingIntg.user_id;
        const { data: credRow } = await adminClient
          .from('credentials')
          .select('encrypted_key')
          .eq('user_id', webhookUserId)
          .eq('service', 'meta')
          .single();
        if (!credRow) continue;

        let accessToken: string;
        try {
          accessToken = await publicRouteHelpers.decryptCred(credRow.encrypted_key);
        } catch {
          continue;
        }

        let leadData: any;
        try {
          leadData = await publicRouteHelpers.metaFetch(`/${leadgen_id}`, {
            fields: 'field_data,created_time,ad_id,ad_name,form_id,form_name,campaign_id,adset_id,page_id',
          }, accessToken);
        } catch {
          continue;
        }

        await publicRouteHelpers.processLeadData(adminClient, webhookUserId, leadData);
      }
    }

    return new Response('ok', { status: 200 });
  }

  if (resource === 'health' && sub === 'secrets' && req.method === 'GET') {
    const encryptionKeyRaw = String(Deno.env.get('ENCRYPTION_KEY') ?? '');
    const hasEncryptionKey = Boolean(encryptionKeyRaw.trim());
    const hasServiceKey = Boolean(String(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '').trim());
    const ok = hasEncryptionKey && hasServiceKey;

    return sendJson({
      success: ok,
      status: ok ? 'ok' : 'missing',
      required: {
        ENCRYPTION_KEY: hasEncryptionKey,
        SUPABASE_SERVICE_ROLE_KEY: hasServiceKey,
      },
    });
  }

  if (resource === 'health' && req.method === 'GET') {
    return sendJson({ success: true, status: 'ok', timestamp: new Date().toISOString() });
  }

  return null;
}

interface AuthenticatedRouteContext {
  adminClient: any;
  userId: string;
  authUser: any;
  resource: string;
  sub: string;
  sub2: string;
  req: Request;
  url: URL;
  sendJson: (data: unknown, status?: number, extraHeaders?: Record<string, string>) => Response;
  token: string;
}

async function handleAuthenticatedRoutes(ctx: AuthenticatedRouteContext): Promise<Response> {
  try {
    const candidateKeys = [
      `${ctx.resource}|${ctx.sub}|${ctx.req.method}`,
      `${ctx.resource}|${ctx.sub}|*`,
      `${ctx.resource}|*|*`,
    ];

    for (const key of candidateKeys) {
      const handler = AUTHENTICATED_ROUTE_HANDLERS.get(key);
      if (!handler) continue;
      const response = await handler(ctx);
      if (response) return response;
    }

    return ctx.sendJson({ success: false, message: `Route not found: ${ctx.resource}/${ctx.sub}` }, 404);
  } catch (err: any) {
    console.error('Edge Function error:', err);
    return ctx.sendJson({ success: false, message: err.message || 'Internal server error' }, 500);
  }
}

async function handleHealth(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { resource, sendJson } = ctx;
  if (resource === 'health') {
    return sendJson({ success: true, status: 'ok', timestamp: new Date().toISOString() });
  }
  return null;
}

async function handleAuthMeGet(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, sendJson } = ctx;
  if (resource === 'auth' && sub === 'me' && req.method === 'GET') {
    const { data: { user: sbUser } } = await adminClient.auth.admin.getUserById(userId);
    if (!sbUser) return sendJson({ success: false, message: 'User not found' }, 404);
    return sendJson({
      success: true,
      user: {
        id: sbUser.id,
        email: sbUser.email,
        name: sbUser.user_metadata?.name ?? sbUser.email,
      },
    });
  }
  return null;
}

async function handleProductionAuditGet(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, sendJson } = ctx;
  if (resource === 'production' && sub === 'audit' && req.method === 'GET') {
    const [agentOutputs, metaCacheCount, leadsCount, publicUsers, authUsers, doctoraliaPatients, doctorsCount, treatmentTypesCount, activeMetaIntegration, latestMetaCache] = await Promise.all([
      adminClient.from('agent_outputs').select('id', { count: 'exact', head: true }),
      adminClient.from('meta_cache').select('id', { count: 'exact', head: true }),
      adminClient.from('leads').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      adminClient.from('users').select('id', { count: 'exact', head: true }),
      Promise.resolve({ count: 0, error: null }),
      adminClient.from('doctoralia_patients').select('doc_patient_id', { count: 'exact', head: true }),
      adminClient.from('doctors').select('id', { count: 'exact', head: true }),
      adminClient.from('treatment_types').select('id', { count: 'exact', head: true }),
      adminClient.from('integrations').select('metadata').eq('user_id', userId).eq('service', 'meta').single(),
      adminClient.from('meta_cache').select('updated_at').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (agentOutputs.error) throw agentOutputs.error;
    if (metaCacheCount.error) throw metaCacheCount.error;
    if (leadsCount.error) throw leadsCount.error;
    if (publicUsers.error) throw publicUsers.error;
    if (authUsers.error) throw authUsers.error;
    if (doctoraliaPatients.error) throw doctoraliaPatients.error;
    if (doctorsCount.error) throw doctorsCount.error;
    if (treatmentTypesCount.error) throw treatmentTypesCount.error;
    if (activeMetaIntegration.error) throw activeMetaIntegration.error;
    if (latestMetaCache.error) throw latestMetaCache.error;
  
    const metadata = activeMetaIntegration.data?.metadata ?? {};
    const pageId = metadata.pageId ?? metadata.page_id ?? null;
    const adAccountId = metadata.adAccountId ?? metadata.ad_account_id ?? null;
    const publicUserDelta = Number(publicUsers.count ?? 0) - Number(authUsers.count ?? 0);
    const nowIso = new Date().toISOString();
  
    const [futureSettled, futureIntakes] = await Promise.all([
      adminClient.from('financial_settlements').select('id', { count: 'exact', head: true }).gt('settled_at', nowIso),
      adminClient.from('financial_settlements').select('id', { count: 'exact', head: true }).gt('intake_at', nowIso),
    ]);
    if (futureSettled.error) throw futureSettled.error;
    if (futureIntakes.error) throw futureIntakes.error;

    const futureSettlementCount = Number(futureSettled.count ?? 0) + Number(futureIntakes.count ?? 0);
    const settlementWarnings = [];
    if (futureSettlementCount > 0) {
      settlementWarnings.push(`Detected ${futureSettlementCount} settlement rows with future dates. Verify whether these are pre-paid scheduled appointments or test data.`);
    }
  
    const doctoraliaWarnings = [];
    if (Number(doctoraliaPatients.count ?? 0) === 0) {
      doctoraliaWarnings.push('Detected 0 doctoralia_patients rows. Doctoralia patient normalization has not run or ingestion is missing.');
    }
    if (Number(doctorsCount.count ?? 0) === 0) {
      doctoraliaWarnings.push('Detected 0 doctors rows. Reference doctor catalog ingestion is empty and may block performance analysis.');
    }
    if (Number(treatmentTypesCount.count ?? 0) === 0) {
      doctoraliaWarnings.push('Detected 0 treatment_types rows. Reference treatment catalog ingestion is empty and may block performance analysis.');
    }
  
    return sendJson({
      success: true,
      audit: {
        counts: {
          agent_outputs: Number(agentOutputs.count ?? 0),
          meta_cache: Number(metaCacheCount.count ?? 0),
          leads: Number(leadsCount.count ?? 0),
          public_users: Number(publicUsers.count ?? 0),
          auth_users: Number(authUsers.count ?? 0),
          doctoralia_patients: Number(doctoraliaPatients.count ?? 0),
          doctors: Number(doctorsCount.count ?? 0),
          treatment_types: Number(treatmentTypesCount.count ?? 0),
        },
        user_mismatch: publicUserDelta,
        warnings: [
          ...(publicUserDelta !== 0 ? [
            publicUserDelta > 0
              ? `Detected ${publicUserDelta} public.users row(s) without matching auth.users. This can cause incorrect clinic_id resolution or empty results for affected users.`
              : `Detected ${Math.abs(publicUserDelta)} auth.users row(s) without matching public.users. This may indicate incomplete user cleanup.`
          ] : []),
          ...settlementWarnings,
          ...doctoraliaWarnings,
        ],
        financial_settlements: {
          future_settled_at: Number(futureSettled.count ?? 0),
          future_intake_at: Number(futureIntakes.count ?? 0),
        },
        doctoralia: {
          doctoralia_patients: Number(doctoraliaPatients.count ?? 0),
          doctors: Number(doctorsCount.count ?? 0),
          treatment_types: Number(treatmentTypesCount.count ?? 0),
        },
        meta: {
          pageId,
          adAccountId,
          lastMetaCacheUpdate: latestMetaCache.data?.updated_at ?? null,
        },
      },
    });
  }
  return null;
}

async function handleLeadsGet(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, url, sendJson } = ctx;
  if (resource === 'leads' && req.method === 'GET' && sub === '') {
    const source = url.searchParams.get('source');
    const stage = url.searchParams.get('stage');

    let query = adminClient
      .from('leads')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (source) query = query.eq('source', source);
    if (stage) query = query.eq('stage', stage);

    const { data, error } = await query;
    if (error) throw error;
    return sendJson({ success: true, leads: data, total: data.length });
  }
  return null;
}

async function handleLeadsDelete(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, sendJson } = ctx;
  if (resource === 'leads' && req.method === 'DELETE' && sub !== '') {
    const leadId = sub;
    const { error } = await adminClient
      .from('leads')
      .delete()
      .eq('id', leadId)
      .eq('user_id', userId);

    if (error) throw error;
    return sendJson({ success: true, message: 'Lead deleted' });
  }
  return null;
}

async function handleLeadsPost(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, req, sendJson } = ctx;
  if (resource === 'leads' && req.method === 'POST') {
    const body = await req.json();
    const payload = { ...body, user_id: userId };
    const source = String(payload?.source ?? '').trim();
    const externalId = String(payload?.external_id ?? '').trim();
  
    // Idempotent ingestion path: avoid 500 on repeated webhook/manual retries
    // when (user_id, source, external_id) already exists.
    if (source && externalId) {
      const { data, error } = await adminClient
        .from('leads')
        .upsert(payload, { onConflict: 'user_id,source,external_id', ignoreDuplicates: true })
        .select()
        .maybeSingle();
      if (error) throw error;
  
      if (data) {
        return sendJson({ success: true, lead: data, deduplicated: false }, 201);
      }
  
      const { data: existing, error: existingErr } = await adminClient
        .from('leads')
        .select('*')
        .eq('user_id', userId)
        .eq('source', source)
        .eq('external_id', externalId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (existingErr) throw existingErr;
  
      return sendJson({ success: true, lead: existing, deduplicated: true }, 200);
    }
  
    const { data, error } = await adminClient
      .from('leads')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return sendJson({ success: true, lead: data, deduplicated: false }, 201);
  }
  return null;
}

async function handleLeadsPatch(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, sendJson } = ctx;
  if (resource === 'leads' && req.method === 'PATCH' && sub !== '') {
    const leadId = sub;
    const body = await req.json();
    
    // Only allow updating specific fields
    const allowedFields = ['stage', 'name', 'phone', 'dni', 'notes', 'revenue'];
    const updateData: Record<string, any> = {};
    for (const field of allowedFields) {
      if (Object.hasOwn(body, field)) {
        updateData[field] = body[field];
      }
    }

    if (Object.keys(updateData).length === 0) {
      return sendJson({ success: false, message: 'No valid fields provided for update' }, 400);
    }

    const { data, error } = await adminClient
      .from('leads')
      .update(updateData)
      .eq('id', leadId)
      .eq('user_id', userId)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) return sendJson({ success: false, message: 'Lead not found' }, 404);

    return sendJson({ success: true, lead: data });
  }
  return null;
}

async function handleDashboardMetrics(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, url, sendJson } = ctx;
  if (resource === 'dashboard' && sub === 'metrics') {
    const { data: usr } = await adminClient.from('users').select('clinic_id').eq('id', userId).single();
    const clinicId = usr?.clinic_id;

    const days = Number.parseInt(url.searchParams.get('days') ?? '0');
    const fromParam = url.searchParams.get('from') ?? '';
    const toParam = url.searchParams.get('to') ?? '';
    const sourceFilter = url.searchParams.get('source') ?? '';

    let since = fromParam || (days > 0
      ? new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
      : null);
    const until = toParam || null;

    // Comparison period logic
    let prevSince: string | null = null;
    let prevUntil: string | null = since;
    if (days > 0) {
      const nowTs = Date.now();
      const currentSinceTs = since ? new Date(since).getTime() : nowTs - days * 86_400_000;
      prevSince = new Date(currentSinceTs - days * 86_400_000).toISOString().slice(0, 10);
      prevUntil = new Date(currentSinceTs).toISOString().slice(0, 10);
    }

    let leadsQuery = adminClient.from('leads').select('stage, revenue, source, created_at').eq('user_id', userId);
    if (since) leadsQuery = leadsQuery.gte('created_at', since);
    if (until) leadsQuery = leadsQuery.lte('created_at', until);
    if (sourceFilter) leadsQuery = leadsQuery.eq('source', sourceFilter);

    let prevLeadsQuery = adminClient.from('leads').select('stage, revenue, source, created_at').eq('user_id', userId);
    if (prevSince) prevLeadsQuery = prevLeadsQuery.gte('created_at', prevSince);
    if (prevUntil) prevLeadsQuery = prevLeadsQuery.lte('created_at', prevUntil);
    if (sourceFilter) prevLeadsQuery = prevLeadsQuery.eq('source', sourceFilter);

    let settlementsQuery = adminClient.from('financial_settlements')
      .select('amount_net, cancelled_at, settled_at, template_name')
      .eq('clinic_id', clinicId);
    if (since) settlementsQuery = settlementsQuery.gte('settled_at', since);
    if (until) settlementsQuery = settlementsQuery.lte('settled_at', until);

    let prevSettlementsQuery = adminClient.from('financial_settlements')
      .select('amount_net, cancelled_at, settled_at, template_name')
      .eq('clinic_id', clinicId);
    if (prevSince) prevSettlementsQuery = prevSettlementsQuery.gte('settled_at', prevSince);
    if (prevUntil) prevSettlementsQuery = prevSettlementsQuery.lte('settled_at', prevUntil);

    const [leadsRes, prevLeadsRes, intRes, settlementsRes, prevSettlementsRes] = await Promise.all([
      leadsQuery,
      prevLeadsQuery,
      adminClient.from('integrations').select('service, status').eq('user_id', userId),
      clinicId
        ? settlementsQuery
        : Promise.resolve({ data: [], error: null }),
      clinicId
        ? prevSettlementsQuery
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (leadsRes.error) throw leadsRes.error;
    type LeadMetric = { stage: any; revenue: any; source?: string };
    const leads: LeadMetric[] = leadsRes.data ?? [];
    const prevLeads: LeadMetric[] = prevLeadsRes.data ?? [];
    const integrations = intRes.data ?? [];
    const settlements = (settlementsRes.data ?? []).filter((r: any) => !r.cancelled_at);
    const prevSettlements = (prevSettlementsRes.data ?? []).filter((r: any) => !r.cancelled_at);
  
    const totalLeads = leads.length;
    const prevTotalLeads = prevLeads.length;

    const totalRevenue = leads.reduce((s: number, l: any) => s + Number(l.revenue || 0), 0);
    const prevTotalRevenue = prevLeads.reduce((s: number, l: any) => s + Number(l.revenue || 0), 0);

    const verifiedRevenue = settlements.reduce((s: number, r: any) => s + Number(r.amount_net), 0);
    const prevVerifiedRevenue = prevSettlements.reduce((s: number, r: any) => s + Number(r.amount_net), 0);

    const settledCount = settlements.length;
  
    const conversions = leads.filter((l: any) => l.stage === 'treatment' || l.stage === 'closed').length;
    const prevConversions = prevLeads.filter((l: any) => l.stage === 'treatment' || l.stage === 'closed').length;

    const conversionRate = totalLeads > 0 ? Number.parseFloat(((conversions / totalLeads) * 100).toFixed(1)) : 0;
    
    const calculateDelta = (curr: number, prev: number) => {
      if (prev === 0) return curr > 0 ? 100 : 0;
      return Number.parseFloat((((curr - prev) / prev) * 100).toFixed(1));
    };

    const deltas = {
      leads: calculateDelta(totalLeads, prevTotalLeads),
      revenue: calculateDelta(verifiedRevenue, prevVerifiedRevenue),
      conversions: calculateDelta(conversions, prevConversions),
    };

    const stages = ['lead', 'whatsapp', 'appointment', 'treatment', 'closed'];
    const byStage: Record<string, number> = {};
    for (const s of stages) byStage[s] = leads.filter((l: any) => l.stage === s).length;
    const bySource: Record<string, number> = {};
    for (const l of leads) {
      const sourceKey = String(l.source ?? 'unknown');
      bySource[sourceKey] = (bySource[sourceKey] || 0) + 1;
    }
    const connectedIntegrations = integrations.filter((i: any) => i.status === 'connected').length;
    return sendJson({
      success: true,
      metrics: {
        totalLeads, totalRevenue: Number.parseFloat(totalRevenue.toFixed(2)),
        verifiedRevenue: Number.parseFloat(verifiedRevenue.toFixed(2)),
        settledCount,
        conversions, conversionRate, byStage, bySource,
        connectedIntegrations, totalIntegrations: integrations.length,
        deltas,
      },
    });
  }
  return null;
}

async function handleDashboardLeadFlow(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, sendJson } = ctx;
  if (resource === 'dashboard' && sub === 'lead-flow') {
    const { data: leads } = await adminClient
      .from('leads').select('stage, created_at').eq('user_id', userId);
    const stages = ['lead', 'whatsapp', 'appointment', 'treatment', 'closed'];
    const total = (leads ?? []).length || 1;
    const funnel = stages.map(stage => ({
      stage, label: stage,
      count: (leads ?? []).filter((l: any) => l.stage === stage).length,
      percentage: Number.parseFloat((((leads ?? []).filter((l: any) => l.stage === stage).length / total) * 100).toFixed(1)),
    }));
    return sendJson({ success: true, funnel });
  }
  return null;
}

async function handleDashboardMetaTrends(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, url, sendJson } = ctx;
  if (resource === 'dashboard' && sub === 'meta-trends') {
    const creds = await resolveMetaCreds(adminClient, userId, url.searchParams.get('adAccountId') ?? '');
    const validation = validateMetaCredentialResult(creds);
    if (!validation.ok) {
      return sendJson({ success: false, message: validation.message }, validation.statusCode);
    }
    try {
      const trendDays = Number.parseInt(url.searchParams.get('days') ?? '30');
      const fromParam = url.searchParams.get('from');
      const toParam = url.searchParams.get('to');
      const campaignId = url.searchParams.get('campaign_id');

      const since = fromParam || new Date(Date.now() - trendDays * 86_400_000).toISOString().slice(0, 10);
      const until = toParam || new Date().toISOString().slice(0, 10);

      const params: Record<string, string> = {
        fields: 'date_start,impressions,reach,clicks,spend,ctr,cpc,cpm,conversions',
        time_range: JSON.stringify({ since, until }),
        time_increment: '1',
        limit: '1000',
      };

      if (campaignId) {
        params.filtering = JSON.stringify([{ field: 'campaign.id', operator: 'EQUAL', value: campaignId }]);
      }

      const data = await metaFetch(`/${creds.adAccountId}/insights`, params, creds.accessToken);
  
      const trends: any[] = data.data ?? [];
      const sumN = (arr: any[], k: string) => arr.reduce((s: number, d: any) => s + Number.parseFloat(d[k] || 0), 0);
      const avgN = (arr: any[], k: string) => arr.length ? sumN(arr, k) / arr.length : 0;
      const pct = (a: number, b: number) => b > 0 ? Math.round(((a - b) / b) * 100) : 0;
  
      const last7 = trends.slice(-7);
      const prev7 = trends.slice(-14, -7);
  
      const agg = (arr: any[]) => ({
        impressions: Math.round(sumN(arr, 'impressions')),
        reach: Math.round(sumN(arr, 'reach')),
        clicks: Math.round(sumN(arr, 'clicks')),
        spend: Number.parseFloat(sumN(arr, 'spend').toFixed(2)),
        conversions: Math.round(sumN(arr, 'conversions')),
        ctr: Number.parseFloat(avgN(arr, 'ctr').toFixed(2)),
        cpc: Number.parseFloat(avgN(arr, 'cpc').toFixed(2)),
        cpm: Number.parseFloat(avgN(arr, 'cpm').toFixed(2)),
      });
  
      const thisWeek = agg(last7);
      const prevWeek = agg(prev7);
  
      const result = {
        success: true,
        source: 'live',
        cached: false,
        accountId: creds.adAccountId,
        trends,
        summary: { thisWeek },
        wow: {
          impressions: pct(thisWeek.impressions, prevWeek.impressions),
          clicks: pct(thisWeek.clicks, prevWeek.clicks),
          spend: pct(thisWeek.spend, prevWeek.spend),
        },
        mom: {
          spend: pct(thisWeek.spend, prevWeek.spend),
        },
      };
  
      // Cache successful response
      await setMetaCache(adminClient, userId, 'dashboard:meta-trends', result);
      return sendJson(result);
    } catch (e: any) {
      const cached = await getMetaCache(adminClient, userId, 'dashboard:meta-trends');
      if (cached) {
        return sendJson({
          ...cached.data,
          source: cached.data?.source || 'cache',
          cached: true,
          degraded: true,
          accountId: creds.adAccountId,
          last_success: cached.updated_at,
          message: `Meta API error: ${e.message}. Showing cached data.`
        });
      }
      return sendJson({ success: false, message: e.message }, 502);
    }
  }
  return null;
}

async function handleMetaInsightsGet(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, url, sendJson } = ctx;
      if (resource === 'meta' && sub === 'insights' && req.method === 'GET') {
        const creds = await resolveMetaCreds(adminClient, userId, url.searchParams.get('adAccountId') ?? '');
        const validation = validateMetaCredentialResult(creds);
        if (!validation.ok) {
          const payload: any = { success: false, message: validation.message };
          if (validation.statusCode === 400) payload.notConnected = creds.notConnected || !creds.adAccountId;
          return sendJson(payload, validation.statusCode);
        }
  
        const days = Number.parseInt(url.searchParams.get('days') ?? '30');
        const fromParam = url.searchParams.get('from');
        const toParam = url.searchParams.get('to');
        const campaignId = url.searchParams.get('campaign_id');

        const since = fromParam || new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
        const until = toParam || new Date().toISOString().slice(0, 10);
        const prevSince = new Date(new Date(since).getTime() - days * 86_400_000).toISOString().slice(0, 10);

        const fields = 'date_start,impressions,reach,clicks,spend,ctr,cpc,cpm,frequency,conversions,cost_per_conversion,unique_clicks,actions';
  
        try {
          const params: Record<string, string> = {
            fields,
            time_range: JSON.stringify({ since, until }),
            time_increment: '1',
            limit: '1000',
          };

          if (campaignId) {
            params.filtering = JSON.stringify([{ field: 'campaign.id', operator: 'EQUAL', value: campaignId }]);
          }

          const prevParams: Record<string, string> = {
            fields: 'impressions,reach,clicks,spend,conversions,cost_per_conversion',
            time_range: JSON.stringify({ since: prevSince, until: since }),
          };

          if (campaignId) {
            prevParams.filtering = JSON.stringify([{ field: 'campaign.id', operator: 'EQUAL', value: campaignId }]);
          }

          const [currRes, prevRes, acctRes] = await Promise.allSettled([
            metaFetch(`/${creds.adAccountId}/insights`, params, creds.accessToken),
            metaFetch(`/${creds.adAccountId}/insights`, prevParams, creds.accessToken),
            metaFetch(`/${creds.adAccountId}`, { fields: 'currency' }, creds.accessToken),
          ]);
  
          if (currRes.status === 'rejected') {
            throw currRes.reason;
          }
          const currency: string = acctRes.status === 'fulfilled' ? (acctRes.value?.currency ?? 'EUR') : 'EUR';
  
          const daily = currRes.value.data ?? [];
          const prevD = prevRes.status === 'fulfilled' ? (prevRes.value.data?.[0] ?? {}) : {};
          const sumN = (arr: any[], k: string) => arr.reduce((s: number, d: any) => s + Number.parseFloat(d[k] || 0), 0);
  
          const curr = {
            impressions: Math.round(sumN(daily, 'impressions')),
            reach: Math.round(sumN(daily, 'reach')),
            clicks: Math.round(sumN(daily, 'clicks')),
            spend: Number.parseFloat(sumN(daily, 'spend').toFixed(2)),
            conversions: Math.round(sumN(daily, 'conversions')),
            messagingConversationStarted: daily.reduce((sum: number, day: any) => sum + actionValue(day.actions, isMessagingConversationAction), 0),
          };
          const ctr = curr.impressions > 0 ? Number.parseFloat(((curr.clicks / curr.impressions) * 100).toFixed(2)) : 0;
          const cpc = curr.clicks > 0 ? Number.parseFloat((curr.spend / curr.clicks).toFixed(2)) : 0;
          const cpm = curr.impressions > 0 ? Number.parseFloat((curr.spend / curr.impressions * 1000).toFixed(2)) : 0;
          const cpp = curr.conversions > 0 ? Number.parseFloat((curr.spend / curr.conversions).toFixed(2)) : 0;
          const prev = {
            impressions: Number.parseFloat(prevD.impressions ?? 0),
            reach: Number.parseFloat(prevD.reach ?? 0),
            clicks: Number.parseFloat(prevD.clicks ?? 0),
            spend: Number.parseFloat(prevD.spend ?? 0),
            conversions: Number.parseFloat(prevD.conversions ?? 0),
          };
          const pct = percentChange;
  
          const result = {
            success: true,
            source: 'live',
            cached: false,
            accountId: creds.adAccountId,
            currency,
            period: { since, until, days },
            summary: { ...curr, ctr, cpc, cpm, cpp },
            changes: {
              impressions: pct(curr.impressions, prev.impressions),
              reach: pct(curr.reach, prev.reach),
              clicks: pct(curr.clicks, prev.clicks),
              spend: pct(curr.spend, prev.spend),
              conversions: pct(curr.conversions, prev.conversions),
            },
            daily: daily.map((d: any) => ({
              date: d.date_start,
              impressions: Number.parseFloat(d.impressions || 0),
              reach: Number.parseFloat(d.reach || 0),
              clicks: Number.parseFloat(d.clicks || 0),
              spend: Number.parseFloat(d.spend || 0),
              ctr: Number.parseFloat(d.ctr || 0),
              cpc: Number.parseFloat(d.cpc || 0),
              cpm: Number.parseFloat(d.cpm || 0),
              messagingConversationStarted: actionValue(d.actions, isMessagingConversationAction),
            })),
          };
  
          await setMetaCache(adminClient, userId, `meta:insights:${days}`, result);
          return sendJson(result);
        } catch (e: any) {
          // Fallback 1: in-memory key-value cache
          const cached = await getMetaCache(adminClient, userId, `meta:insights:${days}`);
          if (cached) {
            return sendJson({
              ...cached.data,
              source: cached.data?.source || 'cache',
              cached: true,
              degraded: true,
              accountId: creds.adAccountId,
              last_success: cached.updated_at,
              message: `Meta API error: ${e.message}. Showing cached data.`
            });
          }

          // Fallback 2: persistent meta_daily_insights table
          const { data: dbRows, error: dbErr } = await adminClient
            .from('meta_daily_insights')
            .select('date,impressions,reach,clicks,spend,ctr,cpc,cpm,conversions,messaging_conversations')
            .eq('user_id', userId)
            .eq('ad_account_id', creds.adAccountId)
            .gte('date', since)
            .lte('date', until)
            .order('date', { ascending: true });

          if (!dbErr && Array.isArray(dbRows) && dbRows.length > 0) {
            const sumN = (arr: any[], k: string) => arr.reduce((s: number, d: any) => s + Number(d[k] || 0), 0);
            const dbSummary = {
              impressions: Math.round(sumN(dbRows, 'impressions')),
              reach: Math.round(sumN(dbRows, 'reach')),
              clicks: Math.round(sumN(dbRows, 'clicks')),
              spend: Number.parseFloat(sumN(dbRows, 'spend').toFixed(2)),
              conversions: Math.round(sumN(dbRows, 'conversions')),
              messagingConversationStarted: Math.round(sumN(dbRows, 'messaging_conversations')),
              ctr: dbRows.length ? Number.parseFloat((sumN(dbRows, 'ctr') / dbRows.length).toFixed(2)) : 0,
              cpc: dbRows.length ? Number.parseFloat((sumN(dbRows, 'cpc') / dbRows.length).toFixed(2)) : 0,
              cpm: dbRows.length ? Number.parseFloat((sumN(dbRows, 'cpm') / dbRows.length).toFixed(2)) : 0,
              cpp: 0,
            };
            return sendJson({
              success: true,
              source: 'db',
              cached: false,
              degraded: true,
              accountId: creds.adAccountId,
              currency: 'EUR',
              period: { since, until, days },
              summary: dbSummary,
              changes: {},
              daily: dbRows.map((r: any) => ({
                date: r.date,
                impressions: Number(r.impressions),
                reach: Number(r.reach),
                clicks: Number(r.clicks),
                spend: Number(r.spend),
                ctr: Number(r.ctr),
                cpc: Number(r.cpc),
                cpm: Number(r.cpm),
                messagingConversationStarted: Number(r.messaging_conversations),
              })),
              message: `Meta API unavailable. Showing ${dbRows.length} days from local DB (last backfill). Run POST /meta/backfill to refresh.`,
            });
          }

          return sendJson({ success: false, metaApiError: true, message: e.message }, 502);
        }
      }
  return null;
}

async function handleMetaBackfillPost(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, url, sendJson } = ctx;
  if (resource === 'meta' && sub === 'backfill' && req.method === 'POST') {
    const creds = await resolveMetaCreds(adminClient, userId, url.searchParams.get('adAccountId') ?? '');
    const validation = validateMetaCredentialResult(creds);
    if (!validation.ok) {
      return sendJson({ success: false, message: validation.message }, validation.statusCode);
    }
  
    // Allow up to 500 days so a one-time backfill can cover all of 2025 onward
    const days = Math.min(Math.max(Number.parseInt(url.searchParams.get('days') ?? '7'), 1), 500);
    const fromParam = url.searchParams.get('from');
    const sinceDate = fromParam || new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const untilDate = new Date().toISOString().slice(0, 10);
    const sinceTs = Math.floor(new Date(sinceDate).getTime() / 1000);

    // 1. Fetch and persist daily insights to meta_daily_insights
    const fields = 'date_start,impressions,reach,clicks,spend,ctr,cpc,cpm,conversions';
    let insightsDailyRows: any[] = [];
    try {
      const insightsRes = await metaFetch(`/${creds.adAccountId}/insights`, {
        fields, time_range: JSON.stringify({ since: sinceDate, until: untilDate }), time_increment: '1', limit: '1000',
      }, creds.accessToken);
      insightsDailyRows = insightsRes?.data ?? [];
      if (insightsDailyRows.length > 0) {
        const dbRows = insightsDailyRows.map((r: any) => ({
          user_id: userId,
          ad_account_id: creds.adAccountId,
          date: r.date_start,
          impressions: Math.round(Number(r.impressions || 0)),
          reach: Math.round(Number(r.reach || 0)),
          clicks: Math.round(Number(r.clicks || 0)),
          spend: Number(r.spend || 0),
          conversions: Math.round(Number(r.conversions || 0)),
          ctr: Number(r.ctr || 0),
          cpc: Number(r.cpc || 0),
          cpm: Number(r.cpm || 0),
          messaging_conversations: 0,
          updated_at: new Date().toISOString(),
        }));
        await adminClient
          .from('meta_daily_insights')
          .upsert(dbRows, { onConflict: 'user_id,ad_account_id,date' });
      }
    } catch (e: any) {
      console.warn('Meta backfill insights persist failed:', e?.message ?? e);
    }

    // 2. Fetch and ingest leads
    let totalFetched = 0;
    try {
      // Find all forms for this ad account
      const formsRes = await metaFetch(`/${creds.adAccountId}/leadgen_forms`, {
        fields: 'id,name', limit: '50'
      }, creds.accessToken);
      
      for (const form of (formsRes?.data ?? [])) {
        try {
          const leadsRes = await metaFetch(`/${form.id}/leads`, {
            fields: 'id,field_data,created_time,ad_id,ad_name,form_id,form_name,campaign_id,adset_id,page_id',
            filtering: JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: sinceTs }]),
            limit: '500'
          }, creds.accessToken);
          
          for (const leadData of (leadsRes?.data ?? [])) {
            const success = await processLeadData(adminClient, userId, leadData);
            if (success) totalFetched++;
          }
        } catch (formError: any) {
          console.warn(`Meta backfill failed for form ${form.id}:`, formError?.message ?? formError);
        }
      }
    } catch (e: any) {
      console.error('Backfill lead ingestion failed:', e?.message ?? e);
    }
  
    const backfillResult = {
      success: true,
      totalLeadsBackfilled: totalFetched,
      dailyInsightsPersisted: insightsDailyRows.length,
      since: sinceDate,
      until: untilDate,
      message: `Backfill completed (${sinceDate} → ${untilDate}). ${insightsDailyRows.length} daily insight rows persisted. ${totalFetched} leads ingested.`,
    };
    await setMetaCache(adminClient, userId, `meta:backfill:${creds.adAccountId}`, backfillResult);
    return sendJson(backfillResult);
  }
  return null;
}

async function handleHealthMeta(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, sendJson } = ctx;
  if (resource === 'health' && sub === 'meta') {
    try {
      const creds = await resolveMetaCreds(adminClient, userId, '');
      const validation = validateMetaCredentialResult(creds);
      if (!validation.ok) {
        return sendJson({ status: 'unhealthy', error: validation.message, timestamp: new Date().toISOString() }, 503);
      }
  
      // Simple ping to Meta API
      const me = await metaFetch('/me', { fields: 'id,name' }, creds.accessToken);
      return sendJson({
        status: 'healthy',
        meta_user: me?.name ?? 'Unknown',
        ad_account: creds.adAccountId,
        timestamp: new Date().toISOString()
      });
    } catch (e: any) {
      return sendJson({ status: 'unhealthy', error: e.message, timestamp: new Date().toISOString() }, 503);
    }
  }
  return null;
}

async function handleMetaCampaignsGet(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, url, sendJson } = ctx;
  if (resource === 'meta' && sub === 'campaigns' && req.method === 'GET') {
    const creds = await resolveMetaCreds(adminClient, userId, url.searchParams.get('adAccountId') ?? '');
    const validation = validateMetaCredentialResult(creds);
    if (!validation.ok) {
      const payload: any = { success: false, message: validation.message };
      if (validation.statusCode === 400) payload.notConnected = creds.notConnected || !creds.adAccountId;
      return sendJson(payload, validation.statusCode);
    }
    const campFrom = url.searchParams.get('from') ?? '';
    const campTo   = url.searchParams.get('to')   ?? '';
    const campDays = Number.parseInt(url.searchParams.get('days') ?? '30');
    // Use time_range for custom dates (no day cap); fall back to preset (max 90d)
    const insightsDateParam = campFrom && campTo
      ? `time_range(${JSON.stringify({ since: campFrom, until: campTo })})`
      : `date_preset(${campDays <= 7 ? 'last_7d' : campDays <= 14 ? 'last_14d' : campDays <= 30 ? 'last_30d' : 'last_90d'})`;
    try {
      const [data, campAcctRes] = await Promise.allSettled([
        metaFetch(`/${creds.adAccountId}/campaigns`, {
          fields: `id,name,status,objective,daily_budget,lifetime_budget,insights.${insightsDateParam}{impressions,reach,clicks,spend,ctr,cpc,cpm,conversions,cost_per_conversion}`,
          limit: '100',
        }, creds.accessToken),
        metaFetch(`/${creds.adAccountId}`, { fields: 'currency' }, creds.accessToken),
      ]);
      if (data.status === 'rejected') throw data.reason;
      const campCurrency: string = campAcctRes.status === 'fulfilled' ? (campAcctRes.value?.currency ?? 'EUR') : 'EUR';
  
      const result = {
        success: true,
        source: 'live',
        cached: false,
        accountId: creds.adAccountId,
        currency: campCurrency,
        campaigns: ((data.status === 'fulfilled' ? data.value?.data : null) ?? []).map((c: any) => {
          const ins = c.insights?.data?.[0];
          const conversions = parseMetaMetric(ins?.conversions);
          const cppRaw = parseMetaMetric(ins?.cost_per_conversion);
          let cpp: number | null = cppRaw;
          if (cpp <= 0) {
            cpp = conversions > 0 ? Number.parseFloat((Number.parseFloat(ins.spend || 0) / conversions).toFixed(2)) : null;
          }
          return {
            id: c.id,
            name: c.name,
            status: c.status,
            objective: c.objective?.replaceAll('_', ' ') ?? '',
            dailyBudget: c.daily_budget ? Number.parseFloat(c.daily_budget) / 100 : null,
            lifetimeBudget: c.lifetime_budget ? Number.parseFloat(c.lifetime_budget) / 100 : null,
            insights: ins ? {
              impressions: Number.parseFloat(ins.impressions || 0),
              reach: Number.parseFloat(ins.reach || 0),
              clicks: Number.parseFloat(ins.clicks || 0),
              spend: Number.parseFloat(ins.spend || 0),
              ctr: Number.parseFloat(ins.ctr || 0),
              cpc: Number.parseFloat(ins.cpc || 0),
              cpm: Number.parseFloat(ins.cpm || 0),
              conversions,
              cpp,
            } : null,
          };
        }),
      };
      await setMetaCache(adminClient, userId, `meta:campaigns`, result);
      return sendJson(result);
    } catch (e: any) {
      try {
        const fallback = await metaFetch(`/${creds.adAccountId}/campaigns`, {
          fields: 'id,name,status,objective,daily_budget,lifetime_budget',
          limit: '100',
        }, creds.accessToken);
  
        const fallbackResult = {
          success: true,
          source: 'live',
          cached: false,
          accountId: creds.adAccountId,
          campaigns: (fallback?.data ?? []).map((c: any) => ({
            id: c.id,
            name: c.name,
            status: c.status,
            objective: c.objective?.replaceAll('_', ' ') ?? '',
            dailyBudget: c.daily_budget ? Number.parseFloat(c.daily_budget) / 100 : null,
            lifetimeBudget: c.lifetime_budget ? Number.parseFloat(c.lifetime_budget) / 100 : null,
            insights: null,
          })),
          warning: 'Campaign insights are unavailable; returned campaign metadata only.',
        };
        await setMetaCache(adminClient, userId, `meta:campaigns`, fallbackResult);
        return sendJson(fallbackResult);
      } catch (fallbackError: any) {
        return sendJson({ success: false, metaApiError: true, message: fallbackError?.message ?? e?.message ?? 'Meta API error' }, 502);
      }
    }
  }
  return null;
}

async function handleAiAnalyzePost(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, sendJson } = ctx;
  if (resource === 'ai' && sub === 'analyze' && req.method === 'POST') {
    const body = await req.json();
    const { data, context = '' } = body;

    if (context.length > 10000 || JSON.stringify(data).length > 50000) {
      return sendJson({ success: false, message: 'Payload too large for analysis' }, 400);
    }

    const clinic = await resolveClinicMetadata(adminClient, userId);
    const prompt = [
      `Eres un experto en marketing digital para ${clinic.name}, una clínica de ${clinic.specialty} premium en ${clinic.city}.`,
      'Analiza los siguientes datos de Meta Ads y proporciona insights accionables para maximizar conversiones y reducir el CPL.',
      context ? `Contexto: ${context}` : '',
      '',
      `Datos:\n${JSON.stringify(data, null, 2)}`,
      '',
      'Responde EXACTAMENTE con este formato markdown:',
      '## Resumen de Rendimiento',
      '[2-3 líneas sobre el estado general]',
      '',
      '## ✅ Fortalezas',
      '• [dato específico con números]',
      '• [dato específico con números]',
      '• [dato específico con números]',
      '',
      '## ⚠️ Áreas de Mejora',
      '• [oportunidad con recomendación concreta]',
      '• [oportunidad con recomendación concreta]',
      '• [oportunidad con recomendación concreta]',
      '',
      '## 🚀 Acciones Esta Semana',
      '1. [acción específica y medible]',
      '2. [acción específica y medible]',
      '3. [acción específica y medible]',
      '',
      '## 🚨 Alertas',
      '[KPIs preocupantes o tendencias negativas a vigilar]',
      '',
      'Usa los números del dataset. Sé específico y orientado a resultados de clínica estética.',
    ].filter((l) => l !== undefined).join('\n');

    // Rate limit simple: máx 20 llamadas por hora por usuario
    const { data: recentCalls, error: rlError } = await adminClient
      .from('api_call_log')
      .select('id')
      .eq('user_id', userId)
      .eq('endpoint', 'ai/analyze')
      .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString());

    if (!rlError && recentCalls && recentCalls.length >= 20) {
      return sendJson(
        { success: false, message: 'Rate limit exceeded for AI analysis' },
        429,
      );
    }

    let analysis = '';
    let providerErrors: string[] = [];

    try {
      const aiResult = await runAiPrompt(adminClient, userId, prompt);
      analysis = aiResult.text;
      providerErrors = aiResult.providerErrors;

      await adminClient.from('api_call_log').insert({
        user_id: userId,
        endpoint: 'ai/analyze',
      });
    } catch (err: any) {
      const errorId = crypto.randomUUID?.() ?? `ai-${Date.now()}`;
      console.error('handleAiAnalyzePost error', { errorId, err });
      providerErrors = err?.providerErrors || [err?.message || 'unknown error'];
      return sendJson(
        {
          success: false,
          message: 'AI analysis failed',
          error_id: errorId,
          providerErrors,
        },
        500,
      );
    }

    const outputId = await persistAgentOutput(adminClient, userId, 'ai.analyze', { analysis }, {
      contextLength: String(context ?? '').length,
      providerErrors,
    });

    return sendJson({ success: true, analysis, outputId });
  }
  return null;
}

async function handleIntegrationsPatch(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, sendJson } = ctx;
  if (resource === 'integrations' && req.method === 'PATCH' && sub === '') {
    const body = await req.json().catch(() => ({}));
    const service = String(body.service ?? '').trim();
    if (!service) return sendJson({ success: false, message: 'service is required' }, 400);
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.metadata !== undefined) updates.metadata = body.metadata;
    if (body.status !== undefined) updates.status = body.status;
    const { error } = await adminClient
      .from('integrations')
      .update(updates)
      .eq('user_id', userId)
      .eq('service', service);
    if (error) throw error;
    return sendJson({ success: true, service });
  }
  return null;
}

async function handleIntegrationsValidateAllGet(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, sendJson } = ctx;
  if (resource === 'integrations' && req.method === 'GET' && sub === 'validate-all') {
    const { data, error } = await adminClient
      .from('integrations')
      .select('id, service, status, last_sync, last_error, metadata')
      .eq('user_id', userId)
      .order('service');
    if (error) throw error;
    const results = (data ?? []).map((intg: any) => ({
      service: intg.service,
      status: intg.status,
      valid: intg.status === 'connected',
      last_sync: intg.last_sync,
      last_error: intg.last_error,
    }));
    return sendJson({ success: true, integrations: results });
  }
  return null;
}

async function handleIntegrationsGet(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, sendJson } = ctx;
  if (resource === 'integrations' && req.method === 'GET' && sub === '') {
    const { data, error } = await adminClient
      .from('integrations')
      .select('id, service, status, last_sync, last_error, metadata')
      .eq('user_id', userId)
      .order('service');
    if (error) throw error;
    return sendJson({ success: true, integrations: data });
  }
  return null;
}

async function handleIntegrationsConnectPost(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, authUser, resource, sub, req, sendJson } = ctx;
  if (resource === 'integrations' && sub === 'connect' && req.method === 'POST') {
    const body = await req.json();
    const service = String(body.service ?? '').trim();
    if (!service) return sendJson({ success: false, message: 'service is required' }, 400);
    const reqToken = body.token;
    if (!reqToken) return sendJson({ success: false, message: 'token is required' }, 400);
  
    let metadata = body.metadata ?? {};
    if (service === 'meta') {
      const normalized = requireMetaAccountId(metadata?.adAccountId ?? metadata?.ad_account_id ?? '');
      const normalizedPageId = String(metadata?.pageId ?? metadata?.page_id ?? '').replaceAll(/\D/g, '');
      metadata = {
        ...metadata,
        adAccountId: normalized,
        ad_account_id: normalized,
        pageId: normalizedPageId,
        page_id: normalizedPageId,
      };
    }
    if (service === 'whatsapp') {
      const normalized = normalizePhoneNumberId(metadata?.phoneNumberId ?? metadata?.phone_number_id ?? '');
      if (!normalized) {
        return sendJson({ success: false, message: 'phoneNumberId is required for WhatsApp' }, 400);
      }
      metadata = {
        ...metadata,
        phoneNumberId: normalized,
        phone_number_id: normalized,
      };
    }
  
    await ensurePublicUserRow(adminClient, authUser);
    const encryptedKey = await encryptCred(String(reqToken).trim());
  
    const { error: credErr } = await adminClient
      .from('credentials')
      .upsert(
        {
          user_id: userId,
          service,
          encrypted_key: encryptedKey,
        },
        { onConflict: 'user_id,service' },
      );
    if (credErr) throw credErr;
  
    const { error: intErr } = await adminClient
      .from('integrations')
      .upsert(
        {
          user_id: userId,
          service,
          status: 'connected',
          metadata,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,service' },
      );
    if (intErr) throw intErr;
    return sendJson({ success: true, service, status: 'connected' });
  }
  return null;
}

async function handleIntegrationsTestPost(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, sendJson } = ctx;
  if (resource === 'integrations' && sub === 'test' && req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const service = String(body.service ?? '').trim();
  
    if (service === 'meta') {
      const creds = await resolveMetaCreds(adminClient, userId, body?.adAccountId ?? '');
      const validation = validateMetaCredentialResult(creds);
      if (!validation.ok) {
        await updateIntegrationStatus(adminClient, userId, 'meta', 'error', validation.message);
        return sendJson({ success: false, service, status: 'error', message: validation.message }, validation.statusCode);
      }
      try {
        const me = await metaFetch('/me', { fields: 'id,name' }, creds.accessToken);
        await updateIntegrationStatus(adminClient, userId, 'meta', 'connected', null);
        return sendJson({ success: true, service, status: 'connected', metadata: { accountName: me.name } });
      } catch (e: any) {
        await updateIntegrationStatus(adminClient, userId, 'meta', 'error', e.message);
        return sendJson({ success: false, service, status: 'error', message: e.message }, 502);
      }
    }
  
    const { data: cred } = await adminClient
      .from('credentials').select('service').eq('user_id', userId).eq('service', service).single();
    const status = cred ? 'connected' : 'error';
    return sendJson({ success: !!cred, service, status, metadata: {} });
  }
  return null;
}

async function handlePlaybooksGet(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, resource, sub, req, sendJson } = ctx;
  if (resource === 'playbooks' && req.method === 'GET' && sub === '') {
    const { data, error } = await adminClient
      .from('playbooks')
      .select(`
        id, slug, title, description, category, status, steps,
        run_count, last_run_at, created_at
      `)
      .neq('status', 'archived')
      .order('category')
      .order('title');
    if (error) throw error;
    const playbooks = (data ?? []).map((p: any) => ({
      id: p.id,
      slug: p.slug,
      name: p.title,
      title: p.title,
      description: p.description,
      category: p.category,
      status: p.status,
      steps: p.steps ?? [],
      runs: p.run_count ?? 0,
      successRate: null,
      lastRunAt: p.last_run_at ?? null,
    }));
    return sendJson({ success: true, playbooks });
  }
  return null;
}

async function handlePlaybooksRunPost(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, sub2, req, sendJson } = ctx;
  if (resource === 'playbooks' && sub2 === 'run' && req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const preferredProvider = String(body?.provider ?? '').trim();
    const { data: pb, error: pbErr } = await adminClient
      .from('playbooks').select('id, title, status, run_count').eq('slug', sub).single();
    if (pbErr || !pb) return sendJson({ success: false, message: `Playbook '${sub}' not found` }, 404);
    if (pb.status === 'archived') return sendJson({ success: false, message: 'Playbook is archived' }, 400);
  
    let generatedMessage = '';
    let providerUsed: 'gemini' | 'openai' | null = null;
    let providerErrors: string[] = [];
    const clinic = await resolveClinicMetadata(adminClient, userId);
    const strategyPrompt = [
      `Generate a concise WhatsApp message for playbook strategy: ${pb.title}.`,
      `Audience: ${clinic.specialty} clinic leads in ${clinic.city}.`,
      'Style: professional, warm, and action-oriented.',
      'Length: max 3 short paragraphs and one CTA.',
    ].join('\n');
  
    try {
      const aiResult = await runAiPrompt(adminClient, userId, strategyPrompt, preferredProvider);
      generatedMessage = aiResult.text;
      providerUsed = aiResult.provider;
      providerErrors = aiResult.providerErrors;
    } catch (err: any) {
      const errorId = crypto.randomUUID?.() ?? `pb-${Date.now()}`;
      console.error('handlePlaybooksRunPost error', { errorId, err, userId });
      const code = err?.code === 'PERMISSION_DENIED' ? 403 : 500;

      return sendJson(
        {
          success: false,
          message: code === 403 ? 'Not allowed to run this playbook' : 'Playbook execution failed',
          error_id: errorId,
        },
        code,
      );
    }
  
    const agentOutputId = await persistAgentOutput(
      adminClient,
      userId,
      'playbook.run',
      { playbookSlug: sub, playbookTitle: pb.title, status: 'success', generatedMessage },
      {
        playbookId: pb.id,
        source: 'api.playbooks.run',
        providerRequested: preferredProvider || null,
        providerUsed,
        providerErrors,
      },
    );
  
    const { data: exec, error: execErr } = await adminClient
      .from('playbook_executions')
      .insert({
        playbook_id: pb.id,
        user_id: userId,
        status: 'success',
        metadata: agentOutputId ? { agent_output_id: agentOutputId } : {},
        agent_output_id: agentOutputId,
      })
      .select().single();
    if (execErr) throw execErr;
    await adminClient.from('playbooks')
      .update({ run_count: pb.run_count + 1, last_run_at: new Date().toISOString() })
      .eq('id', pb.id);
    return sendJson({
      success: true,
      execution: {
        id: exec.id,
        playbookSlug: sub,
        playbookTitle: pb.title,
        status: exec.status,
        ranAt: exec.created_at,
        agentOutputId,
        generatedMessage,
      },
    });
  }
  return null;
}

async function handleAiStatus(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, sendJson } = ctx;
  if (resource === 'ai' && sub === 'status') {
    const { data: cred } = await adminClient
      .from('credentials').select('service').eq('user_id', userId).in('service', ['openai', 'gemini']);
    const hasAi = (cred ?? []).length > 0;
    return sendJson({ success: true, available: hasAi, provider: hasAi ? cred?.[0]?.service ?? null : null });
  }
  return null;
}

async function handleAiGeneratePost(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, sendJson } = ctx;
  if (resource === 'ai' && sub === 'generate' && req.method === 'POST') {
    const body = await req.json();
    const prompt = String(body?.prompt ?? '').trim();
    const provider = String(body?.provider ?? '').trim();
    const contentType = String(body?.contentType ?? '').trim();
    const playbookExecutionId = String(body?.playbookExecutionId ?? '').trim();
    if (!prompt) return sendJson({ success: false, message: 'prompt is required' }, 400);
  
    try {
      const { text, provider: usedProvider, providerErrors } = await runAiPrompt(adminClient, userId, prompt, provider);
      const outputId = await persistAgentOutput(adminClient, userId, 'ai_generation', { content: text }, {
        prompt,
        contentType: contentType || null,
        providerRequested: provider || null,
        providerUsed: usedProvider,
        providerErrors,
        source: 'api.ai.generate',
        playbookExecutionId: playbookExecutionId || null,
      });
  
      if (playbookExecutionId && outputId) {
        await linkAgentOutputToPlaybookExecution(adminClient, userId, playbookExecutionId, outputId);
      }
      return sendJson({ success: true, content: text, result: text, provider: usedProvider, outputId });
    } catch (err: any) {
      const message = err?.message ?? 'AI request failed';
      const details = Array.isArray(err.providerErrors) ? err.providerErrors : undefined;
      return sendJson({ success: false, message, details }, 502);
    }
  }
  return null;
}

async function handleAiAnalyzeCampaignPost(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, sendJson } = ctx;
  if (resource === 'ai' && sub === 'analyze-campaign' && req.method === 'POST') {
    const body = await req.json();
    const campaignData = String(body?.campaignData ?? '').trim();
    const provider = String(body?.provider ?? '').trim();
    const playbookExecutionId = String(body?.playbookExecutionId ?? '').trim();
    if (!campaignData) return sendJson({ success: false, message: 'campaignData is required' }, 400);
  
    const clinic = await resolveClinicMetadata(adminClient, userId);
    const prompt = [
      `You are a performance marketer for ${clinic.name}, a premium ${clinic.specialty} clinic in ${clinic.city}.`,
      'Analyze the campaign data and provide actionable recommendations to improve conversion and reduce CPL.',
      '',
      campaignData,
    ].join('\n');
  
    try {
      const { text, provider: usedProvider, providerErrors } = await runAiPrompt(adminClient, userId, prompt, provider);
      const outputId = await persistAgentOutput(adminClient, userId, 'ai.analyze-campaign', { analysis: text }, {
        providerRequested: provider || null,
        providerUsed: usedProvider,
        providerErrors,
        source: 'api.ai.analyze-campaign',
        playbookExecutionId: playbookExecutionId || null,
      });
  
      if (playbookExecutionId && outputId) {
        await linkAgentOutputToPlaybookExecution(adminClient, userId, playbookExecutionId, outputId);
      }
      return sendJson({ success: true, analysis: text, provider: usedProvider, outputId });
    } catch (err: any) {
      return sendJson({ success: false, message: err?.message ?? 'AI request failed' }, 502);
    }
  }
  return null;
}

async function handleAiSuggestionsPost(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, sendJson } = ctx;
  if (resource === 'ai' && sub === 'suggestions' && req.method === 'POST') {
    const { data: leads } = await adminClient.from('leads').select('stage, source, revenue').eq('user_id', userId);
    const total = (leads ?? []).length;
    const suggestions = total === 0
      ? [
          'Add your first lead to get AI-powered insights',
          'Connect Meta Ads to start tracking ad performance',
          'Set up WhatsApp integration to automate follow-ups',
        ]
      : [
          `You have ${total} leads — focus on moving ${(leads ?? []).filter((l: any) => l.stage === 'whatsapp').length} WhatsApp leads to appointment`,
          `${(leads ?? []).filter((l: any) => l.stage === 'appointment').length} appointments pending — send follow-up reminders`,
          `Total pipeline value: €${(leads ?? []).reduce((s: number, l: any) => s + Number(l.revenue || 0), 0).toLocaleString()}`,
        ];
  
    const outputId = await persistAgentOutput(adminClient, userId, 'ai.suggestions', {
      suggestions,
      totalLeads: total,
    }, {
      source: 'api.ai.suggestions',
    });
  
    return sendJson({ success: true, suggestions, outputId });
  }
  return null;
}

async function handleAiOutputsGet(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, url, sendJson } = ctx;
  if (resource === 'ai' && sub === 'outputs' && req.method === 'GET') {
    const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') ?? '20'), 1), 100);
    // Include both personal outputs and clinic-wide outputs (e.g. weekly reports)
    const clinicId = await resolveClinicId(adminClient, userId);
    let query = adminClient
      .from('agent_outputs')
      .select('id, agent_type, output, metadata, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (clinicId) {
      query = query.or(`user_id.eq.${userId},clinic_id.eq.${clinicId}`);
    } else {
      query = query.eq('user_id', userId);
    }
    const { data, error } = await query;
    if (error) throw error;
  
    const outputIds = (data ?? []).map((r: any) => r.id).filter(Boolean);
    let executionByOutputId: Record<string, string> = {};
    if (outputIds.length > 0) {
      const { data: execRows } = await adminClient
        .from('playbook_executions')
        .select('id, agent_output_id')
        .eq('user_id', userId)
        .in('agent_output_id', outputIds);
      executionByOutputId = (execRows ?? []).reduce((acc: Record<string, string>, row: any) => {
        if (row?.agent_output_id) acc[row.agent_output_id] = row.id;
        return acc;
      }, {});
    }
  
    const outputs = (data ?? []).map((row: any) => ({
      ...row,
      playbook_execution_id: executionByOutputId[row.id] ?? null,
    }));
  
    return sendJson({ success: true, outputs });
  }
  return null;
}

async function handleGoogleAdsInsightsGet(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, url, sendJson } = ctx;
  if (resource === 'google-ads' && sub === 'insights' && req.method === 'GET') {
    const g = await resolveGoogleAdsCreds(adminClient, userId, url.searchParams.get('customerId') ?? '');
    if ('noServiceAccount' in g && g.noServiceAccount) return sendJson({ success: false, noServiceAccount: true, message: 'Google Ads service account not configured.' });
    if ('notConnected' in g && g.notConnected) return sendJson({ success: false, notConnected: true, message: 'Google Ads not connected. Add your developer token in Integrations.' });
    const { customerId, devToken, serviceAccount } = g;
    if (!customerId) return sendJson({ success: false, noAccountId: true, message: 'Google Ads Customer ID not configured.' });
    const days = Math.min(Math.max(Number.parseInt(url.searchParams.get('days') ?? '30', 10), 1), 90);
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const until = new Date().toISOString().slice(0, 10);
    const prevSince = new Date(Date.now() - days * 2 * 86_400_000).toISOString().slice(0, 10);
  
    const accessToken = await getGoogleAccessToken(serviceAccount);
  
    const [currRows, prevRows] = await Promise.allSettled([
      googleAdsSearch(customerId, devToken, accessToken, `
        SELECT segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros,
               metrics.conversions, metrics.ctr, metrics.average_cpc, metrics.average_cpm
        FROM customer
        WHERE segments.date BETWEEN '${since}' AND '${until}'
        ORDER BY segments.date
      `),
      googleAdsSearch(customerId, devToken, accessToken, `
        SELECT metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
        FROM customer
        WHERE segments.date BETWEEN '${prevSince}' AND '${since}'
      `),
    ]);
  
    const daily = currRows.status === 'fulfilled' ? currRows.value : [];
    const prevData = prevRows.status === 'fulfilled' ? prevRows.value : [];
  
    const micros2eur = (m: number) => Number.parseFloat((m / 1_000_000).toFixed(2));
    const sumF = (rows: any[], field: string) => rows.reduce((s, r) => s + (Number(r.metrics?.[field] ?? 0)), 0);
  
    const currImp = Math.round(sumF(daily, 'impressions'));
    const currClicks = Math.round(sumF(daily, 'clicks'));
    const currSpend = micros2eur(sumF(daily, 'costMicros'));
    const currConv = Math.round(sumF(daily, 'conversions'));
    const prevImp = Math.round(sumF(prevData, 'impressions'));
    const prevClicks = Math.round(sumF(prevData, 'clicks'));
    const prevSpend = micros2eur(sumF(prevData, 'costMicros'));
    const prevConv = Math.round(sumF(prevData, 'conversions'));
  
    const ctr = currImp > 0 ? Number.parseFloat(((currClicks / currImp) * 100).toFixed(2)) : 0;
    const cpc = currClicks > 0 ? Number.parseFloat((currSpend / currClicks).toFixed(2)) : 0;
    const cpm = currImp > 0 ? Number.parseFloat((currSpend / currImp * 1000).toFixed(2)) : 0;
    const cpp = currConv > 0 ? Number.parseFloat((currSpend / currConv).toFixed(2)) : 0;
    const pct = percentChange;
  
    return sendJson({
      success: true,
      period: { since, until, days },
      summary: { impressions: currImp, clicks: currClicks, spend: currSpend, conversions: currConv, ctr, cpc, cpm, cpp },
      changes: {
        impressions: pct(currImp, prevImp),
        clicks: pct(currClicks, prevClicks),
        spend: pct(currSpend, prevSpend),
        conversions: pct(currConv, prevConv),
      },
      daily: daily.map((r: any) => ({
        date: r.segments?.date ?? '',
        impressions: Number(r.metrics?.impressions ?? 0),
        clicks: Number(r.metrics?.clicks ?? 0),
        spend: micros2eur(Number(r.metrics?.costMicros ?? 0)),
        ctr: Number.parseFloat(Number(r.metrics?.ctr ?? 0).toFixed(4)) * 100,
        cpc: micros2eur(Number(r.metrics?.averageCpc ?? 0)),
        cpm: micros2eur(Number(r.metrics?.averageCpm ?? 0)),
      })),
    });
  }
  return null;
}

async function handleGoogleAdsCampaignsGet(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, url, sendJson } = ctx;
  if (resource === 'google-ads' && sub === 'campaigns' && req.method === 'GET') {
    const g = await resolveGoogleAdsCreds(adminClient, userId, url.searchParams.get('customerId') ?? '');
    if ('noServiceAccount' in g && g.noServiceAccount) return sendJson({ success: false, noServiceAccount: true, message: 'Google Ads service account not configured.' });
    if ('notConnected' in g && g.notConnected) return sendJson({ success: false, notConnected: true, message: 'Google Ads not connected.' });
    const { customerId, devToken, serviceAccount } = g;
    if (!customerId) return sendJson({ success: false, noAccountId: true, message: 'Google Ads Customer ID not configured.' });
    const accessToken = await getGoogleAccessToken(serviceAccount);
    const rows = await googleAdsSearch(customerId, devToken, accessToken, `
      SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
             campaign_budget.amount_micros,
             metrics.impressions, metrics.clicks, metrics.cost_micros,
             metrics.conversions, metrics.ctr, metrics.average_cpc, metrics.cost_per_conversion
      FROM campaign
      WHERE segments.date DURING LAST_30_DAYS
        AND campaign.status != 'REMOVED'
      ORDER BY metrics.cost_micros DESC
      LIMIT 50
    `);
  
    const micros2eur = (m: number) => m > 0 ? Number.parseFloat((m / 1_000_000).toFixed(2)) : null;
    return sendJson({
      success: true,
      campaigns: rows.map((r: any) => ({
        id: r.campaign?.id ?? '',
        name: r.campaign?.name ?? '',
        status: r.campaign?.status ?? '',
        type: (r.campaign?.advertisingChannelType ?? '').replaceAll('_', ' '),
        budget: micros2eur(Number(r.campaignBudget?.amountMicros ?? 0)),
        insights: {
          impressions: Number(r.metrics?.impressions ?? 0),
          clicks: Number(r.metrics?.clicks ?? 0),
          spend: micros2eur(Number(r.metrics?.costMicros ?? 0)) ?? 0,
          conversions: Number(r.metrics?.conversions ?? 0),
          ctr: Number.parseFloat((Number(r.metrics?.ctr ?? 0) * 100).toFixed(2)),
          cpc: micros2eur(Number(r.metrics?.averageCpc ?? 0)),
          cpp: micros2eur(Number(r.metrics?.costPerConversion ?? 0)),
        },
      })),
    });
  }
  return null;
}

async function handleFinancialsSummary(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, url, sendJson } = ctx;
  if (resource === 'financials' && sub === 'summary') {
    const { data: usr } = await adminClient.from('users').select('clinic_id').eq('id', userId).single();
    const clinicId = usr?.clinic_id;
    if (!clinicId) return sendJson({ success: false, message: 'No clinic' }, 400);

    const fromParam = url.searchParams.get('from') ?? '';
    const toParam = url.searchParams.get('to') ?? '';

    let query = adminClient
      .from('financial_settlements')
      .select('amount_gross, amount_discount, amount_net, template_name, settled_at, intake_at, cancelled_at')
      .eq('clinic_id', clinicId)
      .order('settled_at', { ascending: false });
    if (fromParam) query = query.gte('settled_at', fromParam);
    if (toParam) query = query.lte('settled_at', toParam);

    const { data: rows } = await query;
  
    const settled = (rows || []).filter((r: any) => !r.cancelled_at);
    const totalNet = settled.reduce((s: number, r: any) => s + Number(r.amount_net), 0);
    const totalGross = settled.reduce((s: number, r: any) => s + Number(r.amount_gross), 0);
    const totalDiscount = settled.reduce((s: number, r: any) => s + Number(r.amount_discount), 0);
    const avgTicket = settled.length ? totalNet / settled.length : 0;
    // Use stored discount when available; fall back to (gross - net) for sources that
    // don't export a separate discount column (e.g. Doctoralia net-only exports).
    const effectiveDiscount = totalDiscount > 0 ? totalDiscount : Math.max(0, totalGross - totalNet);
    const discountRate = totalGross > 0 ? (effectiveDiscount / totalGross) * 100 : 0;
  
    const liquidationDays = settled
      .filter((r: any) => r.intake_at)
      .map((r: any) => (new Date(r.settled_at).getTime() - new Date(r.intake_at).getTime()) / 86400000);
    const avgLiquidationDays = liquidationDays.length
      ? liquidationDays.reduce((a: number, b: number) => a + b, 0) / liquidationDays.length
      : 0;
  
    // Template mix
    const templateMap: Record<string, { count: number; net: number }> = {};
    for (const r of settled) {
      const t = r.template_name || 'Unknown';
      if (!templateMap[t]) templateMap[t] = { count: 0, net: 0 };
      templateMap[t].count++;
      templateMap[t].net += Number(r.amount_net);
    }
    const templateMix = Object.entries(templateMap).map(([name, v]) => ({
      name,
      count: v.count,
      net: Math.round(v.net * 100) / 100,
      pct: Math.round((v.net / totalNet) * 1000) / 10,
    })).sort((a, b) => b.net - a.net);
  
    // Monthly trend (last 6 months)
    const monthMap: Record<string, number> = {};
    for (const r of settled) {
      const m = r.settled_at?.slice(0, 7);
      if (m) monthMap[m] = (monthMap[m] || 0) + Number(r.amount_net);
    }
    const monthly = Object.entries(monthMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, net]) => ({ month, net: Math.round(net * 100) / 100 }));
  
    return sendJson({
      success: true,
      summary: {
        totalNet: Math.round(totalNet * 100) / 100,
        totalGross: Math.round(totalGross * 100) / 100,
        totalDiscount: Math.round(totalDiscount * 100) / 100,
        avgTicket: Math.round(avgTicket * 100) / 100,
        discountRate: Math.round(discountRate * 10) / 10,
        avgLiquidationDays: Math.round(avgLiquidationDays * 10) / 10,
        settledCount: settled.length,
        cancelledCount: (rows || []).length - settled.length,
      },
      templateMix,
      monthly,
      diagnostics: {
        reason: settled.length > 0 ? 'ok' : 'no_settlements',
        clinicId,
      },
    });
  }
  return null;
}

async function handleFinancialsSettlements(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, sendJson } = ctx;
  if (resource === 'financials' && sub === 'settlements') {
    const { data: usr } = await adminClient.from('users').select('clinic_id').eq('id', userId).single();
    const clinicId = usr?.clinic_id;
    if (!clinicId) return sendJson({ success: false, message: 'No clinic' }, 400);
  
    const { data: rows } = await adminClient
      .from('financial_settlements')
      .select('id, template_name, amount_gross, amount_discount, amount_net, settled_at, intake_at, cancelled_at')
      .eq('clinic_id', clinicId)
      .order('settled_at', { ascending: false })
      .limit(100);
  
    return sendJson({
      success: true,
      settlements: rows || [],
      diagnostics: {
        reason: rows?.length ? 'ok' : 'no_settlements',
        clinicId,
      },
    });
  }
  return null;
}

async function handleFinancialsPatients(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, sendJson } = ctx;
  if (resource === 'financials' && sub === 'patients') {
    const { data: usr } = await adminClient.from('users').select('clinic_id').eq('id', userId).single();
    const clinicId = usr?.clinic_id;
    if (!clinicId) return sendJson({ success: false, message: 'No clinic' }, 400);
  
    const { data: rows } = await adminClient
      .from('patients')
      .select('id, dni, name, email, phone, total_ltv, last_visit, created_at')
      .eq('clinic_id', clinicId)
      .order('total_ltv', { ascending: false });
  
    return sendJson({
      success: true,
      patients: rows || [],
      diagnostics: {
        reason: rows?.length ? 'ok' : 'no_patients',
        clinicId,
      },
    });
  }
  return null;
}

async function handleTraceabilityLeads(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, url, sendJson } = ctx;
  if (resource === 'traceability' && sub === 'leads') {
    const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') ?? '250'), 1), 500);
    const matchedOnly = url.searchParams.get('matched') === 'true';
    const from = url.searchParams.get('from') ?? '';
    const to   = url.searchParams.get('to')   ?? '';
    const source = url.searchParams.get('source') ?? '';
    const campaignName = url.searchParams.get('campaign_name') ?? '';

    let query = adminClient
      .from('vw_lead_traceability')
      .select(
        'lead_id,lead_name,source,campaign_name,lead_created_at,' +
        'patient_id,patient_name,patient_dni,patient_phone,patient_last_visit,patient_ltv,' +
        'doc_patient_id,match_confidence,match_class,' +
        'settlement_date,first_settlement_at,doctoralia_net,doctoralia_template_name'
      )
      .eq('lead_user_id', userId)
      .order('lead_created_at', { ascending: false })
      .limit(limit);

    if (matchedOnly) query = query.not('patient_id', 'is', null);
    if (from) query = query.gte('lead_created_at', from);
    if (to)   query = query.lte('lead_created_at', to + 'T23:59:59Z');
    if (source) query = query.eq('source', source);
    if (campaignName) query = query.ilike('campaign_name', `%${campaignName}%`);

    const { data: rows, error } = await query;
    if (error) throw error;

    return sendJson({ success: true, leads: rows || [], total: (rows || []).length });
  }
  return null;
}

async function handleTraceabilityFunnel(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, resource, sub, sendJson } = ctx;
  if (resource === 'traceability' && sub === 'funnel') {
    const { data: rows } = await adminClient.from('vw_whatsapp_conversion_real').select('*');
    return sendJson({ success: true, funnel: rows || [] });
  }
  return null;
}

async function handleTraceabilityCampaigns(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, resource, sub, url, sendJson } = ctx;
  if (resource === 'traceability' && sub === 'campaigns') {
    const from = url.searchParams.get('from') ?? '';
    const to   = url.searchParams.get('to')   ?? '';
    let query = adminClient
      .from('vw_campaign_performance_real')
      .select('*')
      .order('total_leads', { ascending: false });
    if (from) query = query.gte('first_lead_at', from);
    if (to)   query = query.lte('last_lead_at', to);
    const { data: rows } = await query;
    return sendJson({ success: true, campaigns: rows || [] });
  }
  return null;
}

async function handleConversations(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, url, sendJson } = ctx;
  if (resource === 'conversations' && sub === '') {
    const { data: usr } = await adminClient.from('users').select('clinic_id').eq('id', userId).single();
    const clinicId = usr?.clinic_id;
    if (!clinicId) return sendJson({ success: false, message: 'No clinic' }, 400);
  
    const leadId = url.searchParams.get('lead_id');
    let query = adminClient
      .from('whatsapp_conversations')
      .select('id, lead_id, phone, direction, message_type, message_preview, sent_at, delivered_at, read_at, replied_at')
      .eq('clinic_id', clinicId)
      .order('sent_at', { ascending: false })
      .limit(200);
  
    if (leadId) query = query.eq('lead_id', leadId);
  
    const { data: rows } = await query;
    return sendJson({ success: true, conversations: rows || [] });
  }
  return null;
}

async function handleFigmaEvents(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, resource, sub, url, sendJson } = ctx;
  if (resource === 'figma' && sub === 'events') {
    const limit = Math.min(Number.parseInt(url.searchParams.get('limit') || '20', 10), 50);
    const { data: rows } = await adminClient
      .from('figma_sync_log')
      .select('id, file_key, status, message, components_synced, tokens_synced, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    const events = (rows || []).map((r: any) => ({
      id: r.id,
      type: r.status === 'error' ? 'figma_error' : 'figma_sync',
      message: r.message || `Synced ${r.components_synced ?? 0} components`,
      fileKey: r.file_key,
      componentsSynced: r.components_synced,
      tokensSynced: r.tokens_synced,
      status: r.status,
      createdAt: r.created_at,
    }));
    return sendJson({ success: true, events });
  }
  return null;
}

async function handleWhatsappSend(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { resource, sub, sendJson } = ctx;
  if (resource === 'whatsapp' && sub === 'send') {
    return sendJson({ success: false, message: 'WhatsApp integration not connected. Add your credentials in Integrations.' }, 503);
  }
  return null;
}

async function handleKpisGet(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, sendJson } = ctx;
  if (resource === 'kpis' && sub === '' && req.method === 'GET') {
    const { data: usr } = await adminClient.from('users').select('clinic_id').eq('id', userId).single();
    const clinicId = usr?.clinic_id;
    if (!clinicId) return sendJson({ success: false, message: 'No clinic' }, 400);
  
    // Real Doctoralia KPIs (from financial_settlements)
    const { data: settlements } = await adminClient
      .from('financial_settlements')
      .select('amount_gross, amount_discount, amount_net, settled_at, intake_at, cancelled_at, template_name')
      .eq('clinic_id', clinicId);
  
    const settled = (settlements || []).filter((r: any) => !r.cancelled_at);
    const totalNet    = settled.reduce((s: number, r: any) => s + Number(r.amount_net), 0);
    const totalGross  = settled.reduce((s: number, r: any) => s + Number(r.amount_gross), 0);
    const avgTicket   = settled.length ? totalNet / settled.length : 0;
    const discountRate = totalGross ? (settled.reduce((s: number, r: any) => s + Number(r.amount_discount), 0) / totalGross) * 100 : 0;
    const lags = settled.filter((r: any) => r.intake_at).map((r: any) =>
      (new Date(r.settled_at).getTime() - new Date(r.intake_at).getTime()) / 86400000);
    const avgLag = lags.length ? lags.reduce((a: number, b: number) => a + b, 0) / lags.length : 0;
  
    // Real patient KPIs
    const { count: patientCount } = await adminClient
      .from('patients').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId);
  
    // Lead counts (will be 0 until Meta webhook fires)
    const { count: leadCount } = await adminClient
      .from('leads').select('id', { count: 'exact', head: true }).eq('user_id', userId);
    const { count: contactedCount } = await adminClient
      .from('leads').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).not('first_outbound_at', 'is', null);
    const { count: repliedCount } = await adminClient
      .from('leads').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).not('first_inbound_at', 'is', null);
  
    // Blocked KPIs
    const { data: blocked } = await adminClient
      .from('kpi_blocked')
      .select('kpi_name, kpi_group, blocked_reason, required_field');
  
    return sendJson({
      success: true,
      asOf: new Date().toISOString(),
      doctoralia: {
        settledCount: settled.length,
        cancelledCount: (settlements || []).length - settled.length,
        totalNet:    Math.round(totalNet * 100) / 100,
        totalGross:  Math.round(totalGross * 100) / 100,
        avgTicket:   Math.round(avgTicket * 100) / 100,
        discountRate: Math.round(discountRate * 10) / 10,
        avgLiquidationDays: Math.round(avgLag * 10) / 10,
      },
      acquisition: {
        totalLeads: leadCount ?? 0,
        contacted:  contactedCount ?? 0,
        replied:    repliedCount ?? 0,
        contactRate: leadCount ? Math.round(((contactedCount ?? 0) / leadCount) * 1000) / 10 : null,
        replyRate:   (contactedCount ?? 0) > 0 ? Math.round(((repliedCount ?? 0) / (contactedCount ?? 1)) * 1000) / 10 : null,
      },
      patients: {
        total: patientCount ?? 0,
      },
      blocked: blocked || [],
    });
  }
  return null;
}

async function handleReportsDoctoraliaFinancialsGet(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, url, sendJson } = ctx;
  if (resource === 'reports' && sub === 'doctoralia-financials' && req.method === 'GET') {
    const { data: usr } = await adminClient.from('users').select('clinic_id').eq('id', userId).single();
    const clinicId = usr?.clinic_id;
    if (!clinicId) return sendJson({ success: false, message: 'No clinic' }, 400);

    // settled_month is 'YYYY-MM'; compare date params truncated to 7 chars
    const fromMonth = (url.searchParams.get('from') ?? '').slice(0, 7);
    const toMonth   = (url.searchParams.get('to')   ?? '').slice(0, 7);

    let templateQ = adminClient
      .from('vw_doctoralia_financials')
      .select('*')
      .order('settled_month', { ascending: true });
    if (fromMonth) templateQ = templateQ.gte('settled_month', fromMonth);
    if (toMonth)   templateQ = templateQ.lte('settled_month', toMonth);
    const { data: byTemplate } = await templateQ;

    let monthQ = adminClient
      .from('vw_doctoralia_by_month')
      .select('*')
      .order('settled_month', { ascending: true });
    if (fromMonth) monthQ = monthQ.gte('settled_month', fromMonth);
    if (toMonth)   monthQ = monthQ.lte('settled_month', toMonth);
    const { data: byMonth } = await monthQ;
  
    // Template-level summary (collapse across months)
    const templateMap: Record<string, any> = {};
    for (const row of (byTemplate || [])) {
      const key = row.template_id || row.template_name;
      if (!templateMap[key]) {
        templateMap[key] = { template_id: row.template_id, template_name: row.template_name,
          operations_count: 0, total_net: 0, total_gross: 0, total_discount: 0,
          cancellation_count: 0, source_system: row.source_system };
      }
      templateMap[key].operations_count  += Number(row.operations_count ?? 0);
      templateMap[key].total_net         += Number(row.total_net ?? 0);
      templateMap[key].total_gross       += Number(row.total_gross ?? 0);
      templateMap[key].total_discount    += Number(row.total_discount ?? 0);
      templateMap[key].cancellation_count += Number(row.cancellation_count ?? 0);
    }
    const totalNetAll = Object.values(templateMap).reduce((s: any, t: any) => s + t.total_net, 0);
    const templateSummary = Object.values(templateMap).map((t: any) => ({
      ...t,
      total_net:    Math.round(t.total_net * 100) / 100,
      total_gross:  Math.round(t.total_gross * 100) / 100,
      avg_ticket:   t.operations_count ? Math.round((t.total_net / t.operations_count) * 100) / 100 : 0,
      revenue_share_pct: totalNetAll ? Math.round((t.total_net / totalNetAll) * 1000) / 10 : 0,
      cancellation_rate_pct: t.operations_count
        ? Math.round((t.cancellation_count / t.operations_count) * 1000) / 10 : 0,
    })).sort((a: any, b: any) => b.total_net - a.total_net);
  
    return sendJson({ success: true, byTemplate: byTemplate || [], byMonth: byMonth || [], templateSummary });
  }
  return null;
}

async function handleReportsCampaignPerformanceGet(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, resource, sub, req, url, sendJson } = ctx;
  if (resource === 'reports' && sub === 'campaign-performance' && req.method === 'GET') {
    const from = url.searchParams.get('from') ?? '';
    const to   = url.searchParams.get('to')   ?? '';
    let query = adminClient
      .from('vw_campaign_performance_real')
      .select('*')
      .order('total_leads', { ascending: false });
    if (from) query = query.gte('first_lead_at', from);
    if (to)   query = query.lte('last_lead_at', to);
    const { data: rows } = await query;
    return sendJson({ success: true, campaigns: rows || [] });
  }
  return null;
}

async function handleReportsSourceComparisonGet(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, resource, sub, req, url, sendJson } = ctx;
  if (resource === 'reports' && sub === 'source-comparison' && req.method === 'GET') {
    const from = url.searchParams.get('from') ?? '';
    const to   = url.searchParams.get('to')   ?? '';
    let query = adminClient
      .from('vw_source_comparison')
      .select('*')
      .order('total_leads', { ascending: false });
    if (from) query = query.gte('first_lead_at', from);
    if (to)   query = query.lte('last_lead_at', to);
    const { data: rows } = await query;
    return sendJson({ success: true, sources: rows || [] });
  }
  return null;
}

async function handleReportsWhatsappConversionGet(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, resource, sub, req, sendJson } = ctx;
  if (resource === 'reports' && sub === 'whatsapp-conversion' && req.method === 'GET') {
    const { data: rows } = await adminClient
      .from('vw_whatsapp_conversion_real')
      .select('*');
    return sendJson({ success: true, cohorts: rows || [] });
  }
  return null;
}

async function handleReportsDoctorPerformanceGet(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, resource, sub, req, sendJson } = ctx;
  if (resource === 'reports' && sub === 'doctor-performance' && req.method === 'GET') {
    const { data: rows } = await adminClient
      .from('vw_doctor_performance_real')
      .select('*')
      .order('total_appointments', { ascending: false });
    return sendJson({ success: true, doctors: rows || [] });
  }
  return null;
}

async function handleLeadsReconcilePost(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, resource, sub, sub2, req, sendJson } = ctx;
  if (resource === 'leads' && sub2 === 'reconcile' && req.method === 'POST') {
    const leadId = sub;
    if (!leadId) return sendJson({ success: false, message: 'lead id required' }, 400);
    const { data, error } = await adminClient.rpc('reconcile_lead_to_patient', { p_lead_id: leadId });
    if (error) return sendJson({ success: false, message: error.message }, 500);
    return sendJson({ success: true, matched: data !== null, patient_id: data ?? null });
  }
  return null;
}


Deno.serve(async (req: Request) => {
  try {
    return await handleRequest(req);
  } catch (topLevelErr: any) {
    console.error('Unhandled top-level error in handleRequest:', topLevelErr);
    return new Response(
      JSON.stringify({ success: false, message: topLevelErr?.message ?? 'Unexpected server error', stack: topLevelErr?.stack ?? '' }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } },
    );
  }
});

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  const payload: Record<string, unknown> = (data && typeof data === 'object') ? { ...(data as Record<string, unknown>) } : { data };
  const success = payload.success ?? (status < 400);
  const message = typeof payload.message === 'string' ? payload.message : null;
  const derivedData = Object.fromEntries(
    Object.entries(payload).filter(([key]) => !['success', 'data', 'error', 'message'].includes(key)),
  );

  if (!Object.hasOwn(payload, 'success')) payload.success = Boolean(success);
  if (!Object.hasOwn(payload, 'data')) {
    payload.data = Object.keys(derivedData).length > 0 ? derivedData : null;
  }
  if (payload.error === undefined) {
    payload.error = success ? null : (message ?? 'Request failed');
  }

  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...DEFAULT_CORS_HEADERS, ...extraHeaders, 'Content-Type': 'application/json' },
  });
}


