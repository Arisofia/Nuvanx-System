/** @ts-ignore: Deno global is provided by Supabase Edge Runtime */
declare const Deno: any;

import { createClient } from '@supabase/supabase-js';
import {
  ALLOWED_CORS_ORIGINS,
  DEFAULT_CORS_HEADERS,
  ENCRYPTION_KEY,
  IS_DEVELOPMENT,
  MCP_API_KEY,
  META_APP_SECRET,
  NORMALIZED_FRONTEND_URL,
  NUVANX_SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_URL,
  buildCorsHeaders,
  requireRuntimeSecret,
} from '../_shared/config.ts';
import { getPhoneNormalizationFailureReason, normalizePhoneForMeta } from '../_shared/phone.ts';

// ── Core Helpers ─────────────────────────────────────────────────────────────

function requireSupabaseEnv(value: string | null | undefined, name: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}

function hasOwn(obj: unknown, key: PropertyKey): boolean {
  return typeof obj === 'object' && obj !== null && Object.prototype.hasOwnProperty.call(obj, key);
}

export function isDedicatedServiceRoleBypass(token: string, dedicatedServiceKey: string | null | undefined): boolean {
  const normalizedToken = typeof token === 'string' ? token.trim() : '';
  const normalizedDedicatedKey = typeof dedicatedServiceKey === 'string' ? dedicatedServiceKey.trim() : '';
  return Boolean(normalizedToken && normalizedDedicatedKey && normalizedToken === normalizedDedicatedKey);
}

export function createAdminClient() {
  return supabaseClientFactory.create(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

// ── Supabase Client Factory ──────────────────────────────────────────────────

export const supabaseClientFactory = {
  create(url: string | null, key: string | null, options: any = {}) {
    return createClient(
      requireSupabaseEnv(url, 'SUPABASE_URL'),
      requireSupabaseEnv(key, 'SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY'),
      options,
    );
  },
};

// ── Web Crypto helpers (PBKDF2 + AES-256-GCM — mirrors backend encryption) ───
export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(hex.length >>> 1);
  const arr = new Uint8Array(buf);
  for (let i = 0; i < hex.length; i += 2) arr[i >>> 1] = Number.parseInt(hex.slice(i, i + 2), 16);
  return arr;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function encryptCred(raw: string): Promise<string> {
  const masterKey = ENCRYPTION_KEY;
  if (!masterKey) throw new Error('ENCRYPTION_KEY not set in Edge Function secrets');
  const salt = new Uint8Array(new ArrayBuffer(32));
  crypto.getRandomValues(salt);
  const iv = new Uint8Array(new ArrayBuffer(12));
  crypto.getRandomValues(iv);
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(masterKey), 'PBKDF2', false, ['deriveKey']);
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt.buffer, iterations: 100_000, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, ['encrypt'],
  );
  const ciphertextWithTag = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv.buffer },
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
  const masterKey = ENCRYPTION_KEY;
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
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
  );
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, combined));
}

// ── Meta Graph API ────────────────────────────────────────────────────────────
export const META_GRAPH = 'https://graph.facebook.com/v22.0';
const LEAD_TRACEABILITY_VIEW = 'vw_lead_traceability';

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
  const appSecret = META_APP_SECRET;
  if (appSecret) {
    url.searchParams.set('appsecret_proof', await computeAppsecretProof(token, appSecret));
  }
  const r = await fetch(url.toString(), { signal: AbortSignal.timeout(20_000) });
  const { data: d, text } = await parseJsonOrText(r);
  if (!r.ok) {
    const e = d && typeof d === 'object' ? d.error ?? {} : {};
    const errorMessageFromD = d && typeof d === 'object' ? d.message : undefined;
    const textValue = typeof text === 'string' ? text : '';
    const metaErrorMessage = e.message ?? errorMessageFromD ?? (textValue.trim() ? textValue : `Meta API ${r.status}`);
    const msg = `${metaErrorMessage} (code=${e.code ?? '?'}, sub=${e.error_subcode ?? '?'}, type=${e.type ?? '?'})`;
    throw new Error(msg);
  }
  return d;
}

async function metaFetchAll(path: string, params: Record<string, string>, token: string) {
  const allData: any[] = [];
  let nextParams: Record<string, string> = { ...params };

  while (true) {
    const response = await metaFetch(path, nextParams, token);
    if (!Array.isArray(response?.data)) break;
    allData.push(...response.data);

    const after = response?.paging?.cursors?.after;
    if (!after) break;
    nextParams = { ...params, after };
  }

  return allData;
}

function shouldRetryInsightFilterError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('filtering')
    || normalized.includes('invalid parameter')
    || normalized.includes('invalid field')
    || normalized.includes('invalid keys "values" were found in param "filtering[0]"')
    || normalized.includes('filtering field effective_status is invalid')
  );
}

function buildInsightsAlternateFiltering(originalFiltering: string) {
  try {
    const filters = JSON.parse(originalFiltering);
    if (!Array.isArray(filters)) return null;

    const alternates = filters.map((filter: any) => {
      if (filter.field === 'campaign_id') return { ...filter, field: 'campaign.id' };
      if (filter.field === 'campaign.id') return { ...filter, field: 'campaign_id' };
      return filter;
    });

    const hasAlternate = alternates.some((filter: any) => filter.field === 'campaign_id' || filter.field === 'campaign.id');
    return hasAlternate ? alternates : null;
  } catch {
    return null;
  }
}

function buildInsightsFallbackParams(params: Record<string, string>) {
  const fallbackParams = { ...params };
  delete fallbackParams.filtering;
  if (fallbackParams.fields && !fallbackParams.fields.includes('campaign_id')) {
    fallbackParams.fields = `${fallbackParams.fields},campaign_id`;
  }
  return fallbackParams;
}

async function metaFetchInsightsWithFallback(path: string, params: Record<string, string>, token: string, campaignId?: string) {
  try {
    return await metaFetch(path, params, token);
  } catch (err: any) {
    if (!campaignId || !params?.filtering) throw err;
    const message = String(err?.message ?? '');
    if (!shouldRetryInsightFilterError(message)) throw err;

    const originalFiltering = params.filtering;
    const alternates = originalFiltering ? buildInsightsAlternateFiltering(originalFiltering) : null;
    if (alternates) {
      const alternateParams = { ...params, filtering: JSON.stringify(alternates) };
      try {
        return await metaFetch(path, alternateParams, token);
      } catch {
        // Continue to full fallback below.
      }
    }

    const fallbackParams = buildInsightsFallbackParams(params);
    const data = await metaFetch(path, fallbackParams, token);
    if (Array.isArray(data?.data)) {
      return { ...data, data: data.data.filter((item: any) => String(item?.campaign_id) === String(campaignId)) };
    }
    return data;
  }
}

const DEFAULT_META_PIXEL_ID = Deno.env.get('META_PIXEL_ID') ?? '877262375461917';

async function sha256Hex(raw: string): Promise<string> {
  const data = new TextEncoder().encode(raw.trim().toLowerCase());
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digest));
}

async function hashMetaUserData(userData: Record<string, string[]>): Promise<Record<string, string[]>> {
  const hashed: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(userData)) {
    const cleanValues = values.filter(Boolean).map((value) => value.trim().toLowerCase());
    if (cleanValues.length === 0) continue;
    hashed[key] = [];
    for (const value of cleanValues) {
      hashed[key].push(await sha256Hex(value));
    }
  }
  return hashed;
}

async function metaPost(path: string, body: any, token: string) {
  const url = new URL(`${META_GRAPH}${path}`);
  url.searchParams.set('access_token', token);
  const appSecret = META_APP_SECRET;
  if (appSecret) {
    url.searchParams.set('appsecret_proof', await computeAppsecretProof(token, appSecret));
  }

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });

  const { data, text } = await parseJsonOrText(response);
  if (!response.ok) {
    const err = data?.error ?? {};
    const message = err.message ?? data?.message ?? text ?? `Meta API ${response.status}`;
    throw new Error(message);
  }
  return data;
}

async function trackMetaWhatsappConversion(
  accessToken: string,
  phone: string | null | undefined,
  email?: string | null,
  options: { eventId?: string; testEventCode?: string } = {},
) {
  return await trackMetaCapiEvent(accessToken, {
    eventName: 'Contact',
    eventId: options.eventId,
    actionSource: 'system_generated',
    userData: { ph: phone ?? null, em: email ?? null },
    customData: { source: 'whatsapp_crm_nuvanx' },
    testEventCode: options.testEventCode,
  });
}

interface MetaCapiUserData {
  ph?: string | null;
  em?: string | null;
  fn?: string | null;
  ln?: string | null;
  ct?: string | null;
  st?: string | null;
  zp?: string | null;
  country?: string | null;
}

interface MetaCapiEventInput {
  eventName: string;
  eventId?: string;
  eventTime?: number;
  eventSourceUrl?: string;
  actionSource?: string;
  userData: MetaCapiUserData;
  customData?: Record<string, unknown>;
  testEventCode?: string;
}

/**
 * Generic Meta Conversions API (CAPI) sender. Hashes PII before transport and
 * supports `event_id` for client/server deduplication and `test_event_code`
 * for verification in Events Manager → Test Events.
 */
async function trackMetaCapiEvent(accessToken: string, input: MetaCapiEventInput) {
  const userData: Record<string, string[]> = {};
  const phone = input.userData.ph ? normalizePhoneForMeta(input.userData.ph) : '';
  if (phone) userData.ph = [phone];
  if (input.userData.em) userData.em = [String(input.userData.em).trim().toLowerCase()];
  if (input.userData.fn) userData.fn = [String(input.userData.fn).trim().toLowerCase()];
  if (input.userData.ln) userData.ln = [String(input.userData.ln).trim().toLowerCase()];
  if (input.userData.ct) userData.ct = [String(input.userData.ct).trim().toLowerCase()];
  if (input.userData.st) userData.st = [String(input.userData.st).trim().toLowerCase()];
  if (input.userData.zp) userData.zp = [String(input.userData.zp).trim().toLowerCase()];
  if (input.userData.country) userData.country = [String(input.userData.country).trim().toLowerCase()];
  if (Object.keys(userData).length === 0) {
    throw new Error('At least one user_data field is required for CAPI events.');
  }
  const hashedUserData = await hashMetaUserData(userData);

  const event: Record<string, unknown> = {
    event_name: input.eventName,
    event_time: input.eventTime ?? Math.floor(Date.now() / 1000),
    action_source: input.actionSource ?? 'system_generated',
    user_data: hashedUserData,
  };
  if (input.eventId) event.event_id = input.eventId;
  if (input.eventSourceUrl) event.event_source_url = input.eventSourceUrl;
  if (input.customData) event.custom_data = input.customData;

  const payload: Record<string, unknown> = { data: [event] };
  const testCode = input.testEventCode ?? Deno.env.get('META_TEST_EVENT_CODE') ?? '';
  if (testCode) payload.test_event_code = testCode;

  return await metaPost(`/${DEFAULT_META_PIXEL_ID}/events`, payload, accessToken);
}

/**
 * Fire a Meta Conversions API `Lead` event. Use a stable `eventId` (e.g. the
 * Meta `leadgen_id`) to dedupe against any client-side pixel emission of the
 * same conversion.
 */
async function trackMetaLeadConversion(
  accessToken: string,
  input: {
    eventId: string;
    phone?: string | null;
    email?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    city?: string | null;
    state?: string | null;
    zipCode?: string | null;
    customData?: Record<string, unknown>;
    eventSourceUrl?: string;
    eventTime?: number;
    testEventCode?: string;
  },
) {
  return await trackMetaCapiEvent(accessToken, {
    eventName: 'Lead',
    eventId: input.eventId,
    eventTime: input.eventTime,
    eventSourceUrl: input.eventSourceUrl,
    actionSource: 'system_generated',
    userData: {
      ph: input.phone ?? null,
      em: input.email ?? null,
      fn: input.firstName ?? null,
      ln: input.lastName ?? null,
      ct: input.city ?? null,
      st: input.state ?? null,
      zp: input.zipCode ?? null,
    },
    customData: input.customData,
    testEventCode: input.testEventCode,
  });
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
    return parseMetaMetric(rawObj.value ?? 0);
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
    || type.includes('lead')
    || type.includes('contact')
    || type.includes('submit_application')
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
  const { data, error } = await adminClient.from('agent_outputs')
    .insert({
      user_id: userId,
      clinic_id: clinicId,
      agent_type: agentType,
      output_text: outputText,
      output,
      metadata,
      input_context: inputContext,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data?.id ?? null;
}

/**
 * Continuous-learning helper: load the last `limit` outputs of a given
 * agent_type for the user (or their clinic) so the next prompt can reference
 * them as memory. Always tolerant — returns [] on any error.
 */
async function fetchPriorAgentOutputs(
  adminClient: any,
  userId: string,
  agentType: string,
  limit = 5,
): Promise<Array<{ created_at: string; output_text: string }>> {
  try {
    const clinicId = await resolveClinicId(adminClient, userId);
    let query = adminClient
      .from('agent_outputs')
      .select('created_at, output_text')
      .eq('agent_type', agentType)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (clinicId) {
      query = query.or(`user_id.eq.${userId},clinic_id.eq.${clinicId}`);
    } else {
      query = query.eq('user_id', userId);
    }
    const { data, error } = await query;
    if (error) return [];
    return (data ?? []).filter((row: any) => row?.output_text);
  } catch {
    return [];
  }
}

/**
 * Format prior outputs as a markdown "memory" section to append to a prompt.
 * Each prior output is truncated so the combined context stays bounded.
 */
function buildPriorContextSection(prior: Array<{ created_at: string; output_text: string }>): string {
  if (!prior.length) return '';
  const PER_OUTPUT_CHAR_LIMIT = 1200;
  const items = prior.map((row) => {
    const date = row.created_at ? new Date(row.created_at).toISOString().slice(0, 10) : '';
    const body = String(row.output_text || '').slice(0, PER_OUTPUT_CHAR_LIMIT);
    return `### ${date}\n${body}`;
  });
  return [
    '',
    '## Memoria de análisis previos (aprendizaje continuo)',
    'Considera tendencias respecto a estos análisis anteriores y evita repetir recomendaciones ya emitidas si el problema sigue igual — propon nuevos ángulos.',
    ...items,
  ].join('\n');
}

async function linkAgentOutputToPlaybookExecution(adminClient: any, userId: string, playbookExecutionId: string, agentOutputId: string) {
  if (!playbookExecutionId || !agentOutputId) return;
  const { data: current, error: getErr } = await adminClient.from('playbook_executions')
    .select('id, metadata')
    .eq('id', playbookExecutionId)
    .eq('user_id', userId)
    .maybeSingle();
    if (getErr || !current) return;

    const nextMetadata = current.metadata
      ? { ...current.metadata, agent_output_id: agentOutputId }
      : { agent_output_id: agentOutputId };

  await adminClient.from('playbook_executions')
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
  const { data: creds } = await adminClient.from('credentials').select('service, encrypted_key').eq('user_id', userId).in('service', ['gemini', 'openai']);
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
        errors.push(getGeminiErrorMessage(model, data, text, r.status));
        continue;
      }
      const output = getGeminiOutput(data);
      if (output) return output;
      errors.push(`${model}: response missing generated text`);
    } catch (fetchErr: any) {
      errors.push(`${model}: fetch failed - ${fetchErr.message}`);
    }
  }
  throw new Error(`Gemini error: ${errors.join(' | ')}`);
}

function getGeminiErrorMessage(model: string, data: any, text: string, status: number): string {
  const message = data?.error?.message ?? data?.message ?? text ?? `Gemini ${status}`;
  return `${model}: ${message}`;
}

function getGeminiOutput(data: any): string | undefined {
  return data?.candidates?.[0]?.content?.parts?.[0]?.text;
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

function parseMetaLeadCreatedAt(rawTime: any): string {
  if (rawTime == null) return new Date().toISOString();
  if (typeof rawTime === 'number') return new Date(rawTime * 1000).toISOString();
  if (typeof rawTime === 'string' && /^\d+$/.test(rawTime)) return new Date(Number(rawTime) * 1000).toISOString();
  const parsed = new Date(rawTime);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function parseMetaLeadFields(fieldData: any[]): { fields: Record<string, string>; rawFieldData: Record<string, string> } {
  const fields: Record<string, string> = {};
  const rawFieldData: Record<string, string> = {};

  for (const item of (fieldData ?? [])) {
    const fieldName = String(item?.name ?? '').trim();
    if (!fieldName) continue;
    const value = String(item?.values?.[0] ?? item?.value ?? '').trim();
    fields[fieldName.toLowerCase()] = value;
    rawFieldData[fieldName] = value;
  }

  return { fields, rawFieldData };
}

function buildMetaLeadNotes(fields: Record<string, string>, tag: string): string | null {
  const KNOWN_STANDARD = new Set([
    'full_name', 'nombre_completo', 'nombre', 'name', 'first_name', 'last_name',
    'email', 'phone_number', 'telefono', 'phone', 'dni', 'nif', 'national_id',
    'city', 'ciudad', 'state', 'provincia', 'region',
    'zip_code', 'postal_code', 'zip', 'cp',
    'gender', 'sexo',
  ]);

  const customFields = Object.fromEntries(
    Object.entries(fields).filter(([key]) => !KNOWN_STANDARD.has(key)),
  );

  if (tag !== 'general') {
    customFields.meta_tag = tag;
  }

  return Object.keys(customFields).length > 0 ? JSON.stringify(customFields) : null;
}

function buildMetaLeadPriority(fields: Record<string, string>, notes: string | null): string {
  const HIGH_PRIORITY_KEYWORDS = /botox|bótox|neuromodulador|toxina\s*botulínica|botulínica|relleno|hialu|hialurón|rinomodelación|bichectomía|lifting/i;
  const allValues = Object.values(fields).join(' ') + ' ' + (notes ?? '');
  return HIGH_PRIORITY_KEYWORDS.test(allValues) ? 'high' : 'normal';
}

async function extractMetaLeadStandardFields(fields: Record<string, string>, leadData: any) {
  const leadgen_id = leadData.id;
  const leadName = resolveLeadName(fields, leadgen_id);
  const email = fields['email'] ?? null;
  const phone = fields['phone_number'] ?? fields['telefono'] ?? fields['phone'] ?? null;
  const dni = fields['dni'] ?? fields['nif'] ?? fields['national_id'] ?? null;
  const firstName = fields['first_name'] ?? fields['nombre'] ?? fields['nombre1'] ?? null;
  const lastName = fields['last_name'] ?? fields['apellido'] ?? fields['apellidos'] ?? null;
  const city = fields['city'] ?? fields['ciudad'] ?? null;
  const state = fields['state'] ?? fields['provincia'] ?? fields['region'] ?? null;
  const zipCode = fields['zip_code'] ?? fields['postal_code'] ?? fields['zip'] ?? fields['cp'] ?? null;
  const gender = fields['gender'] ?? fields['sexo'] ?? null;
  const metaPlatform = leadData.platform ?? leadData.meta_platform ?? null;
  const metaAdId = leadData.ad_id ?? null;
  const explicitOrganic = leadData.is_organic === true || String(leadData.is_organic).toLowerCase() === 'true';
  const explicitPaid = leadData.is_organic === false || String(leadData.is_organic).toLowerCase() === 'false';
  const inferredOrganic = !explicitPaid && !metaAdId && !leadData.campaign_id && !leadData.adset_id;
  const isOrganic = explicitOrganic || inferredOrganic;
  const metaAdName = leadData.ad_name ?? null;
  const metaFormId = leadData.form_id ?? null;
  const assetUrl = leadData.asset_url ?? leadData.image_url ?? leadData.video_url ?? null;

  const hashedPhone = phone ? await sha256Hex(phone) : null;
  const hashedEmail = email ? await sha256Hex(email) : null;

  return {
    leadgen_id,
    leadName,
    email,
    phone,
    dni,
    firstName,
    lastName,
    city,
    state,
    zipCode,
    gender,
    metaPlatform,
    metaAdId,
    isOrganic,
    metaAdName,
    metaFormId,
    assetUrl,
    hashedPhone,
    hashedEmail,
  };
}

function resolveLeadName(fields: Record<string, string>, leadgen_id: string): string {
  const firstName = fields['first_name'] ?? fields['nombre'] ?? fields['nombre1'] ?? '';
  const lastName = fields['last_name'] ?? fields['apellido'] ?? fields['apellidos'] ?? '';
  const explicitName = fields['full_name'] ?? fields['nombre_completo'] ?? fields['nombre'] ?? fields['name'] ?? '';

  if (explicitName) return explicitName;
  if (firstName && lastName) return `${firstName} ${lastName}`;
  if (firstName) return firstName;
  if (lastName) return lastName;
  return `Lead ${leadgen_id.slice(-6)}`;
}

function extractMetaLeadCustomerInfo(fieldData: any[]): Record<string, string> {
  return (Array.isArray(fieldData) ? fieldData : []).reduce((acc: Record<string, string>, item: any) => {
    const key = String(item?.name ?? item?.field_name ?? item?.key ?? '').trim();
    if (!key) return acc;
    let value = '';
    if (Array.isArray(item?.values) && item.values.length > 0) {
      value = String(item.values[0] ?? '').trim();
    } else if (item?.value !== undefined && item?.value !== null) {
      value = String(item.value).trim();
    }
    if (value) acc[key] = value;
    return acc;
  }, {});
}

function classifyMetaLeadTag(fields: Record<string, string>): string {
  const normalized = Object.values(fields).join(' ').toLowerCase();
  return normalized.includes('botox') ? 'neuromodulador/botox' : 'general';
}

/**
 * Classify a meta_leadgen lead into a CRM pipeline stage based on
 * keywords in form answers, notes, form_name and ad_name.
 *
 * Returns: { stage, treatmentName }
 *   stage ∈ 'lead' | 'appointment' | 'treatment' | 'closed'
 */
export async function processLeadData(adminClient: any, userId: string, leadData: any) {
  const { fields, rawFieldData } = parseMetaLeadFields(leadData.field_data ?? []);
  const leadDataFields = extractMetaLeadCustomerInfo(leadData.field_data ?? []);
  const tag = classifyMetaLeadTag(leadDataFields);

  const {
    leadgen_id,
    leadName,
    email,
    phone,
    dni,
    firstName,
    lastName,
    city,
    state,
    zipCode,
    gender,
    metaPlatform,
    metaAdId,
    isOrganic,
    metaAdName,
    metaFormId,
    assetUrl,
    hashedPhone,
    hashedEmail,
  } = await extractMetaLeadStandardFields(fields, leadData);

  const notes = buildMetaLeadNotes(fields, tag);
  const priority = buildMetaLeadPriority(fields, notes);

  // Upsert lead — idempotent via partial unique index (clinic_id, source, external_id)
  const createdAt = parseMetaLeadCreatedAt(leadData.created_time);
  const clinicIdForLead = await resolveClinicId(adminClient, userId);

  const { data: lead } = await adminClient.from('leads')
    .upsert({
      user_id:         userId,
      clinic_id:       clinicIdForLead,
      external_id:     leadgen_id,
      source:          'meta_leadgen',
      name:            leadName,
      email,
      phone,
      dni:             dni || null,
      first_name:      firstName,
      last_name:       lastName,
      city,
      state,
      zip_code:        zipCode,
      gender,
      notes:           notes || null,
      priority,
      stage:           'lead',
      appointment_date: null,
      treatment_name:  null,
      campaign_id:     leadData.campaign_id ?? null,
      campaign_name:   leadData.campaign_name ?? null,
      adset_id:        leadData.adset_id    ?? null,
      adset_name:      leadData.adset_name  ?? null,
      ad_id:           leadData.ad_id       ?? null,
      ad_name:         leadData.ad_name     ?? null,
      form_id:           leadData.form_id     ?? null,
      form_name:         leadData.form_name   ?? null,
      meta_ad_id:        metaAdId,
      meta_ad_name:      metaAdName,
      meta_form_id:      metaFormId,
      meta_platform:     metaPlatform,
      is_organic:        isOrganic,
      created_at_meta:   createdAt,
      asset_url:         assetUrl,
      telefono_hash:     hashedPhone,
      email_hash:        hashedEmail,
      raw_field_data:    Object.keys(rawFieldData).length ? rawFieldData : null,
      lead_quality_score: null,
      created_at:        createdAt,
    }, { onConflict: 'clinic_id,source,external_id', ignoreDuplicates: true })
    .select('id')
    .maybeSingle();

  // Record attribution details
  if (lead?.id) {
    await adminClient.from('meta_attribution')
      .upsert({
        lead_id:       lead.id,
        leadgen_id,
        page_id:       leadData.page_id     ?? null,
        form_id:       leadData.form_id     ?? null,
        campaign_id:   leadData.campaign_id ?? null,
        campaign_name: leadData.campaign_name ?? null,
        adset_id:      leadData.adset_id    ?? null,
        adset_name:    leadData.adset_name  ?? null,
        ad_id:         leadData.ad_id       ?? null,
        ad_name:       leadData.ad_name     ?? null,
        form_name:     leadData.form_name   ?? null,
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
  const { data: credRow } = await adminClient.from('credentials').select('encrypted_key').eq('user_id', userId).eq('service', 'meta').single();
  if (!credRow) return { notConnected: true, accessToken: '', adAccountIds: [] as string[], adAccountId: '', decryptionError: '' };

  let accessToken = '';
  let decryptionError = '';
  try {
    accessToken = await decryptCred(credRow.encrypted_key);
  } catch (err: any) {
    decryptionError = err?.message ?? 'Failed to decrypt Meta credential';
  }

  const { data: intg } = await adminClient.from('integrations').select('metadata').eq('user_id', userId).eq('service', 'meta').maybeSingle();

  const metadata = intg?.metadata ?? {};
  const metadataRawAccountIds = metadata.adAccountIds ?? metadata.ad_account_ids ?? metadata.adAccountId ?? metadata.ad_account_id ?? '';
  const metadataAccountIds = normalizeMetaAccountIds(metadataRawAccountIds);
  const qAccountIds = normalizeMetaAccountIds(qAccountId);

  const adAccountIds = qAccountIds.length > 0
    ? Array.from(new Set([...metadataAccountIds, ...qAccountIds]))
    : metadataAccountIds;
  return {
    notConnected: false,
    accessToken,
    adAccountIds,
    adAccountId: adAccountIds[0] ?? '',
    pageId: metadata.pageId ?? metadata.page_id ?? '',
    igId: metadata.igBusinessAccountId ?? metadata.ig_business_account_id ?? '',
    decryptionError,
  } as const;
}

function validateMetaCredentialResult(creds: any) {
  if (creds.notConnected) {
    return { ok: false, message: 'Meta Ads not connected', statusCode: 400 };
  }
  if (creds.decryptionError) {
    return { ok: false, message: creds.decryptionError, statusCode: 502 };
  }
  if (!Array.isArray(creds.adAccountIds) || creds.adAccountIds.length === 0) {
    return { ok: false, message: 'Meta Ad Account ID not configured', statusCode: 400 };
  }
  return { ok: true, message: '' };
}

export function extractMetaAccountRawValue(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw === 'object' && raw !== null) {
    const rawObj = raw as Record<string, unknown>;
    return extractMetaAccountRawValue(rawObj.adAccountId ?? rawObj.ad_account_id ?? rawObj.accountId ?? rawObj.account_id ?? '');
  }
  if (typeof raw === 'string' || typeof raw === 'number') {
    return String(raw).trim();
  }
  return '';
}

function normalizeMetaAccountIdValue(raw: string): string {
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

function normalizeMetaAccountId(raw: unknown): string {
  if (typeof raw !== 'string' && typeof raw !== 'number') return '';
  return normalizeMetaAccountIdValue(String(raw));
}

function normalizeMetaAccountIds(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) {
    return raw.flatMap((item) => normalizeMetaAccountIds(item));
  }
  if (typeof raw === 'object') {
    const rawObj = raw as Record<string, unknown>;
    return normalizeMetaAccountIds(rawObj.adAccountIds ?? rawObj.ad_account_ids ?? rawObj.adAccountId ?? rawObj.ad_account_id ?? rawObj.accountId ?? rawObj.account_id ?? '');
  }
  if (typeof raw === 'string' || typeof raw === 'number') {
    return String(raw)
      .split(/[\s,;]+/)
      .map((segment) => normalizeMetaAccountIdValue(segment))
      .filter(Boolean);
  }
  return [];
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
  const { data } = await adminClient.from('meta_cache')
    .select('data, updated_at')
    .eq('user_id', userId)
    .eq('id', cacheId)
    .maybeSingle();
  return data;
}

async function setMetaCache(adminClient: any, userId: string, cacheId: string, data: any) {
  await adminClient.from('meta_cache')
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
  await adminClient.from('integrations')
    .update({ status, last_error: message, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('service', service);
}

async function ensurePublicUserRow(adminClient: any, user: any) {
  if (!user?.id) return;

  const { data: existingUser, error: existingError } = await adminClient.from('users')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existingUser) return;

  const userName = user.user_metadata?.name ?? user.raw_user_meta_data?.name ?? user.email ?? '';
  const { error: insertError } = await adminClient.from('users')
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

function validateSupabaseRuntimeConfig() {
  requireRuntimeSecret('SUPABASE_URL');
  requireRuntimeSecret('SUPABASE_SERVICE_ROLE_KEY');
  requireRuntimeSecret('SUPABASE_ANON_KEY');

  if (!isValidEncryptionKey(ENCRYPTION_KEY)) {
    throw new Error('ENCRYPTION_KEY is required and must be at least 32 characters.');
  }

  if (!IS_DEVELOPMENT && !NORMALIZED_FRONTEND_URL) {
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
  const tokenData = await tokenRes.json() as Record<string, any>;
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
  const d = await r.json() as Record<string, any>;
  if (!r.ok) {
    throw new Error(getGoogleAdsErrorMessage(d, r.status));
  }
  const { results } = d;
  return Array.isArray(results) ? results : [];
}

function getGoogleAdsErrorMessage(d: any, status: number): string {
  const firstError = d?.error?.details?.[0]?.errors?.[0];
  return firstError?.message ?? d?.error?.message ?? `Google Ads ${status}`;
}

type GoogleAdsCreds =
  | { notConnected: false; noServiceAccount: true; devToken?: never; customerId?: never; serviceAccount?: never }
  | { notConnected: true; noServiceAccount: false; devToken?: never; customerId?: never; serviceAccount?: never }
  | { notConnected: false; noServiceAccount: false; devToken: string; customerId: string; serviceAccount: any };

async function resolveGoogleAdsCreds(adminClient: any, userId: string, qCustomerId: string): Promise<GoogleAdsCreds> {
  const saRaw = Deno.env.get('GOOGLE_ADS_SERVICE_ACCOUNT');
  if (!saRaw) return { notConnected: false, noServiceAccount: true } as const;
  let serviceAccount: any;
  try { serviceAccount = JSON.parse(saRaw); } catch { return { notConnected: false, noServiceAccount: true } as const; }

  const { data: credRow } = await adminClient.from('credentials').select('encrypted_key').eq('user_id', userId).eq('service', 'google_ads').single();
  if (!credRow) return { notConnected: true, noServiceAccount: false } as const;
  const devToken = await decryptCred(credRow.encrypted_key);

  let customerId = qCustomerId;
  if (!customerId) {
    const { data: intg } = await adminClient.from('integrations').select('metadata').eq('user_id', userId).eq('service', 'google_ads').single();
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
  const url = new URL(req.url);
  const rawParts = url.pathname.split('/').filter(Boolean);
  const parts = [...rawParts];
  if (parts[0] === 'functions' && parts[1] === 'v1') parts.splice(0, 2);
  if (parts[0] === 'api') parts.splice(0, 1);
  
  const resource = parts[0] ?? '';
  const sub = parts[1] ?? '';
  const sub2 = parts[2] ?? '';

  const requestOrigin = req.headers.get('Origin');
  const corsHeaders = buildCorsHeaders(requestOrigin);
  
  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const sendJson = (data: unknown, status = 200, extraHeaders: Record<string, string> = {}) => {
    return new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, ...extraHeaders, 'Content-Type': 'application/json' },
    });
  };

  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const userIdHeader = req.headers.get('x-user-id') || '';
  const adminClient = createAdminClient();

  // 1. Rutas públicas (webhooks + health)
  const publicResponse = await handlePublicRoutes({ req, url, resource, sub, sendJson });
  if (publicResponse) return publicResponse;

  // 2. Auth Verification
  const anonKey = requireSupabaseEnv(SUPABASE_ANON_KEY, 'SUPABASE_ANON_KEY');
  const authUser = await verifySupabaseUser(adminClient, token, anonKey);
  const isServiceRole = isDedicatedServiceRoleBypass(token, NUVANX_SUPABASE_SERVICE_ROLE_KEY);
  const isApiKeyValid = MCP_API_KEY && req.headers.get('x-api-key') === MCP_API_KEY;

  if (!authUser && !isServiceRole && !isApiKeyValid) {
    return sendJson({ success: false, message: 'Unauthorized' }, 401);
  }

  let userId = authUser ? authUser.id : userIdHeader;
  if (!userId && isApiKeyValid) {
    const { data: demoUser } = await adminClient.from('users').select('id').eq('email', 'demo@nuvanx.com').maybeSingle();
    if (demoUser) userId = demoUser.id;
  }

  if ((isServiceRole || isApiKeyValid) && !userId && resource !== 'health') {
    return sendJson({ success: false, message: 'Missing user context' }, 400);
  }

  const ctx: AuthenticatedRouteContext = {
    adminClient, userId, authUser, resource, sub, sub2, req, url, sendJson, token
  };

  // 3. Rutas Críticas (Llamadas directas para robustez)
  if (resource === 'kpis') {
    const res = await handleKpisGet(ctx);
    if (res) return res;
  }
  if (resource === 'dashboard' && sub === 'metrics') {
    const res = await handleDashboardMetrics(ctx);
    if (res) return res;
  }
  if (resource === 'dashboard' && sub === 'campaigns-filter') {
    const res = await handleCampaignsFilter(ctx);
    if (res) return res;
  }
  if (resource === 'traceability' && sub === 'funnel') {
    const res = await handleTrazabilidadFunnel(ctx);
    if (res) return res;
  }

  // 4. Enrutamiento General (Fallback al Mapa de Handlers)
  return await handleAuthenticatedRoutes(ctx);
}

type RouteHandler = (ctx: AuthenticatedRouteContext) => Promise<Response | null>;

export const AUTHENTICATED_ROUTE_HANDLERS = new Map<string, RouteHandler>([
  ['health|*|*', handleHealth],
  ['auth|me|GET', handleAuthMeGet],
  ['production|audit|GET', handleProductionAuditGet],
  ['leads||GET', handleLeadsGet],
  ['leads||POST', handleLeadsPost],
  ['leads||PATCH', handleLeadsPatch],
  ['leads||DELETE', handleLeadsDelete],
  ['dashboard|metrics|*', handleDashboardMetrics],
  ['dashboard|campaigns-filter|*', handleCampaignsFilter],
  ['dashboard|lead-flow|*', handleDashboardLeadFlow],
  ['dashboard|meta-trends|*', handleDashboardMetaTrends],
  ['meta|insights|GET', handleMetaInsightsGet],
  ['meta|backfill|POST', handleMetaBackfillPost],
  ['meta|organic|GET', handleMetaOrganicGet],
  ['meta|ig|GET', handleMetaIgGet],
  ['health|meta|*', handleHealthMeta],
  ['meta|campaigns|GET', handleMetaCampaignsGet],
  ['meta|ads|GET', handleMetaAdsGet],
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
  ['traceability|funnel|*', handleTrazabilidadFunnel],
  ['traceability|campaigns|*', handleTraceabilityCampaigns],
  ['conversations||*', handleConversations],
  ['figma-events||*', handleFigmaEvents],
  ['whatsapp|send|POST', handleWhatsappSend],
  ['whatsapp|conversion|POST', handleWhatsappConversionPost],
  ['kpis||GET', handleKpisGet],
  ['reports|doctoralia-financials|GET', handleReportsDoctoraliaFinancialsGet],
  ['reports|campaign-performance|GET', handleReportsCampaignPerformanceGet],
  ['reports|source-comparison|GET', handleReportsSourceComparisonGet],
  ['reports|whatsapp-conversion|GET', handleReportsWhatsappConversionGet],
  ['reports|lead-audit|GET', handleReportsLeadAuditGet],
  ['reports|phone-coverage|GET', handleReportsPhoneCoverageGet],
  ['reports|doctor-performance|GET', handleReportsDoctorPerformanceGet],
  ['reports|campaign-roi|GET', handleReportsCampaignRoiGet],
  ['leads|reconcile|POST', handleLeadsReconcilePost],
  ['agenda|doctoralia|GET', handleAgendaDoctoraliaGet],
]);


interface PublicRouteContext {
  req: Request;
  url: URL;
  resource: string;
  sub: string;
  sendJson: (data: unknown, status?: number, extraHeaders?: Record<string, string>) => Response;
}

async function handleMetaWebhook(ctx: PublicRouteContext): Promise<Response | null> {
  const { req } = ctx;
  if (req.method === 'GET') return handleMetaWebhookGet(ctx);
  if (req.method === 'POST') return handleMetaWebhookPost(ctx);
  return null;
}

function handleMetaWebhookGet(ctx: PublicRouteContext): Response | null {
  const { url } = ctx;
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

async function processMetaLeadChange(adminClient: any, change: any): Promise<void> {
  if (change.field !== 'leadgen') return;
  const val = change.value ?? {};
  const { leadgen_id, page_id } = val;
  if (!leadgen_id) return;

  const { data: intgs } = await adminClient.from('integrations')
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

  if (matchingIntg == null) return;

  const webhookUserId = matchingIntg.user_id;
  const { data: credRow } = await adminClient.from('credentials')
    .select('encrypted_key')
    .eq('user_id', webhookUserId)
    .eq('service', 'meta')
    .single();
  if (!credRow) return;

  let accessToken: string;
  try {
    accessToken = await publicRouteHelpers.decryptCred(credRow.encrypted_key);
  } catch {
    return;
  }

  let leadData: any;
  try {
    leadData = await publicRouteHelpers.metaFetch(`/${leadgen_id}`, {
      fields: 'field_data,created_time,ad_id,ad_name,form_id,form_name,campaign_id,campaign_name,adset_id,adset_name,page_id,is_organic,platform',
    }, accessToken);
  } catch {
    return;
  }

  await publicRouteHelpers.processLeadData(adminClient, webhookUserId, leadData);
  await fireMetaLeadCapi(accessToken, leadgen_id, leadData);
}

/**
 * Fire CAPI Lead with the Meta leadgen_id as event_id (dedupes against any
 * client-side `Lead` pixel emission). Errors are logged and swallowed so they
 * don't cause Meta to retry the webhook.
 */
async function fireMetaLeadCapi(accessToken: string, leadgenId: string, leadData: any): Promise<void> {
  try {
    const fields: Record<string, string> = {};
    for (const fd of leadData?.field_data ?? []) {
      const name = String(fd?.name ?? '').toLowerCase();
      const value = Array.isArray(fd?.values) ? String(fd.values[0] ?? '') : '';
      if (name && value) fields[name] = value;
    }
    const phone = fields['phone_number'] ?? fields['telefono'] ?? fields['phone'] ?? null;
    const email = fields['email'] ?? null;
    if (!phone && !email) return;

    const eventTime = leadData?.created_time
      ? Math.floor(new Date(leadData.created_time).getTime() / 1000)
      : undefined;
    await trackMetaLeadConversion(accessToken, {
      eventId: String(leadgenId),
      phone,
      email,
      firstName: fields['first_name'] ?? fields['nombre'] ?? null,
      lastName: fields['last_name'] ?? fields['apellidos'] ?? null,
      city: fields['city'] ?? fields['ciudad'] ?? null,
      state: fields['state'] ?? fields['provincia'] ?? null,
      zipCode: fields['zip_code'] ?? fields['postal_code'] ?? fields['cp'] ?? null,
      eventTime,
      customData: {
        source: 'meta_leadgen_webhook',
        form_id: leadData?.form_id ?? null,
        campaign_id: leadData?.campaign_id ?? null,
        ad_id: leadData?.ad_id ?? null,
      },
    });
  } catch (capiErr) {
    console.error('[meta-capi] Lead event failed', capiErr);
  }
}

async function handleMetaWebhookPost(ctx: PublicRouteContext): Promise<Response | null> {
  const { req } = ctx;
  const appSecret = META_APP_SECRET;
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

  const adminClient = supabaseClientFactory.create(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const tasks: Promise<void>[] = [];
  for (const entry of (payload.entry ?? [])) {
    for (const change of (entry.changes ?? [])) {
      tasks.push(processMetaLeadChange(adminClient, change));
    }
  }
  await Promise.allSettled(tasks);

  return new Response('ok', { status: 200 });
}

async function handleWhatsappWebhook(ctx: PublicRouteContext): Promise<Response | null> {
  const { req } = ctx;
  if (req.method === 'GET') return handleWhatsappWebhookGet(ctx);
  if (req.method === 'POST') return await handleWhatsappWebhookPost(ctx);
  return null;
}

function handleWhatsappWebhookGet(ctx: PublicRouteContext): Response | null {
  const { url } = ctx;
  const mode = url.searchParams.get('hub.mode');
  const challenge = url.searchParams.get('hub.challenge');
  const verifyToken = url.searchParams.get('hub.verify_token');
  const expected = String(Deno.env.get('WHATSAPP_WEBHOOK_VERIFY_TOKEN') ?? '').trim();
  if (!expected) return new Response('WhatsApp verify token not configured', { status: 503 });
  if (mode === 'subscribe' && verifyToken === expected) {
    return new Response(challenge ?? '', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  return new Response('Forbidden', { status: 403 });
}

async function handleWhatsappWebhookPost(ctx: PublicRouteContext): Promise<Response | null> {
  const { req } = ctx;
  const appSecret = META_APP_SECRET;
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

  const adminClient = supabaseClientFactory.create(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const waTasks: Promise<void>[] = [];
  for (const entry of (payload.entry ?? [])) {
    for (const change of (entry.changes ?? [])) {
      waTasks.push(processWhatsappWebhookChange(adminClient, change));
    }
  }
  await Promise.allSettled(waTasks);

  return new Response('ok', { status: 200 });
}

async function processWhatsappWebhookChange(adminClient: any, change: any): Promise<void> {
  const value = change?.value ?? {};
  if (String(value?.messaging_product ?? '').toLowerCase() !== 'whatsapp') return;
  if (!Array.isArray(value?.messages)) return;

  const { data: integrations } = await adminClient.from('integrations')
    .select('user_id, metadata')
    .eq('service', 'whatsapp')
    .eq('status', 'connected');

  const connected = integrations ?? [];
  if (!connected.length) return;

  const payloadNumberId = normalizePhoneNumberId(value.metadata?.phone_number_id ?? value.metadata?.phoneNumberId ?? '');
  let matchingIntegration = connected.find((integration: any) => {
    const metadata = integration.metadata ?? {};
    return normalizePhoneNumberId(metadata?.phoneNumberId ?? metadata?.phone_number_id ?? '') === payloadNumberId;
  });

  if (!matchingIntegration) {
    const noMetadataPhoneNumbers = connected.every((integration: any) => {
      const metadata = integration.metadata ?? {};
      return !normalizePhoneNumberId(metadata?.phoneNumberId ?? metadata?.phone_number_id ?? '');
    });
    if (noMetadataPhoneNumbers && connected.length === 1) {
      matchingIntegration = connected[0];
    }
  }

  if (!matchingIntegration) return;
  await processWhatsappWebhookMessage(adminClient, matchingIntegration.user_id, value);
}

interface WhatsappLeadParams {
  phone: string;
  normalizedPhone: string;
  hashedPhone: string;
  name: string;
  safeSnippet: string;
  createdAtMeta: string;
  value: any;
}

async function ensureWhatsappLead(
  adminClient: any,
  userId: string,
  params: WhatsappLeadParams,
): Promise<string | null> {
  const {
    phone,
    normalizedPhone,
    hashedPhone,
    name,
    safeSnippet,
    createdAtMeta,
    value,
  } = params;
  const clinicIdForLead = await resolveClinicId(adminClient, userId);

  let existingLeadQuery = adminClient.from('leads')
    .select('id, stage')
    .or(`telefono_hash.eq.${hashedPhone},phone_normalized.eq.${normalizedPhone}`)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1);
  existingLeadQuery = clinicIdForLead
    ? existingLeadQuery.eq('clinic_id', clinicIdForLead)
    : existingLeadQuery.eq('user_id', userId);
  const { data: existingLead } = await existingLeadQuery.maybeSingle();

  if (existingLead?.id) {
    if (String(existingLead.stage ?? 'lead').toLowerCase() === 'lead') {
      await adminClient.from('leads')
        .update({ stage: 'whatsapp', first_inbound_at: createdAtMeta })
        .eq('id', existingLead.id);
    } else {
      await adminClient.from('leads')
        .update({ first_inbound_at: createdAtMeta })
        .eq('id', existingLead.id)
        .is('first_inbound_at', null);
    }
    return existingLead.id;
  }

  const { data: lead } = await adminClient.from('leads')
    .upsert({
      user_id:         userId,
      clinic_id:       clinicIdForLead,
      external_id:     `whatsapp:${phone}`,
      source:          'whatsapp',
      stage:           'whatsapp',
      name:            name || null,
      phone,
      notes:           safeSnippet ? `WhatsApp inbound: ${safeSnippet}` : 'WhatsApp inbound message received',
      telefono_hash:   hashedPhone,
      email_hash:      null,
      raw_field_data:  {
        metadata: value.metadata ?? null,
        contacts: value.contacts ?? null,
        messages: value.messages ?? null,
      },
      created_at_meta: createdAtMeta,
      first_inbound_at: createdAtMeta,
      created_at:      createdAtMeta,
    }, { onConflict: 'clinic_id,source,external_id', ignoreDuplicates: true })
    .select('id')
    .maybeSingle();

  if (lead?.id) return lead.id;

  let fallbackQuery = adminClient.from('leads')
    .select('id')
    .eq('external_id', `whatsapp:${phone}`)
    .is('deleted_at', null);
  fallbackQuery = clinicIdForLead
    ? fallbackQuery.eq('clinic_id', clinicIdForLead)
    : fallbackQuery.eq('user_id', userId);
  const { data: fallbackLead } = await fallbackQuery.maybeSingle();

  return fallbackLead?.id ?? null;
}

async function processWhatsappWebhookMessage(adminClient: any, userId: string, value: any): Promise<boolean> {
  const messages = Array.isArray(value.messages) ? value.messages : [];
  if (!messages.length) return false;

  const message = messages[0];
  const contact = Array.isArray(value.contacts) ? value.contacts[0] : null;
  const phone = String(contact?.wa_id ?? message?.from ?? '').trim();
  if (!phone) return false;

  const normalizedPhone = normalizePhoneForMeta(phone);
  if (!normalizedPhone) return false;

  const name = String(contact?.profile?.name ?? contact?.name ?? '').trim() || phone;
  const text = String(message?.text?.body ?? message?.body ?? '').trim();
  const snippet = text || `${String(message?.type ?? 'whatsapp')} message`;
  const safeSnippet = snippet.length > 250 ? `${snippet.slice(0, 247)}...` : snippet;
  const createdAtMeta = message?.timestamp ? new Date(Number(message.timestamp) * 1000).toISOString() : new Date().toISOString();
  const hashedPhone = await sha256Hex(phone);

  const leadId = await ensureWhatsappLead(
    adminClient,
    userId,
    {
      phone,
      normalizedPhone,
      hashedPhone,
      name,
      safeSnippet,
      createdAtMeta,
      value,
    },
  );

  const { data: usrRow } = await adminClient.from('users').select('clinic_id').eq('id', userId).single();
  const clinicId = usrRow?.clinic_id ?? null;
  if (clinicId) {
    await adminClient.from('whatsapp_conversations')
      .insert({
        clinic_id:        clinicId,
        lead_id:          leadId,
        phone,
        direction:        'inbound',
        message_type:     String(message?.type ?? 'text'),
        message_preview:  safeSnippet || null,
        sent_at:          createdAtMeta,
        wa_message_id:    String(message?.id ?? '') || null,
        conversation_status: 'received',
      });
  }

  return Boolean(leadId);
}

function throwIfError(result: { error?: any } | null | undefined): void {
  if (result?.error) throw result.error;
}

function pushWarning(condition: boolean, message: string, warnings: string[]): void {
  if (condition) warnings.push(message);
}

function handleHealthRoutes(ctx: any): Response | null {
  const { resource, sub, sendJson } = ctx;

  if (resource === 'health' && sub === 'secrets') {
    const hasEncryptionKey = Boolean(ENCRYPTION_KEY?.trim());
    const hasServiceKey = Boolean(SUPABASE_SERVICE_ROLE_KEY);
    const hasDedicatedBypassKey = Boolean(NUVANX_SUPABASE_SERVICE_ROLE_KEY);
    const hasWhatsappVerifyToken = Boolean(Deno.env.get('WHATSAPP_WEBHOOK_VERIFY_TOKEN')?.trim());

    const ok = hasEncryptionKey && hasServiceKey && hasDedicatedBypassKey;

    return sendJson({
      success: ok,
      status: ok ? 'ok' : 'missing',
      required: { ENCRYPTION_KEY: hasEncryptionKey, SUPABASE_SERVICE_ROLE_KEY: hasServiceKey, NUVANX_SUPABASE_SERVICE_ROLE_KEY: hasDedicatedBypassKey },
      recommended: { WHATSAPP_WEBHOOK_VERIFY_TOKEN: hasWhatsappVerifyToken },
    });
  }

  if (resource === 'health') {
    return sendJson({ success: true, status: 'ok', timestamp: new Date().toISOString() });
  }

  return null;
}

async function handlePublicRoutes(ctx: any): Promise<Response | null> {
  const { resource, sub } = ctx;

  if (resource === 'webhooks' && sub === 'meta') return await handleMetaWebhook(ctx);
  if (resource === 'webhooks' && sub === 'whatsapp') return await handleWhatsappWebhook(ctx);
  if (resource === 'health') return handleHealthRoutes(ctx);

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

export async function handleAuthenticatedRoutes(ctx: AuthenticatedRouteContext): Promise<Response> {
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
    return ctx.sendJson({ success: false, code: 'INTERNAL_ERROR', message: 'An unexpected error occurred. Please try again.' }, 500);
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
    const [
      agentOutputs,
      metaCacheCount,
      leadsCount,
      publicUsers,
      authUsers,
      doctoraliaPatients,
      doctorsCount,
      treatmentTypesCount,
      activeMetaIntegration,
      latestMetaCache,
    ] = await Promise.all([
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

    [
      agentOutputs,
      metaCacheCount,
      leadsCount,
      publicUsers,
      authUsers,
      doctoraliaPatients,
      doctorsCount,
      treatmentTypesCount,
      activeMetaIntegration,
      latestMetaCache,
    ].forEach(throwIfError);

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
    const settlementWarnings: string[] = [];
    if (futureSettlementCount > 0) {
      settlementWarnings.push(`Detected ${futureSettlementCount} settlement rows with future dates. Verify whether these are pre-paid scheduled appointments or test data.`);
    }
  
    const doctoraliaWarnings: string[] = [];
      pushWarning(Number(doctoraliaPatients.count ?? 0) === 0,
        'Detected 0 doctoralia_patients rows. Doctoralia patient normalization has not run or ingestion is missing.',
        doctoraliaWarnings);
      pushWarning(Number(doctorsCount.count ?? 0) === 0,
        'Detected 0 doctors rows. Reference doctor catalog ingestion is empty and may block performance analysis.',
        doctoraliaWarnings);
      pushWarning(Number(treatmentTypesCount.count ?? 0) === 0,
        'Detected 0 treatment_types rows. Reference treatment catalog ingestion is empty and may block performance analysis.',
        doctoraliaWarnings);
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
          ...(publicUserDelta === 0 ? [] : [
            publicUserDelta > 0
              ? `Detected ${publicUserDelta} public.users row(s) without matching auth.users. This can cause incorrect clinic_id resolution or empty results for affected users.`
              : `Detected ${Math.abs(publicUserDelta)} auth.users row(s) without matching public.users. This may indicate incomplete user cleanup.`
          ]),
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

/**
 * Runs lead pipeline reconciliation RPCs.
 *
 * These calls can touch leads-related tables and should stay out of normal hot
 * read paths. GET /leads and GET /reports/lead-audit only run this when the
 * caller explicitly requests `?reconcile=true`; scheduled/background jobs should
 * remain the default way to keep reconciliation state fresh.
 */
async function runLeadPipelineReconciliation(adminClient: any, userId: string) {
  console.log(`[Reconciliation] Iniciando para user ${userId}`);

  const { data: clinic } = await adminClient
    .from('users').select('clinic_id').eq('id', userId).single();

  if (!clinic?.clinic_id) return;

  let updated = 0;

  // 1. Matching por teléfono (CORREGIDO)
  const { data: leads } = await adminClient
    .from('leads')
    .select('id, phone_normalized')
    .eq('clinic_id', clinic.clinic_id)
    .is('deleted_at', null)
    .neq('source', 'doctoralia')
    .is('converted_patient_id', null);

  for (const lead of (leads || [])) {
    if (!lead.phone_normalized) continue;

    const { data: match } = await adminClient
      .from('financial_settlements')
      .select('patient_id')
      .eq('clinic_id', clinic.clinic_id)
      .eq('patient_phone', lead.phone_normalized)   // ← Columna correcta
      .limit(1)
      .single();

    if (match?.patient_id) {
      await adminClient
        .from('leads')
        .update({ converted_patient_id: match.patient_id })
        .eq('id', lead.id);
      updated++;
    }
  }

  // 2. Reconciliación por asuntos Doctoralia
  try {
    const { data: subjectUpdated } = await adminClient.rpc('reconcile_doctoralia_subjects_to_leads', { p_user_id: userId });
    if (subjectUpdated > 0) console.log(`[Reconciliation] Doctoralia subjects: ${subjectUpdated} leads avanzados`);
  } catch (e) { console.warn('[Reconciliation] Doctoralia subjects RPC failed', e); }

  // 3. Reconciliación WhatsApp
  try {
    const { data: waUpdated } = await adminClient.rpc('reconcile_whatsapp_interactions_to_leads', { p_user_id: userId });
    if (waUpdated > 0) console.log(`[Reconciliation] WhatsApp: ${waUpdated} leads avanzados`);
  } catch (e) { console.warn('[Reconciliation] WhatsApp RPC failed', e); }

  console.log(`[Reconciliation] Finalizado: ${updated} matches por teléfono`);
}

async function handleLeadsGet(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, url, sendJson } = ctx;
  if (resource === 'leads' && req.method === 'GET' && sub === '') {
    const source = url.searchParams.get('source');
    const stage = url.searchParams.get('stage');
    const reconcile = url.searchParams.get('reconcile') === 'true';

    if (reconcile) await runLeadPipelineReconciliation(adminClient, userId);

    const clinicId = await resolveClinicId(adminClient, userId);
    let query = adminClient
      .from('leads')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    query = clinicId ? query.eq('clinic_id', clinicId) : query.eq('user_id', userId);

    if (source) query = query.eq('source', source);
    if (stage) query = query.eq('stage', stage);

    const { data, error } = await query;
    if (error) throw error;
    return sendJson({ success: true, leads: data, total: data.length, reconciled: reconcile });
  }
  return null;
}

async function handleLeadsDelete(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, sendJson } = ctx;
  if (resource === 'leads' && req.method === 'DELETE' && sub !== '') {
    const leadId = sub;
    const clinicId = await resolveClinicId(adminClient, userId);
    let deleteQuery = adminClient.from('leads').delete().eq('id', leadId);
    deleteQuery = clinicId ? deleteQuery.eq('clinic_id', clinicId) : deleteQuery.eq('user_id', userId);
    const { error } = await deleteQuery;

    if (error) throw error;
    return sendJson({ success: true, message: 'Lead deleted' });
  }
  return null;
}

async function upsertLeadIdempotent(adminClient: any, userId: string, payload: any, source: string, externalId: string): Promise<any> {
  const clinicId = payload?.clinic_id ?? await resolveClinicId(adminClient, userId);
  const enrichedPayload = { ...payload, clinic_id: clinicId };
  const { data, error } = await adminClient.from('leads')
    .upsert(enrichedPayload, { onConflict: 'clinic_id,source,external_id', ignoreDuplicates: true })
    .select()
    .maybeSingle();
  if (error) throw error;

  if (data) {
    return { data, deduplicated: false, status: 201 };
  }

  let existingQuery = adminClient.from('leads')
    .select('*')
    .eq('source', source)
    .eq('external_id', externalId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(1);
  existingQuery = clinicId
    ? existingQuery.eq('clinic_id', clinicId)
    : existingQuery.eq('user_id', userId);
  const { data: existing, error: existingErr } = await existingQuery.maybeSingle();
  if (existingErr) throw existingErr;

  return { data: existing, deduplicated: true, status: 200 };
}

async function handleLeadsPost(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, req, sendJson } = ctx;
  if (resource === 'leads' && req.method === 'POST') {
    const rawBody = await req.json();
    const body = (rawBody && typeof rawBody === 'object') ? rawBody : {};
    const clinicId = await resolveClinicId(adminClient, userId);
    const payload = { ...body, user_id: userId, clinic_id: (body as any)?.clinic_id ?? clinicId };
    const payloadObj = payload as Record<string, any>;
    const source = String(payloadObj?.source ?? '').trim();
    const externalId = String(payloadObj?.external_id ?? '').trim();

    if (source && externalId) {
      const { data, deduplicated, status } = await upsertLeadIdempotent(adminClient, userId, payload, source, externalId);
      return sendJson({ success: true, lead: data, deduplicated }, status);
    }

    const { data, error } = await adminClient.from('leads')
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
    const allowedFields = ['stage', 'name', 'phone', 'dni', 'notes', 'revenue', 'appointment_date', 'treatment_name'];
    const updateData: Record<string, any> = {};
    for (const field of allowedFields) {
      if (hasOwn(body, field)) {
        updateData[field] = body[field];
      }
    }

    if (Object.keys(updateData).length === 0) {
      return sendJson({ success: false, message: 'No valid fields provided for update' }, 400);
    }

    const { data, error } = await adminClient.from('leads')
      .update(updateData)
      .eq('id', leadId)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) return sendJson({ success: false, message: 'Lead not found' }, 404);

    return sendJson({ success: true, lead: data });
  }
  return null;
}

function getDashboardPeriods(url: URL) {
  const days = Number.parseInt(url.searchParams.get('days') ?? '0', 10) || 0;
  const fromParam = url.searchParams.get('from') ?? '';
  const toParam = url.searchParams.get('to') ?? '';

  let since: string | null = null;
  let until: string | null = null;
  let prevSince: string | null = null;
  let prevUntil: string | null = null;

  if (fromParam && toParam) {
    // Fechas personalizadas (el caso que fallaba)
    since = fromParam;
    until = toParam;

    const fromDate = new Date(fromParam);
    const toDate = new Date(toParam);
    const durationMs = toDate.getTime() - fromDate.getTime();

    prevSince = new Date(fromDate.getTime() - durationMs).toISOString().slice(0, 10);
    prevUntil = new Date(fromDate.getTime() - 1).toISOString().slice(0, 10);
  } else if (days > 0) {
    // Botones fijos (7d, 14d, 30d, 90d)
    const nowTs = Date.now();
    const currentSinceTs = nowTs - days * 86_400_000;
    since = new Date(currentSinceTs).toISOString().slice(0, 10);
    until = new Date(nowTs).toISOString().slice(0, 10);

    prevSince = new Date(currentSinceTs - days * 86_400_000).toISOString().slice(0, 10);
    prevUntil = new Date(currentSinceTs - 1).toISOString().slice(0, 10);
  } else {
    // Default: últimos 30 días
    const nowTs = Date.now();
    since = new Date(nowTs - 30 * 86_400_000).toISOString().slice(0, 10);
    until = new Date(nowTs).toISOString().slice(0, 10);
    prevSince = new Date(nowTs - 60 * 86_400_000).toISOString().slice(0, 10);
    prevUntil = new Date(nowTs - 30 * 86_400_000 - 1).toISOString().slice(0, 10);
  }

  return { since, until, prevSince, prevUntil, days };
}

function aggregateDashboardResults(leads: any[], prevLeads: any[], settlements: any[], prevSettlements: any[], integrations: any[], metaData: any[] = [], prevMetaData: any[] = []) {
  // === NUVANX GUARANTEE (08-05-2026) ===
  // Doctoralia = CRM/Pacientes → nunca cuenta como fuente de leads de adquisición
  const filteredLeads = leads.filter((l: any) =>
    !l.source || l.source.toLowerCase() !== 'doctoralia'
  );
  const filteredPrevLeads = prevLeads.filter((l: any) =>
    !l.source || l.source.toLowerCase() !== 'doctoralia'
  );

  const totalLeads = filteredLeads.length;
  const prevTotalLeads = filteredPrevLeads.length;
  const totalRevenue = filteredLeads.reduce((s: number, l: any) => s + Number(l.revenue || 0), 0);
  const verifiedRevenue = settlements.reduce((s: number, r: any) => s + Number(r.amount_net), 0);
  const prevVerifiedRevenue = prevSettlements.reduce((s: number, r: any) => s + Number(r.amount_net), 0);
  const settledCount = settlements.length;

  const totalSpend = metaData.reduce((s: number, r: any) => s + Number(r.spend || 0), 0);
  const prevTotalSpend = prevMetaData.reduce((s: number, r: any) => s + Number(r.spend || 0), 0);
  const totalMetaConversions = metaData.reduce((s: number, r: any) => s + Number(r.conversions || 0), 0);
  const totalMetaClicks = metaData.reduce((s: number, r: any) => s + Number(r.clicks || 0), 0);

  const conversions = filteredLeads.filter((l: any) => l.stage === 'treatment' || l.stage === 'closed').length;
  const prevConversions = filteredPrevLeads.filter((l: any) => l.stage === 'treatment' || l.stage === 'closed').length;
  const patientMatches = filteredLeads.filter((l: any) => l.converted_patient_id != null).length;
  const prevPatientMatches = filteredPrevLeads.filter((l: any) => l.converted_patient_id != null).length;

  const conversionRate = totalLeads > 0 ? Number.parseFloat(((conversions / totalLeads) * 100).toFixed(1)) : 0;
  const patientConversionRate = totalLeads > 0 ? Number.parseFloat(((patientMatches / totalLeads) * 100).toFixed(1)) : 0;

  const calculateDelta = (curr: number, prev: number) => {
    if (prev <= 0) return null;
    return Number.parseFloat((((curr - prev) / prev) * 100).toFixed(1));
  };

  const deltas = {
    leads: calculateDelta(totalLeads, prevTotalLeads),
    revenue: calculateDelta(verifiedRevenue, prevVerifiedRevenue),
    conversions: calculateDelta(conversions, prevConversions),
    patientMatches: calculateDelta(patientMatches, prevPatientMatches),
    spend: calculateDelta(totalSpend, prevTotalSpend),
  };

  const stages = ['lead', 'whatsapp', 'appointment', 'treatment', 'closed'];
  const byStage: Record<string, number> = {};
  for (const s of stages) byStage[s] = filteredLeads.filter((l: any) => l.stage === s).length;
  const bySource: Record<string, number> = {};
  for (const l of filteredLeads) {
    const sourceKey = String(l.source ?? 'unknown');
    bySource[sourceKey] = (bySource[sourceKey] || 0) + 1;
  }
  const connectedIntegrations = integrations.filter((i: any) => i.status === 'connected').length;

  return {
    totalLeads, totalRevenue: Number.parseFloat(totalRevenue.toFixed(2)),
    verifiedRevenue: Number.parseFloat(verifiedRevenue.toFixed(2)),
    settledCount,
    conversions, conversionRate,
    patientMatches, patientConversionRate,
    spend: Number.parseFloat(totalSpend.toFixed(2)),
    averageCpc: totalMetaClicks > 0 ? Number.parseFloat((totalSpend / totalMetaClicks).toFixed(2)) : 0,
    metaConversions: totalMetaConversions,
    byStage, bySource,
    connectedIntegrations, totalIntegrations: integrations.length,
    deltas,
  };
}

function buildDashboardLeadsQuery(adminClient: any, userId: string, clinicId: string | null, since: string | null, until: string | null, sourceFilter: string) {
  let q = adminClient.from('leads').select('stage, revenue, source, created_at, converted_patient_id').is('deleted_at', null).neq('source', 'doctoralia');
  if (clinicId) {
    q = q.eq('clinic_id', clinicId);
  } else {
    q = q.eq('user_id', userId);
  }
  if (since) q = q.gte('created_at', since);
  if (until) q = q.lte('created_at', until);
  if (sourceFilter) q = q.eq('source', sourceFilter);
  return q;
}

function buildDashboardSettlementsQuery(adminClient: any, clinicId: string | null, since: string | null, until: string | null) {
  let q = adminClient
    .from('financial_settlements')
    .select('amount_net, cancelled_at, settled_at, template_name, source_system')
    .eq('clinic_id', clinicId)
    .eq('source_system', 'doctoralia')
    .is('cancelled_at', null)
    .gt('amount_net', 0);
  if (since) q = q.gte('settled_at', since);
  if (until) q = q.lte('settled_at', until);
  return q;
}

async function handleDashboardMetrics(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, url, sendJson } = ctx;
  if (resource === 'dashboard' && sub === 'metrics') {
    const { since, until } = getKpiDateRange(url);

    const { data: usr } = await adminClient.from('users').select('clinic_id').eq('id', userId).single();
    const clinicId = usr?.clinic_id;
    if (!clinicId) return sendJson({ success: false, message: 'No clinic' }, 400);

    // Reconciliar leads antes de calcular métricas
    await runLeadPipelineReconciliation(adminClient, userId);

    const [leadsRes, metaRes, settlementsRes] = await Promise.all([
      adminClient.from('leads')
        .select('id, stage, created_at, source, converted_patient_id')
        .eq('clinic_id', clinicId)
        .is('deleted_at', null)
        .neq('source', 'doctoralia')
        .gte('created_at', since)
        .lte('created_at', until),

      adminClient.from('meta_daily_insights')
        .select('spend, impressions, clicks, date')
        .eq('clinic_id', clinicId)
        .gte('date', since)
        .lte('date', until),

      adminClient.from('financial_settlements')
        .select('amount_net, patient_id, settled_at')
        .eq('clinic_id', clinicId)
        .eq('source_system', 'doctoralia')
        .is('cancelled_at', null)
        .gt('amount_net', 0)
        .gte('settled_at', since)
        .lte('settled_at', until)
    ]);

    const leads = leadsRes.data ?? [];
    const metaInsights = metaRes.data ?? [];
    const settlements = settlementsRes.data ?? [];

    const totalLeads = leads.length;
    const metaLeads = leads.filter((l: any) => ['meta_leadgen', 'meta_lead_gen', 'facebook_leadgen'].includes(l.source || '')).length;
    const convertedLeads = leads.filter((l: any) => l.converted_patient_id != null).length;

    const totalSpend = metaInsights.reduce((sum: number, r: any) => sum + Number(r.spend ?? 0), 0);
    const verifiedRevenue = settlements.reduce((sum: number, r: any) => sum + Number(r.amount_net), 0);
    const uniquePatients = new Set(settlements.map((s: any) => s.patient_id).filter(Boolean)).size;

    return sendJson({
      success: true,
      date_range: { since, until },
      leads: {
        total: totalLeads,
        meta: metaLeads,
        converted: convertedLeads,
        conversion_rate: totalLeads > 0 ? Number(((convertedLeads / totalLeads) * 100).toFixed(2)) : 0
      },
      meta: {
        spend: Number(totalSpend.toFixed(2)),
        cpl: metaLeads > 0 ? Number((totalSpend / metaLeads).toFixed(2)) : 0
      },
      doctoralia: {
        verified_patients: uniquePatients,
        verified_revenue: Number(verifiedRevenue.toFixed(2)),
        cac: uniquePatients > 0 ? Number((totalSpend / uniquePatients).toFixed(2)) : 0
      },
      summary: {
        roi: verifiedRevenue > 0 && totalSpend > 0 
          ? Number(((verifiedRevenue - totalSpend) / totalSpend * 100).toFixed(2)) 
          : 0
      }
    });
  }
  return null;
}

async function handleCampaignsFilter(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, resource, sub, url, sendJson } = ctx;
  if (resource === 'dashboard' && sub === 'campaigns-filter') {
    const defaultToDate = new Date().toISOString().slice(0, 10);
    const defaultFromDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const fromDate = url.searchParams.get('from') || url.searchParams.get('since') || defaultFromDate;
    const toDate = url.searchParams.get('to') || url.searchParams.get('until') || defaultToDate;

    const { data } = await adminClient.rpc('get_campaigns_filter', {
      p_from_date: fromDate,
      p_to_date: toDate
    });

    return sendJson({
      success: true,
      campaigns: (data ?? []).map((c: any) => {
        const totalImporte = Number(c.total_importe ?? 0);
        const totalCitas = Number(c.total_citas ?? 0);

        return {
          campaign_id: c.campaign_id,
          campaign_name: c.campaign_id || 'Sin nombre',
          records: totalCitas,
          spend: Number(totalImporte.toFixed(2)),
          total_citas: totalCitas,
          total_importe: Number(totalImporte.toFixed(2))
        };
      })
    });
  }
  return null;
}

async function handleDashboardLeadFlow(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, sendJson } = ctx;
  if (resource === 'dashboard' && sub === 'lead-flow') {
    const clinicId = await resolveClinicId(adminClient, userId);
    let query = adminClient.from('leads').select('stage, created_at').is('deleted_at', null).neq('source', 'doctoralia');
    if (clinicId) {
      query = query.eq('clinic_id', clinicId);
    } else {
      query = query.eq('user_id', userId);
    }
    const { data: leads } = await query;
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

function getDashboardMetaTrendContext(url: URL, accountIds: readonly string[]) {
  const trendDays = Number.parseInt(url.searchParams.get('days') ?? '30', 10) || 30;
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');
  const campaignId = url.searchParams.get('campaign_id');
  const since = fromParam || new Date(Date.now() - trendDays * 86_400_000).toISOString().slice(0, 10);
  const until = toParam || new Date().toISOString().slice(0, 10);
  const cacheKey = buildMetaCacheKey('dashboard:meta-trends', accountIds, since, until, campaignId);

  return { since, until, campaignId, cacheKey };
}

async function handleDashboardMetaTrends(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, url, sendJson } = ctx;
  if (resource === 'dashboard' && sub === 'meta-trends') {
    const creds = await resolveMetaCreds(adminClient, userId, url.searchParams.get('adAccountId') ?? '');
    const validation = validateMetaCredentialResult(creds);
    if (!validation.ok) {
      return sendJson({ success: false, message: validation.message }, validation.statusCode);
    }
    const { since, until, campaignId, cacheKey } = getDashboardMetaTrendContext(url, creds.adAccountIds);

    try {
      const params = buildMetaInsightsParams(
        campaignId
          ? 'date_start,impressions,reach,clicks,spend,ctr,cpc,cpm,conversions,actions,cost_per_action_type,quality_ranking,engagement_rate_ranking,campaign_id'
          : 'date_start,impressions,reach,clicks,spend,ctr,cpc,cpm,conversions,actions,cost_per_action_type,quality_ranking,engagement_rate_ranking',
        since,
        until,
        campaignId,
      );

      const accountResults = await Promise.allSettled(creds.adAccountIds.map(async (accountId: string) => {
        const data = await metaFetchInsightsWithFallback(`/${accountId}/insights`, params, creds.accessToken, campaignId ?? undefined);
        return { accountId, data };
      }));

      const successfulAccounts: any[] = accountResults
        .filter(isFulfilled)
        .map((result) => result.value);
      const failedAccountIds = creds.adAccountIds.filter((_: string, idx: number) => accountResults[idx].status === 'rejected');
      let dbFallbackAccounts = 0;

      if (!campaignId && failedAccountIds.length > 0) {
        const fallbackRows = await fetchMetaDailyInsightRows(adminClient, userId, failedAccountIds, since, until);
        const rowsByAccount = groupRowsByAccount(fallbackRows);
        for (const accountId of failedAccountIds) {
          const rows = rowsByAccount[accountId] || [];
          if (rows.length === 0) continue;
          successfulAccounts.push({ accountId, data: { data: mapMetaDailyRowsToInsightsPayload(rows) } });
          dbFallbackAccounts += 1;
        }
      }

      if (successfulAccounts.length === 0) {
        throw (accountResults.find((result) => result.status === 'rejected') as PromiseRejectedResult)?.reason ?? new Error('Meta API error');
      }

      const trends: any[] = mergeMetaInsightsDailyByDate(successfulAccounts.flatMap((acct: any) => Array.isArray(acct.data?.data) ? acct.data.data : []));
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
  
      const result: any = {
        success: true,
        source: dbFallbackAccounts > 0 ? (dbFallbackAccounts === successfulAccounts.length ? 'db' : 'live+db') : 'live',
        cached: false,
        degraded: dbFallbackAccounts > 0,
        accountId: creds.adAccountId,
        accountIds: creds.adAccountIds,
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

      await setMetaCache(adminClient, userId, cacheKey, result);
      return sendJson(result);
    } catch (e: any) {
      const cached = await getMetaCache(adminClient, userId, cacheKey);
      if (cached) {
        return sendJson({
          ...cached.data,
          source: cached.data?.source || 'cache',
          cached: true,
          degraded: true,
          accountId: creds.adAccountId,
          accountIds: creds.adAccountIds,
          last_success: cached.updated_at,
          message: `Meta API error: ${e.message}. Showing cached data.`
        });
      }
      return sendJson({ success: false, message: e.message }, 502);
    }
  }
  return null;
}

function getMetaInsightsTimePeriods(url: URL) {
  const requestedDays = Number.parseInt(url.searchParams.get('days') ?? '30', 10) || 30;
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');

  const since = fromParam || new Date(Date.now() - requestedDays * 86_400_000).toISOString().slice(0, 10);
  const until = toParam || new Date().toISOString().slice(0, 10);
  const days = Math.max(1, Math.round((new Date(until).getTime() - new Date(since).getTime()) / 86_400_000) + 1);
  const prevSince = new Date(new Date(since).getTime() - days * 86_400_000).toISOString().slice(0, 10);
  return { since, until, days, prevSince };
}

function buildMetaInsightsParams(fields: string, since: string, until: string, campaignId: string | null) {
  const params: Record<string, string> = {
    fields,
    time_range: JSON.stringify({ since, until }),
    time_increment: '1',
    limit: '1000',
  };
  if (campaignId) {
    params.filtering = JSON.stringify([{ field: 'campaign_id', operator: 'EQUAL', value: campaignId }]);
  }
  return params;
}

function aggregateMetaInsightsSummary(daily: any[]) {
  const sumN = (arr: any[], k: string) => arr.reduce((s: number, d: any) => s + Number.parseFloat(d[k] || 0), 0);
  const messaging = daily.reduce((sum: number, day: any) => sum + actionValue(day.actions, isMessagingConversationAction), 0);
  const rawConversions = Math.round(sumN(daily, 'conversions'));
  
  return {
    impressions: Math.round(sumN(daily, 'impressions')),
    reach: Math.round(sumN(daily, 'reach')),
    clicks: Math.round(sumN(daily, 'clicks')),
    spend: Number.parseFloat(sumN(daily, 'spend').toFixed(2)),
    conversions: rawConversions || messaging,
    messagingConversationStarted: messaging,
  };
}

function mergeMetaInsightsDailyByDate(rows: any[]) {
  const grouped = new Map<string, any>();
  for (const row of rows) {
    const date = row?.date_start ?? row?.date;
    if (!date) continue;
    const existing = grouped.get(date) ?? {
      date_start: date,
      impressions: 0,
      reach: 0,
      clicks: 0,
      spend: 0,
      ctr: 0,
      cpc: 0,
      cpm: 0,
      conversions: 0,
      actions: [],
    };
    existing.impressions += Number(row.impressions || 0);
    existing.reach += Number(row.reach || 0);
    existing.clicks += Number(row.clicks || 0);
    existing.spend += Number(row.spend || 0);
    existing.conversions += Number(row.conversions || 0);
    existing.actions = existing.actions.concat(Array.isArray(row.actions) ? row.actions : []);
    grouped.set(date, existing);
  }
  const merged = Array.from(grouped.values()).map((row) => {
    const impressions = Number(row.impressions || 0);
    const clicks = Number(row.clicks || 0);
    const spend = Number(row.spend || 0);
    return {
      ...row,
      ctr: impressions > 0 ? Number.parseFloat(((clicks / impressions) * 100).toFixed(2)) : 0,
      cpc: clicks > 0 ? Number.parseFloat((spend / clicks).toFixed(2)) : 0,
      cpm: impressions > 0 ? Number.parseFloat((spend / impressions * 1000).toFixed(2)) : 0,
    };
  });
  return merged.sort((a, b) => String(a.date_start).localeCompare(String(b.date_start)));
}

function calculateMetaInsightsSummary(daily: any[]) {
  const curr = aggregateMetaInsightsSummary(daily);
  const ctr = curr.impressions > 0 ? Number.parseFloat(((curr.clicks / curr.impressions) * 100).toFixed(2)) : 0;
  const cpc = curr.clicks > 0 ? Number.parseFloat((curr.spend / curr.clicks).toFixed(2)) : 0;
  const cpm = curr.impressions > 0 ? Number.parseFloat((curr.spend / curr.impressions * 1000).toFixed(2)) : 0;
  const cpp = curr.conversions > 0 ? Number.parseFloat((curr.spend / curr.conversions).toFixed(2)) : 0;
  return { ...curr, ctr, cpc, cpm, cpp };
}

function buildMetaCacheKey(prefix: string, accountIds: readonly string[], since: string, until: string, campaignId?: string | null) {
  const accountsKey = [...new Set(accountIds)].sort().join(',') || 'none';
  return `${prefix}:${since}:${until}:${campaignId || 'all'}:${accountsKey}`;
}

async function fetchMetaDailyInsightRows(adminClient: any, userId: string, accountIds: readonly string[], since: string, until: string) {
  if (accountIds.length === 0) return [];
  const clinicId = await resolveClinicId(adminClient, userId);
  let query = adminClient.from('meta_daily_insights')
    .select('date,ad_account_id,impressions,reach,clicks,spend,ctr,cpc,cpm,conversions,messaging_conversations')
    .in('ad_account_id', accountIds)
    .gte('date', since)
    .lte('date', until)
    .order('date', { ascending: true });
  query = clinicId ? query.eq('clinic_id', clinicId) : query.eq('user_id', userId);

  const { data, error } = await query;
  if (error || !Array.isArray(data)) return [];
  return data;
}

function mapMetaDailyRowsToInsightsPayload(rows: any[]): any[] {
  return rows.map((row: any) => ({
    date_start: row.date,
    impressions: Number(row.impressions ?? 0),
    reach: Number(row.reach ?? 0),
    clicks: Number(row.clicks ?? 0),
    spend: Number(row.spend ?? 0),
    ctr: Number(row.ctr ?? 0),
    cpc: Number(row.cpc ?? 0),
    cpm: Number(row.cpm ?? 0),
    conversions: Number(row.conversions ?? 0),
    messaging_conversations: Number(row.messaging_conversations ?? 0),
    actions: [],
  }));
}

function groupRowsByAccount(rows: any[]): Record<string, any[]> {
  return rows.reduce((grouped: Record<string, any[]>, row: any) => {
    const accountId = row.ad_account_id;
    if (!accountId) return grouped;
    grouped[accountId] = grouped[accountId] || [];
    grouped[accountId].push(row);
    return grouped;
  }, {});
}

function buildMetaInsightsLiveResult(successfulAccounts: any[], creds: any, since: string, until: string, days: number) {
  const currency: string = successfulAccounts.find((acct: any) => acct.currency)?.currency ?? 'EUR';

  const daily = mergeMetaInsightsDailyByDate(successfulAccounts.flatMap((acct: any) => Array.isArray(acct.current?.data) ? acct.current.data : []));
  const prevData = successfulAccounts.flatMap((acct: any) => {
    const prevValue = acct.previous?.data;
    if (Array.isArray(prevValue)) return prevValue;
    return prevValue ? [prevValue] : [];
  });
  const prevD = calculateMetaInsightsPrev(prevData);
  const summary = calculateMetaInsightsSummary(daily);

  return {
    success: true,
    source: 'live',
    cached: false,
    accountId: creds.adAccountId,
    accountIds: creds.adAccountIds,
    currency,
    period: { since, until, days },
    summary,
    changes: {
      impressions: percentChange(summary.impressions, prevD.impressions),
      reach: percentChange(summary.reach, prevD.reach),
      clicks: percentChange(summary.clicks, prevD.clicks),
      spend: percentChange(summary.spend, prevD.spend),
      conversions: percentChange(summary.conversions, prevD.conversions),
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
}

function calculateMetaInsightsPrev(prevData: any[]) {
  const sumField = (key: string) => prevData.reduce((sum: number, row: any) => sum + parseMetaMetric(row[key]), 0);
  return {
    impressions: sumField('impressions'),
    reach: sumField('reach'),
    clicks: sumField('clicks'),
    spend: sumField('spend'),
    conversions: sumField('conversions'),
  };
}

async function fetchMetaInsightsFallbackFromDb(params: {
  adminClient: any;
  userId: string;
  creds: any;
  since: string;
  until: string;
  days: number;
  sendJson: any;
  e: Error;
}) {
  const { adminClient, userId, creds, since, until, days, sendJson, e } = params;
  const clinicId = await resolveClinicId(adminClient, userId);
  let dbQuery = adminClient.from('meta_daily_insights')
    .select('date,impressions,reach,clicks,spend,ctr,cpc,cpm,conversions,messaging_conversations')
    .in('ad_account_id', creds.adAccountIds)
    .gte('date', since)
    .lte('date', until)
    .order('date', { ascending: true });
  dbQuery = clinicId ? dbQuery.eq('clinic_id', clinicId) : dbQuery.eq('user_id', userId);
  const { data: dbRows, error: dbErr } = await dbQuery;

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
      accountIds: creds.adAccountIds,
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

async function handleMetaInsightsGet(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, url, sendJson } = ctx;
  if (resource === 'meta' && sub === 'insights' && req.method === 'GET') {
    return await processMetaInsightsGet(adminClient, userId, url, sendJson);
  }
  return null;
}

async function processMetaInsightsGet(adminClient: any, userId: string, url: URL, sendJson: any): Promise<Response> {
  const creds = await resolveMetaCreds(adminClient, userId, url.searchParams.get('adAccountId') ?? '');
  const validation = validateMetaCredentialResult(creds);
  if (!validation.ok) {
    const payload: any = { success: false, message: validation.message };
    if (validation.statusCode === 400) payload.notConnected = creds.notConnected || !creds.adAccountId;
    return sendJson(payload, validation.statusCode);
  }

  const { since, until, days, prevSince } = getMetaInsightsTimePeriods(url);
  const campaignId = url.searchParams.get('campaign_id');
  const fields = campaignId
    ? 'date_start,impressions,reach,clicks,spend,ctr,cpc,cpm,frequency,conversions,actions,cost_per_action_type,quality_ranking,engagement_rate_ranking,campaign_id'
    : 'date_start,impressions,reach,clicks,spend,ctr,cpc,cpm,frequency,conversions,actions,cost_per_action_type,quality_ranking,engagement_rate_ranking';

  try {
    const params = buildMetaInsightsParams(fields, since, until, campaignId);
    const prevFields = campaignId ? 'impressions,reach,clicks,spend,conversions,campaign_id' : 'impressions,reach,clicks,spend,conversions';
    const prevParams = buildMetaInsightsParams(prevFields, prevSince, since, campaignId);
    delete prevParams.time_increment;

    const accountResults = await Promise.allSettled(creds.adAccountIds.map(async (accountId: string) => {
      const [current, previous, account] = await Promise.all([
        metaFetchInsightsWithFallback(`/${accountId}/insights`, params, creds.accessToken, campaignId ?? undefined),
        metaFetchInsightsWithFallback(`/${accountId}/insights`, prevParams, creds.accessToken, campaignId ?? undefined),
        metaFetch(`/${accountId}`, { fields: 'currency' }, creds.accessToken),
      ]);
      return { accountId, current, previous, currency: account?.currency ?? 'EUR' };
    }));

    const successfulAccounts: any[] = accountResults
      .filter(isFulfilled)
      .map((result) => result.value);
    const failedAccountIds = creds.adAccountIds.filter((_: string, idx: number) => accountResults[idx].status === 'rejected');
    let dbFallbackAccounts = 0;

    if (!campaignId && failedAccountIds.length > 0) {
      const fallbackRows = await fetchMetaDailyInsightRows(adminClient, userId, failedAccountIds, since, until);
      const rowsByAccount = groupRowsByAccount(fallbackRows);
      for (const accountId of failedAccountIds) {
        const rows = rowsByAccount[accountId] || [];
      if (rows.length === 0) continue;
      successfulAccounts.push({
        accountId,
        current: { data: mapMetaDailyRowsToInsightsPayload(rows) },
        previous: { data: [] },
        currency: 'EUR',
      });
      dbFallbackAccounts += 1;
      }
    }

    if (successfulAccounts.length === 0) {
      throw (accountResults.find((result) => result.status === 'rejected') as PromiseRejectedResult)?.reason ?? new Error('Meta API error');
    }

    const result: any = buildMetaInsightsLiveResult(successfulAccounts, creds, since, until, days);
    if (dbFallbackAccounts > 0) {
      result.source = dbFallbackAccounts === successfulAccounts.length ? 'db' : 'live+db';
      result.degraded = true;
      result.message = `Included cached Meta daily insights for ${dbFallbackAccounts} account${dbFallbackAccounts === 1 ? '' : 's'} unavailable via live Meta API.`;
    }
    const cacheKey = buildMetaCacheKey('meta:insights', creds.adAccountIds, since, until, campaignId);
    await setMetaCache(adminClient, userId, cacheKey, result);
    return sendJson(result);
  } catch (e: any) {
    const cacheKey = buildMetaCacheKey('meta:insights', creds.adAccountIds, since, until, campaignId);
    const cached = await getMetaCache(adminClient, userId, cacheKey);
    if (cached) {
      return sendJson({
        ...cached.data,
        source: cached.data?.source || 'cache',
        cached: true,
        degraded: true,
        accountId: creds.adAccountId,
        accountIds: creds.adAccountIds,
        last_success: cached.updated_at,
        message: `Meta API error: ${e.message}. Showing cached data.`
      });
    }

    return fetchMetaInsightsFallbackFromDb({ adminClient, userId, creds, since, until, days, sendJson, e });
  }
}

async function persistMetaDailyInsights(adminClient: any, userId: string, adAccountId: string, accessToken: string, sinceDate: string, untilDate: string): Promise<number> {
  const clinicId = await resolveClinicId(adminClient, userId);
  const fields = 'date_start,impressions,reach,clicks,spend,ctr,cpc,cpm,conversions,actions';
  const insightsRes = await metaFetch(`/${adAccountId}/insights`, {
    fields,
    time_range: JSON.stringify({ since: sinceDate, until: untilDate }),
    time_increment: '1',
    limit: '1000',
  }, accessToken);
  const insightsDailyRows: any[] = insightsRes?.data ?? [];
  if (insightsDailyRows.length === 0) return 0;

  const dbRows = insightsDailyRows.map((r: any) => ({
    user_id: userId,
    clinic_id: clinicId,
    ad_account_id: adAccountId,
    date: r.date_start,
    impressions: Math.round(Number(r.impressions || 0)),
    reach: Math.round(Number(r.reach || 0)),
    clicks: Math.round(Number(r.clicks || 0)),
    spend: Number(r.spend || 0),
    conversions: Math.round(Number(r.conversions ?? actionValue(r.actions, (t: string) => t.includes('lead') || t.includes('conversion') || t.includes('complete_registration')) ?? 0)),
    ctr: Number(r.ctr || 0),
    cpc: Number(r.cpc || 0),
    cpm: Number(r.cpm || 0),
    messaging_conversations: actionValue(r.actions, isMessagingConversationAction),
    updated_at: new Date().toISOString(),
  }));

  await adminClient.from('meta_daily_insights')
    .upsert(dbRows, { onConflict: 'clinic_id,ad_account_id,date' });
  return insightsDailyRows.length;
}

async function ingestMetaLeadsFromForms(adminClient: any, userId: string, adAccountId: string, accessToken: string, sinceTs: number): Promise<number> {
  let totalFetched = 0;
  const formsRes = await metaFetch(`/${adAccountId}/leadgen_forms`, {
    fields: 'id,name',
    limit: '50',
  }, accessToken);

  for (const form of (formsRes?.data ?? [])) {
    try {
      const leadsRes = await metaFetch(`/${form.id}/leads`, {
        fields: 'id,field_data,created_time,ad_id,ad_name,form_id,form_name,campaign_id,campaign_name,adset_id,adset_name,page_id',
        filtering: JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: sinceTs }]),
        limit: '500',
      }, accessToken);

      for (const leadData of (leadsRes?.data ?? [])) {
        const success = await processLeadData(adminClient, userId, leadData);
        if (success) totalFetched++;
      }
    } catch (formError: any) {
      console.warn(`Meta backfill failed for form ${form?.id}:`, formError?.message ?? formError);
    }
  }

  return totalFetched;
}

async function persistMetaOrganicDailyInsights(adminClient: any, userId: string, pageId: string, accessToken: string, sinceDate: string, untilDate: string): Promise<number> {
  const PAGE_METRICS = [
    'page_impressions_unique',
    'page_post_engagements',
    'page_video_views',
    'page_views_total',
    'page_actions_post_reactions_total',
  ];
  
  const data = await metaFetch(`/${pageId}/insights`, {
    metric: PAGE_METRICS.join(','),
    period: 'day',
    since: sinceDate,
    until: untilDate,
  }, accessToken);

  const series = Array.isArray(data?.data) ? data.data : [];
  const byDate = new Map<string, any>();
  for (const m of series) {
    const { name } = m;
    for (const v of m.values || []) {
      const day = (v.end_time || '').slice(0, 10);
      if (!day) continue;
      const row = byDate.get(day) || { day };
      row[name] = Number(v.value || 0);
      byDate.set(day, row);
    }
  }

  const dbRows = Array.from(byDate.values()).map(r => ({
    user_id: userId,
    page_id: pageId,
    date: r.day,
    impressions: Math.round(Number(r.page_impressions_unique || 0)),
    reach: Math.round(Number(r.page_impressions_unique || 0)),
    engagements: Math.round(Number(r.page_post_engagements || 0)),
    video_views: Math.round(Number(r.page_video_views || 0)),
    page_views: Math.round(Number(r.page_views_total || 0)),
    reactions: Math.round(Number(r.page_actions_post_reactions_total || 0)),
    updated_at: new Date().toISOString(),
  }));

  if (dbRows.length === 0) return 0;

  await adminClient.from('meta_organic_daily')
    .upsert(dbRows, { onConflict: 'user_id,page_id,date' });

  return dbRows.length;
}

async function persistMetaPostPerformance(adminClient: any, userId: string, pageId: string, accessToken: string, limit: number): Promise<number> {
  const fields = [
    'id',
    'created_time',
    'message',
    'status_type',
    'permalink_url',
    'attachments{media_type}',
    'insights.metric(post_impressions_unique,post_reactions_by_type_total,post_video_views,post_clicks,post_activity_by_action_type)',
  ].join(',');

  const data = await metaFetch(`/${pageId}/posts`, {
    fields,
    limit: String(Math.min(limit, 100)),
  }, accessToken);

  const posts = Array.isArray(data?.data) ? data.data : [];
  if (posts.length === 0) return 0;

  const dbRows = posts.map((p: any) => {
    const insightsByName = new Map();
    const insightsData = p?.insights?.data ?? [];
    for (const { name, values } of insightsData) {
      const firstValue = values?.[0]?.value;
      insightsByName.set(name, firstValue);
    }
    const reactionsObj = insightsByName.get('post_reactions_by_type_total') || {};
    const reactionsTotal = Number(Object.values(reactionsObj).reduce((a: number, b: any) => a + Number(b || 0), 0));
    const activityObj = insightsByName.get('post_activity_by_action_type') || {};
    const comments = Number(activityObj.comment || 0);
    const shares = Number(activityObj.share || 0);
    const engagedUsers = reactionsTotal + comments + shares;

    const attachments = p.attachments?.data || [];
    const mediaType = attachments[0]?.media_type || '';
    const isVideo = /video|reel/i.test(mediaType) || p.status_type === 'added_video';

    return {
      user_id: userId,
      page_id: pageId,
      post_id: p.id,
      created_time: p.created_time,
      message: p.message ?? null,
      status_type: p.status_type ?? null,
      permalink_url: p.permalink_url ?? null,
      impressions: Number(insightsByName.get('post_impressions_unique') || 0),
      reach: Number(insightsByName.get('post_impressions_unique') || 0),
      engaged_users: engagedUsers,
      reactions: reactionsTotal,
      comments: comments,
      shares: shares,
      video_views: Number(insightsByName.get('post_video_views') || 0),
      is_video: Boolean(isVideo),
      updated_at: new Date().toISOString(),
    };
  });

  await adminClient.from('meta_post_performance')
    .upsert(dbRows, { onConflict: 'user_id,post_id' });

  return dbRows.length;
}

async function persistMetaIgAccountDailyInsights(adminClient: any, userId: string, igId: string, accessToken: string, sinceDate: string, untilDate: string): Promise<number> {
  const TIME_SERIES_METRICS = ['reach', 'follower_count'];
  const byDate = new Map<string, any>();

  const tsData = await metaFetch(`/${igId}/insights`, {
    metric: TIME_SERIES_METRICS.join(','),
    period: 'day',
    metric_type: 'time_series',
    since: String(Math.floor(new Date(sinceDate).getTime() / 1000)),
    until: String(Math.floor(new Date(untilDate).getTime() / 1000)),
  }, accessToken);

  for (const m of tsData?.data || []) {
    for (const v of m.values || []) {
      const day = (v.end_time || '').slice(0, 10);
      if (!day) continue;
      const row = byDate.get(day) || { day };
      row[m.name] = Number(v.value || 0);
      byDate.set(day, row);
    }
  }

  const dbRows = Array.from(byDate.values()).map(r => ({
    user_id: userId,
    ig_id: igId,
    date: r.day,
    reach: Number(r.reach || 0),
    follower_count_delta: Number(r.follower_count || 0),
    updated_at: new Date().toISOString(),
  }));

  if (dbRows.length === 0) return 0;

  await adminClient.from('meta_ig_account_daily')
    .upsert(dbRows, { onConflict: 'user_id,ig_id,date' });

  return dbRows.length;
}

async function persistMetaIgMediaPerformance(adminClient: any, userId: string, igId: string, accessToken: string, limit: number): Promise<number> {
  const MEDIA_METRICS = ['reach', 'likes', 'comments', 'shares', 'saved', 'total_interactions', 'views'];
  const fields = 'id,caption,media_type,media_product_type,permalink,timestamp';

  const data = await metaFetch(`/${igId}/media`, {
    fields,
    limit: String(Math.min(limit, 50)),
  }, accessToken);

  const items = Array.isArray(data?.data) ? data.data : [];
  if (items.length === 0) return 0;

  let upserted = 0;
  for (const m of items) {
    try {
      const ins = await metaFetch(`/${m.id}/insights`, {
        metric: MEDIA_METRICS.join(','),
      }, accessToken);
      
      const insights: Record<string, number> = {};
      const insData = ins?.data ?? [];
      for (const row of insData) {
        insights[row.name] = Number(row.values?.[0]?.value ?? 0);
      }

      await adminClient.from('meta_ig_media_performance')
        .upsert({
          user_id: userId,
          ig_id: igId,
          media_id: m.id,
          media_type: m.media_type ?? null,
          media_product_type: m.media_product_type ?? null,
          caption: m.caption ?? null,
          permalink: m.permalink ?? null,
          timestamp: m.timestamp,
          reach: Number(insights.reach || 0),
          views: Number(insights.views || 0),
          likes: Number(insights.likes || 0),
          comments: Number(insights.comments || 0),
          shares: Number(insights.shares || 0),
          saved: Number(insights.saved || 0),
          total_interactions: Number(insights.total_interactions || 0),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,media_id' });
      
      upserted++;
    } catch (e: any) {
      console.warn(`Failed to fetch insights for IG media ${m.id}:`, e.message);
    }
  }

  return upserted;
}

// ── Meta Organic (Page-level + Post-level) ────────────────────────────────
async function handleMetaOrganicGet(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, sub2, req, url, sendJson } = ctx;
  if (resource !== 'meta' || sub !== 'organic' || req.method !== 'GET') return null;

  // Resolve pageId from integrations.metadata
  const { data: integ } = await adminClient.from('integrations')
    .select('metadata')
    .eq('user_id', userId)
    .eq('service', 'meta')
    .maybeSingle();

  const meta = (integ?.metadata ?? {}) as Record<string, any>;
  const pageId = meta.pageId ?? meta.page_id ?? null;
  if (!pageId) {
    return sendJson({ success: false, message: 'No Page ID configured for this Meta integration.' }, 400);
  }

  const days = Math.min(Math.max(Number.parseInt(url.searchParams.get('days') ?? '30', 10) || 30, 1), 365);
  const today = new Date();
  const untilDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1));
  const sinceDate = new Date(Date.UTC(untilDate.getUTCFullYear(), untilDate.getUTCMonth(), untilDate.getUTCDate() - (days - 1)));
  const until = untilDate.toISOString().slice(0, 10);
  const sinceStr = sinceDate.toISOString().slice(0, 10);

  if (sub2 === 'posts') {
    const keyword = (url.searchParams.get('keyword') ?? '').trim();
    const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 1), 200);
    let query = adminClient
      .from('meta_post_performance')
      .select('post_id, created_time, message, status_type, permalink_url, impressions, reach, engaged_users, reactions, comments, shares, video_views, is_video')
      .eq('user_id', userId)
      .eq('page_id', pageId)
      .order('created_time', { ascending: false })
      .limit(limit);
    if (keyword) query = query.ilike('message', `%${keyword}%`);
    const { data, error } = await query;
    if (error) return sendJson({ success: false, message: error.message }, 500);
    return sendJson({ success: true, pageId, count: data?.length ?? 0, posts: data ?? [] });
  }

  // Default: daily series + summary
  const { data: rows, error } = await adminClient.from('meta_organic_daily')
    .select('date, impressions, reach, engagements, video_views, page_views, reactions')
    .eq('user_id', userId)
    .eq('page_id', pageId)
    .gte('date', sinceStr)
    .lte('date', until)
    .order('date', { ascending: true });
  if (error) return sendJson({ success: false, message: error.message }, 500);

  const daily = rows ?? [];
  const summary = daily.reduce((acc: any, r: any) => ({
    impressions: acc.impressions + Number(r.impressions || 0),
    reach: acc.reach + Number(r.reach || 0),
    engagements: acc.engagements + Number(r.engagements || 0),
    video_views: acc.video_views + Number(r.video_views || 0),
    page_views: acc.page_views + Number(r.page_views || 0),
    reactions: acc.reactions + Number(r.reactions || 0),
  }), { impressions: 0, reach: 0, engagements: 0, video_views: 0, page_views: 0, reactions: 0 });

  return sendJson({
    success: true,
    pageId,
    period: { since: sinceStr, until, days },
    summary,
    daily,
  });
}

async function handleMetaIgGet(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, sub2, req, url, sendJson } = ctx;
  if (resource !== 'meta' || sub !== 'ig' || req.method !== 'GET') return null;

  const { data: integ } = await adminClient.from('integrations')
    .select('metadata')
    .eq('user_id', userId)
    .eq('service', 'meta')
    .maybeSingle();

  const meta = (integ?.metadata ?? {}) as Record<string, any>;
  let igId: string | null = meta.igBusinessAccountId ?? meta.ig_business_account_id ?? null;

  // Fallback: auto-discover ig_id from existing DB data when metadata is missing
  if (!igId) {
    const { data: igDiscover } = await adminClient.from('meta_ig_account_daily')
      .select('ig_id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();
    igId = igDiscover?.ig_id ?? null;
  }

  if (!igId) {
    return sendJson({ success: false, message: 'No Instagram Business Account linked to this Meta integration.' }, 400);
  }

  const days = Math.min(Math.max(Number.parseInt(url.searchParams.get('days') ?? '30', 10) || 30, 1), 365);
  const today = new Date();
  const untilDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1));
  const sinceDate = new Date(Date.UTC(untilDate.getUTCFullYear(), untilDate.getUTCMonth(), untilDate.getUTCDate() - (days - 1)));
  const until = untilDate.toISOString().slice(0, 10);
  const sinceStr = sinceDate.toISOString().slice(0, 10);

  if (sub2 === 'posts') {
    const keyword = (url.searchParams.get('keyword') ?? '').trim();
    const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 1), 200);
    let query = adminClient
      .from('meta_ig_media_performance')
      .select('media_id, media_type, media_product_type, caption, permalink, timestamp, reach, views, likes, comments, shares, saved, total_interactions')
      .eq('user_id', userId)
      .eq('ig_id', igId)
      .order('timestamp', { ascending: false })
      .limit(limit);
    if (keyword) query = query.ilike('caption', `%${keyword}%`);
    const { data, error } = await query;
    if (error) return sendJson({ success: false, message: error.message }, 500);
    return sendJson({ success: true, igId, count: data?.length ?? 0, posts: data ?? [] });
  }

  const { data: rows, error } = await adminClient.from('meta_ig_account_daily')
    .select('date, reach, follower_count_delta, profile_views, accounts_engaged, total_interactions, website_clicks, views')
    .eq('user_id', userId)
    .eq('ig_id', igId)
    .gte('date', sinceStr)
    .lte('date', until)
    .order('date', { ascending: true });
  if (error) return sendJson({ success: false, message: error.message }, 500);

  const daily = rows ?? [];
  const summary = daily.reduce((acc: any, r: any) => ({
    reach: acc.reach + Number(r.reach || 0),
    follower_count_delta: acc.follower_count_delta + Number(r.follower_count_delta || 0),
    profile_views: acc.profile_views + Number(r.profile_views || 0),
    accounts_engaged: acc.accounts_engaged + Number(r.accounts_engaged || 0),
    total_interactions: acc.total_interactions + Number(r.total_interactions || 0),
    website_clicks: acc.website_clicks + Number(r.website_clicks || 0),
    views: acc.views + Number(r.views || 0),
  }), { reach: 0, follower_count_delta: 0, profile_views: 0, accounts_engaged: 0, total_interactions: 0, website_clicks: 0, views: 0 });

  return sendJson({
    success: true,
    igId,
    period: { since: sinceStr, until, days },
    summary,
    daily,
  });
}

function parseMetaBackfillDates(url: URL) {
  const days = Math.min(Math.max(Number.parseInt(url.searchParams.get('days') ?? '7', 10) || 7, 1), 500);
  const fromParam = url.searchParams.get('from');
  const sinceDate = fromParam || new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const untilDate = new Date().toISOString().slice(0, 10);
  const sinceTs = Math.floor(new Date(sinceDate).getTime() / 1000);
  return { sinceDate, untilDate, sinceTs };
}

async function performMetaAdsBackfill(
  adminClient: any,
  userId: string,
  accessToken: string,
  adAccountIds: readonly string[],
  sinceDate: string,
  untilDate: string,
  sinceTs: number,
) {
  let dailyInsightsPersisted = 0;
  let totalFetched = 0;
  for (const accountId of adAccountIds) {
    try {
      dailyInsightsPersisted += await persistMetaDailyInsights(adminClient, userId, accountId, accessToken, sinceDate, untilDate);
    } catch (e: any) {
      console.warn(`Meta backfill insights persist failed for ${accountId}:`, e?.message ?? e);
    }
    try {
      totalFetched += await ingestMetaLeadsFromForms(adminClient, userId, accountId, accessToken, sinceTs);
    } catch (e: any) {
      console.error(`Backfill lead ingestion failed for ${accountId}:`, e?.message ?? e);
    }
  }
  return { dailyInsightsPersisted, totalFetched };
}

async function performMetaSocialBackfill(
  adminClient: any,
  userId: string,
  creds: any,
  sinceDate: string,
  untilDate: string,
  result: any,
) {
  if (creds.pageId) {
    try {
      result.organicDailyPersisted = await persistMetaOrganicDailyInsights(adminClient, userId, creds.pageId, creds.accessToken, sinceDate, untilDate);
      result.organicPostsPersisted = await persistMetaPostPerformance(adminClient, userId, creds.pageId, creds.accessToken, 100);
    } catch (e: any) {
      console.warn(`Meta organic backfill failed:`, e?.message ?? e);
    }
  }
  if (creds.igId) {
    try {
      result.igAccountDailyPersisted = await persistMetaIgAccountDailyInsights(adminClient, userId, creds.igId, creds.accessToken, sinceDate, untilDate);
      result.igMediaPersisted = await persistMetaIgMediaPerformance(adminClient, userId, creds.igId, creds.accessToken, 100);
    } catch (e: any) {
      console.warn(`Meta IG backfill failed:`, e?.message ?? e);
    }
  }
}

async function handleMetaBackfillPost(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, url, sendJson } = ctx;
  if (resource !== 'meta' || sub !== 'backfill' || req.method !== 'POST') return null;

  const creds = await resolveMetaCreds(adminClient, userId, url.searchParams.get('adAccountId') ?? '');
  const validation = validateMetaCredentialResult(creds);
  if (!validation.ok) {
    return sendJson({ success: false, message: validation.message }, validation.statusCode);
  }

  const { sinceDate, untilDate, sinceTs } = parseMetaBackfillDates(url);
  const { dailyInsightsPersisted, totalFetched } = await performMetaAdsBackfill(
    adminClient,
    userId,
    creds.accessToken,
    creds.adAccountIds,
    sinceDate,
    untilDate,
    sinceTs,
  );

  const backfillResult: any = {
    success: true,
    accountIds: creds.adAccountIds,
    pageId: creds.pageId,
    igId: creds.igId,
    totalLeadsBackfilled: totalFetched,
    dailyInsightsPersisted,
    organicDailyPersisted: 0,
    organicPostsPersisted: 0,
    igAccountDailyPersisted: 0,
    igMediaPersisted: 0,
    since: sinceDate,
    until: untilDate,
    message: '',
  };

  await performMetaSocialBackfill(adminClient, userId, creds, sinceDate, untilDate, backfillResult);

  backfillResult.message = `Backfill completed (${sinceDate} → ${untilDate}). Ads: ${dailyInsightsPersisted} rows, ${totalFetched} leads. Organic: ${backfillResult.organicDailyPersisted} daily, ${backfillResult.organicPostsPersisted} posts. IG: ${backfillResult.igAccountDailyPersisted} daily, ${backfillResult.igMediaPersisted} media.`;

  await setMetaCache(adminClient, userId, `meta:backfill:${creds.adAccountIds.join(',')}`, backfillResult);
  return sendJson(backfillResult);
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
        accountIds: creds.adAccountIds,
        timestamp: new Date().toISOString()
      });
    } catch (e: any) {
      return sendJson({ status: 'unhealthy', error: e.message, timestamp: new Date().toISOString() }, 503);
    }
  }
  return null;
}

function getMetaDatePreset(days: number) {
  if (days <= 7) return 'last_7d';
  if (days <= 14) return 'last_14d';
  if (days <= 30) return 'last_30d';
  return 'last_90d';
}

function isFulfilled<T>(result: PromiseSettledResult<T>): result is PromiseFulfilledResult<T> {
  return result.status === 'fulfilled';
}

function mapMetaCampaign(c: any) {
  const ins = c?.insights?.data?.[0];
  const conversions = parseMetaMetric(ins?.conversions);
  const cpp: number | null = conversions > 0 ? Number.parseFloat((Number.parseFloat(ins?.spend ?? 0) / conversions).toFixed(2)) : null;
  return {
    id: c.id,
    name: c.name,
    status: String(c.status ?? '').toUpperCase() || 'UNKNOWN',
    objective: c.objective?.replaceAll('_', ' ') ?? '',
    accountId: c.accountId ?? null,
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
      actions: Array.isArray(ins.actions) ? ins.actions : [],
      costPerActionType: ins.cost_per_action_type ?? null,
      qualityRanking: ins.quality_ranking ?? null,
      engagementRateRanking: ins.engagement_rate_ranking ?? null,
    } : null,
  };
}

/** Derives the `time_range` JSON string for the Meta campaigns list fetch.
 *
 * The window matches the caller's requested period (from/to/days) and is
 * clamped to 90 days — the Meta API maximum for the `time_range` filter.
 * Falls back to the full 90-day window when no period params are supplied or
 * when `days` is not a finite number.
 */
function inferStatusFromLastLead(lastLeadAt: string | null | undefined, nowMs: number): string {
  if (!lastLeadAt) return 'ARCHIVED';
  const diff = nowMs - new Date(lastLeadAt).getTime();
  if (diff < 14 * 86_400_000) return 'ACTIVE';
  if (diff < 60 * 86_400_000) return 'PAUSED';
  return 'ARCHIVED';
}

export function buildCampaignsTimeRange(
  campFrom: string,
  campTo: string,
  campDays: number,
  nowMs: number = Date.now(),
): string {
  const maxLookbackMs = 90 * 86_400_000;
  const until = campTo || new Date(nowMs).toISOString().slice(0, 10);
  let requestedSinceMs: number;
  if (campFrom) {
    requestedSinceMs = new Date(campFrom).getTime();
  } else {
    const lookbackMs = Number.isFinite(campDays) ? campDays * 86_400_000 : maxLookbackMs;
    requestedSinceMs = nowMs - Math.min(lookbackMs, maxLookbackMs);
  }
  const since = new Date(Math.max(requestedSinceMs, nowMs - maxLookbackMs)).toISOString().slice(0, 10);
  return JSON.stringify({ since, until });
}

async function fetchDbCampaigns(adminClient: any, userId: string, adAccountId: string) {
  const { data: dbRows } = await adminClient.from('vw_campaign_performance_real')
    .select('campaign_id, campaign_name, source, total_leads, last_lead_at')
    .eq('user_id', userId)
    .order('total_leads', { ascending: false });

  if (!dbRows || dbRows.length === 0) return [];

  const now = Date.now();
  return dbRows.map((row: any) => ({
    id: row.campaign_id ?? `db-${row.campaign_name}`,
    name: row.campaign_name ?? 'Unknown',
    status: inferStatusFromLastLead(row.last_lead_at, now),
    objective: row.source ?? 'LEAD_GENERATION',
    accountId: adAccountId,
    dailyBudget: null,
    lifetimeBudget: null,
    insights: {
      impressions: 0,
      reach: 0,
      clicks: 0,
      spend: 0,
      ctr: 0,
      cpc: 0,
      cpm: 0,
      conversions: Number(row.total_leads ?? 0),
      cpp: null,
      actions: [],
      costPerActionType: null,
      qualityRanking: null,
      engagementRateRanking: null,
    },
  }));
}

async function fetchMetaCampaignsFallback(params: {
  creds: any;
  sendJson: any;
  e: Error;
  adminClient: any;
  userId: string;
}) {
  const { creds, sendJson, e, adminClient, userId } = params;
  try {
    const fallbackResults = await Promise.allSettled(creds.adAccountIds.map(async (accountId: string) => {
      return await metaFetchAll(`/${accountId}/campaigns`, {
        fields: 'id,name,status,objective,daily_budget,lifetime_budget',
        limit: '500',
      }, creds.accessToken);
    }));

    const campaigns = creds.adAccountIds.flatMap((accountId: string, index: number) => {
      const result = fallbackResults[index];
      if (result.status !== 'fulfilled') return [];
      return ((result.value ?? []) as any[]).map((campaign: any) => ({ ...campaign, accountId }));
    });

    // If Meta API returned 0 campaigns, build list from DB (vw_campaign_performance_real)
    if (campaigns.length === 0) {
      const dbCampaigns = await fetchDbCampaigns(adminClient, userId, creds.adAccountId);
      if (dbCampaigns.length > 0) {
        const dbResult = {
          success: true,
          source: 'db',
          cached: false,
          accountId: creds.adAccountId,
          accountIds: creds.adAccountIds,
          campaigns: dbCampaigns,
          warning: 'Campaign data sourced from CRM — Meta API returned no campaigns.',
          dataNote: 'Status inferred from last CRM lead: ACTIVE (<14d), PAUSED (14-60d), ARCHIVED (>60d).',
        };
        return sendJson(dbResult);
      }
    }

    const fallbackResult = {
      success: true,
      source: 'live',
      cached: false,
      accountId: creds.adAccountId,
      accountIds: creds.adAccountIds,
      campaigns: campaigns.map(mapMetaCampaign),
      warning: 'Campaign insights are unavailable; returned campaign metadata only.',
    };
    await setMetaCache(adminClient, userId, `meta:campaigns`, fallbackResult);
    return sendJson(fallbackResult);
  } catch (fallbackError: any) {
    return sendJson({ success: false, metaApiError: true, message: fallbackError?.message ?? e?.message ?? 'Meta API error' }, 502);
  }
}

async function handleMetaCampaignsGet(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, url, sendJson } = ctx;
  if (resource !== 'meta' || sub !== 'campaigns' || req.method !== 'GET') return null;

  const creds = await resolveMetaCreds(adminClient, userId, url.searchParams.get('adAccountId') ?? '');
  const validation = validateMetaCredentialResult(creds);
  if (!validation.ok) {
    const payload: any = { success: false, message: validation.message };
    if (validation.statusCode === 400) payload.notConnected = creds.notConnected || !creds.adAccountId;
    return sendJson(payload, validation.statusCode);
  }

  const campFrom = url.searchParams.get('from') ?? '';
  const campTo = url.searchParams.get('to') ?? '';
  return getMetaCampaignsLiveResult(creds, adminClient, userId, sendJson, campFrom, campTo);
}

async function getMetaCampaignsLiveResult(
  creds: any,
  adminClient: any,
  userId: string,
  sendJson: any,
  campFrom: string,
  campTo: string,
): Promise<Response> {
  const datePreset = campFrom && campTo ? null : 'lifetime';
  const insightsDateParam = campFrom && campTo
    ? `time_range(${JSON.stringify({ since: campFrom, until: campTo })})`
    : `date_preset(${datePreset})`;

  try {
    const accountResults = await Promise.allSettled(creds.adAccountIds.map(async (accountId: string) => {
      const [campaigns, account] = await Promise.all([
        metaFetchAll(`/${accountId}/campaigns`, {
          fields: `id,name,status,objective,daily_budget,lifetime_budget,insights.${insightsDateParam}{impressions,reach,clicks,spend,ctr,cpc,cpm,conversions,actions,cost_per_action_type,quality_ranking,engagement_rate_ranking}`,
          limit: '500',
        }, creds.accessToken),
        metaFetch(`/${accountId}`, { fields: 'currency' }, creds.accessToken),
      ]);
      return { accountId, campaigns, currency: account?.currency ?? 'EUR' };
    }));

    const successfulAccounts = accountResults
      .filter(isFulfilled)
      .map((result) => result.value);

    if (successfulAccounts.length === 0) {
      throw (accountResults.find((result) => result.status === 'rejected') as PromiseRejectedResult)?.reason ?? new Error('Meta API error');
    }

    const campCurrency: string = successfulAccounts.find((acct: any) => acct.currency)?.currency ?? 'EUR';

    const campaigns = successfulAccounts.flatMap((acct: any) => ((acct.campaigns ?? []) as any[])
      .map((campaign) => ({ ...campaign, accountId: acct.accountId })));

    if (campaigns.length === 0) {
      return fetchMetaCampaignsFallback({ creds, sendJson, e: new Error('Meta API returned 0 campaigns'), adminClient, userId });
    }

    const metaCampaigns = campaigns.map(mapMetaCampaign);
    const metaCampaignIds = new Set(metaCampaigns.map((c: any) => String(c.id)));

    const dbCampaigns = await fetchDbCampaigns(adminClient, userId, creds.adAccountId);
    const dbOnlyCampaigns = dbCampaigns.filter((c: any) => !metaCampaignIds.has(String(c.id)));

    const result = {
      success: true,
      source: 'live',
      cached: false,
      accountId: creds.adAccountId,
      accountIds: creds.adAccountIds,
      currency: campCurrency,
      campaigns: [...metaCampaigns, ...dbOnlyCampaigns],
    };
    await setMetaCache(adminClient, userId, `meta:campaigns`, result);
    return sendJson(result);
  } catch (e: any) {
    return fetchMetaCampaignsFallback({ creds, sendJson, e, adminClient, userId });
  }
}

function mapMetaAd(ad: any) {
  const ins = ad?.insights?.data?.[0];
  const conversions = ins ? actionValue(ins.actions, (t: string) => t.includes('lead') || t.includes('conversion') || t.includes('complete_registration')) : 0;
  const spend = parseMetaMetric(ins?.spend);
  const cpp = conversions > 0 ? Number.parseFloat((spend / conversions).toFixed(2)) : null;
  return {
    id: ad.id,
    name: ad.name,
    status: ad.status,
    accountId: ad.accountId ?? null,
    adsetId: ad.adset_id ?? null,
    adsetName: ad.adset?.name ?? null,
    campaignId: ad.campaign_id ?? null,
    campaignName: ad.campaign?.name ?? null,
    insights: ins ? {
      impressions: parseMetaMetric(ins.impressions),
      reach: parseMetaMetric(ins.reach),
      clicks: parseMetaMetric(ins.clicks),
      spend,
      ctr: parseMetaMetric(ins.ctr),
      cpc: parseMetaMetric(ins.cpc),
      cpm: parseMetaMetric(ins.cpm),
      conversions,
      cpp,
      actions: Array.isArray(ins.actions) ? ins.actions : [],
      costPerActionType: ins.cost_per_action_type ?? null,
      qualityRanking: ins.quality_ranking ?? null,
      engagementRateRanking: ins.engagement_rate_ranking ?? null,
    } : null,
  };
}

async function fetchAdInsightsFromMeta(creds: any, insightsSince: string, insightsUntil: string) {
  const insightsMap: Record<string, any> = {};
  for (const accountId of creds.adAccountIds) {
    try {
      const insRes = await metaFetch(`/${accountId}/insights`, {
        fields: 'ad_id,ad_name,spend,impressions,reach,clicks,ctr,cpc,cpm,conversions,actions',
        level: 'ad',
        time_range: JSON.stringify({ since: insightsSince, until: insightsUntil }),
        time_increment: 'all',
        limit: '500',
      }, creds.accessToken);
      for (const row of (insRes?.data ?? []) as any[]) {
        if (!row.ad_id) continue;
        const spend = Number(row.spend || 0);
        const conversions = actionValue(row.actions, (t: string) => t.includes('lead') || t.includes('conversion') || t.includes('complete_registration'));
        insightsMap[row.ad_id] = {
          spend,
          impressions: Math.round(Number(row.impressions || 0)),
          reach: Math.round(Number(row.reach || 0)),
          clicks: Math.round(Number(row.clicks || 0)),
          ctr: Number(row.ctr || 0),
          cpc: Number(row.cpc || 0),
          cpm: Number(row.cpm || 0),
          conversions,
          cpp: conversions > 0 ? Number.parseFloat((spend / conversions).toFixed(2)) : null,
        };
      }
    } catch (insErr: any) {
      console.warn(`Ad-level insights fetch failed for ${accountId}:`, insErr?.message ?? insErr);
    }
  }
  return insightsMap;
}

async function fetchAdDataFromCrm(adminClient: any, userId: string) {
  const { data: adLeads } = await adminClient.from('leads')
    .select('ad_id, ad_name, campaign_id, campaign_name, created_at')
    .eq('user_id', userId)
    .not('ad_id', 'is', null)
    .order('created_at', { ascending: false });
  return adLeads ?? [];
}

async function fetchMetaAdsFallback(params: {
  creds: any;
  sendJson: any;
  e: Error;
  adminClient?: any;
  userId?: string;
  adsFrom?: string;
  adsTo?: string;
  adsDays?: number;
}) {
  const { creds, sendJson, e, adminClient, userId, adsFrom, adsTo, adsDays } = params;
  // Compute the time_range string to use for ad-level insights fetch
  const insightsSince = adsFrom || new Date(Date.now() - (adsDays ?? 30) * 86_400_000).toISOString().slice(0, 10);
  const insightsUntil = adsTo || new Date().toISOString().slice(0, 10);
  try {
    const fallbackResults = await Promise.allSettled(creds.adAccountIds.map(async (accountId: string) => {
      return await metaFetchAll(`/${accountId}/ads`, {
        fields: 'id,name,status,adset_id,adset{name},campaign_id,campaign{name}',
        limit: '500',
      }, creds.accessToken);
    }));

    const ads = creds.adAccountIds.flatMap((accountId: string, index: number) => {
      const result = fallbackResults[index];
      if (result.status !== 'fulfilled') return [];
      return ((result.value ?? []) as any[]).map((ad: any) => ({ ...ad, accountId }));
    });

    // If Meta API returned 0 ads, build list from leads.ad_id / ad_name
    // and enrich spend/impressions/clicks from /{accountId}/insights?level=ad
    if (ads.length === 0 && adminClient && userId) {
      const insightsMap = await fetchAdInsightsFromMeta(creds, insightsSince, insightsUntil);
      const adLeads = await fetchAdDataFromCrm(adminClient, userId);
      const adMap = buildAdMapFromCrm(adLeads);
      addInsightsOnlyAdsToMap(adMap, insightsMap);

      if (Object.keys(adMap).length > 0) {
        const now = Date.now();
        const dbAds = Object.entries(adMap).map(([adId, v]) => {
          const status = inferStatusFromLastLead(v.lastAt, now);
          const ins = insightsMap[adId];
          const crmConversions = v.count;
          return {
            id: adId,
            name: v.name,
            status,
            accountId: creds.adAccountId,
            adsetId: null,
            adsetName: null,
            campaignId: v.campaignId,
            campaignName: v.campaignName,
            insights: {
              impressions: ins?.impressions ?? 0,
              reach: ins?.reach ?? 0,
              clicks: ins?.clicks ?? 0,
              spend: ins?.spend ?? 0,
              ctr: ins?.ctr ?? 0,
              cpc: ins?.cpc ?? 0,
              cpm: ins?.cpm ?? 0,
              conversions: ins ? Math.max(ins.conversions, crmConversions) : crmConversions,
              cpp: ins?.cpp ?? null,
              actions: [],
              costPerActionType: null,
              qualityRanking: null,
              engagementRateRanking: null,
            },
          };
        });
        const hasRealInsights = Object.keys(insightsMap).length > 0;
        return sendJson({
          success: true,
          source: hasRealInsights ? 'live+db' : 'db',
          cached: false,
          accountId: creds.adAccountId,
          accountIds: creds.adAccountIds,
          currency: 'EUR',
          ads: dbAds,
          warning: hasRealInsights
            ? 'Spend/impressions sourced from Meta Insights API; conversions from CRM.'
            : 'Ad data sourced from CRM — Meta API returned no ads or insights.',
        });
      }
    }

    return sendJson({ success: true, accountId: creds.adAccountId, accountIds: creds.adAccountIds, currency: 'EUR', ads: ads.map(mapMetaAd), warning: 'Insights no disponibles.' });
  } catch (fallbackErr: any) {
    return sendJson({ success: false, metaApiError: true, message: fallbackErr?.message ?? e?.message ?? 'Meta API error' }, 502);
  }
}

function buildAdMapFromCrm(adLeads: any[]) {
  const adMap: Record<string, { name: string; campaignId: string | null; campaignName: string | null; count: number; lastAt: string }> = {};
  for (const row of adLeads) {
    if (!row.ad_id) continue;
    if (!adMap[row.ad_id]) {
      adMap[row.ad_id] = {
        name: row.ad_name ?? `Ad ${row.ad_id}`,
        campaignId: row.campaign_id ?? null,
        campaignName: row.campaign_name ?? null,
        count: 0,
        lastAt: row.created_at,
      };
    }
    adMap[row.ad_id].count++;
  }
  return adMap;
}

function addInsightsOnlyAdsToMap(adMap: Record<string, { name: string; campaignId: string | null; campaignName: string | null; count: number; lastAt: string }>, insightsMap: Record<string, any>) {
  for (const [adId, ins] of Object.entries(insightsMap)) {
    if (!adMap[adId]) {
      adMap[adId] = {
        name: `Ad ${adId}`,
        campaignId: null,
        campaignName: null,
        count: ins?.conversions ?? 0,
        lastAt: new Date().toISOString(),
      };
    }
  }
}

async function fetchAdsFromAccounts(adAccountIds: readonly string[], insightsDateParam: string, accessToken: string) {
  return await Promise.allSettled(adAccountIds.map(async (accountId: string) => {
    const [ads, acctData] = await Promise.all([
      metaFetchAll(`/${accountId}/ads`, {
        fields: `id,name,status,adset_id,adset{name},campaign_id,campaign{name},insights.${insightsDateParam}{impressions,reach,clicks,spend,ctr,cpc,cpm,actions,cost_per_action_type,quality_ranking,engagement_rate_ranking}`,
        limit: '500',
      }, accessToken),
      metaFetch(`/${accountId}`, { fields: 'currency' }, accessToken),
    ]);
    return { accountId, ads, currency: acctData?.currency ?? 'EUR' };
  }));
}

async function handleMetaAdsGet(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, url, sendJson } = ctx;
  if (resource !== 'meta' || sub !== 'ads' || req.method !== 'GET') return null;

  const creds = await resolveMetaCreds(adminClient, userId, url.searchParams.get('adAccountId') ?? '');
  const validation = validateMetaCredentialResult(creds);
  if (!validation.ok) {
    const payload: any = { success: false, message: validation.message };
    if (validation.statusCode === 400) payload.notConnected = creds.notConnected || !creds.adAccountId;
    return sendJson(payload, validation.statusCode);
  }

  const adsFrom = url.searchParams.get('from') ?? '';
  const adsTo = url.searchParams.get('to') ?? '';
  const adsDays = Number.parseInt(url.searchParams.get('days') ?? '30', 10) || 30;
  return getMetaAdsLiveResult(creds, sendJson, adminClient, userId, adsFrom, adsTo, adsDays);
}

async function getMetaAdsLiveResult(
  creds: any,
  sendJson: any,
  adminClient: any,
  userId: string,
  adsFrom: string,
  adsTo: string,
  adsDays: number,
): Promise<Response> {
  const datePreset = adsFrom && adsTo ? null : 'lifetime';
  const insightsDateParam = adsFrom && adsTo
    ? `time_range(${JSON.stringify({ since: adsFrom, until: adsTo })})`
    : `date_preset(${datePreset})`;

  try {
    const accountResults = await fetchAdsFromAccounts(creds.adAccountIds, insightsDateParam, creds.accessToken);

    const successfulAccounts = accountResults
      .filter(isFulfilled)
      .map((result) => result.value);

    if (successfulAccounts.length === 0) {
      throw (accountResults.find((result) => result.status === 'rejected') as PromiseRejectedResult)?.reason ?? new Error('Meta API error');
    }

    const currency: string = successfulAccounts.find((acct: any) => acct.currency)?.currency ?? 'EUR';
    const ads = successfulAccounts.flatMap((acct: any) => ((acct.ads ?? []) as any[])
      .map((ad: any) => ({ ...ad, accountId: acct.accountId })));

    if (ads.length === 0) {
      return fetchMetaAdsFallback({ creds, sendJson, e: new Error('Meta API returned 0 ads'), adminClient, userId, adsFrom, adsTo, adsDays });
    }

    return sendJson({ success: true, accountId: creds.adAccountId, accountIds: creds.adAccountIds, currency, ads: ads.map(mapMetaAd) });
  } catch (e: any) {
    return fetchMetaAdsFallback({ creds, sendJson, e, adminClient, userId, adsFrom, adsTo, adsDays });
  }
}

async function handleAiAnalyzePost(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, sendJson } = ctx;
  if (resource === 'ai' && sub === 'analyze' && req.method === 'POST') {
    const rawBody = await req.json();
    const body = (rawBody && typeof rawBody === 'object') ? rawBody as Record<string, any> : {};
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
    const { data: recentCalls, error: rlError } = await adminClient.from('api_call_log')
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
    const rawBody = await req.json().catch(() => ({}));
    const body = (rawBody && typeof rawBody === 'object') ? rawBody as Record<string, any> : {};
    const service = String(body.service ?? '').trim();
    if (!service) return sendJson({ success: false, message: 'service is required' }, 400);
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.metadata !== undefined) updates.metadata = body.metadata;
    if (body.status !== undefined) updates.status = body.status;
    const { error } = await adminClient.from('integrations')
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
    const { data, error } = await adminClient.from('integrations')
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
    const { data, error } = await adminClient.from('integrations')
      .select('id, service, status, last_sync, last_error, metadata')
      .eq('user_id', userId)
      .order('service');
    if (error) throw error;
    return sendJson({ success: true, integrations: data });
  }
  return null;
}

function normalizeIntegrationMetadata(service: string, metadata: any) {
  if (service === 'meta') {
    const accountIds = normalizeMetaAccountIds(metadata?.adAccountIds ?? metadata?.ad_account_ids ?? metadata?.adAccountId ?? metadata?.ad_account_id ?? '');
    const normalized = accountIds.length > 0 ? accountIds.join(',') : '';
    const normalizedPageId = String(metadata?.pageId ?? metadata?.page_id ?? '').replaceAll(/\D/g, '');
    return {
      ...metadata,
      adAccountIds: accountIds,
      ad_account_ids: accountIds,
      adAccountId: normalized,
      ad_account_id: normalized,
      pageId: normalizedPageId,
      page_id: normalizedPageId,
    };
  }
  if (service === 'whatsapp') {
    const normalized = normalizePhoneNumberId(metadata?.phoneNumberId ?? metadata?.phone_number_id ?? '');
    if (normalized) {
      return {
        ...metadata,
        phoneNumberId: normalized,
        phone_number_id: normalized,
      };
    }
  }
  return metadata;
}

function validateAndNormalizeMetadata(service: string, inputMetadata: any) {
  let metadata = inputMetadata ?? {};
  if (service === 'whatsapp') {
    const normalized = normalizePhoneNumberId(metadata?.phoneNumberId ?? metadata?.phone_number_id ?? '');
    if (!normalized) return { ok: false, message: 'phoneNumberId is required for WhatsApp' };
    metadata = { ...metadata, phoneNumberId: normalized, phone_number_id: normalized };
  }
  if (service === 'meta') {
    const accountIds = normalizeMetaAccountIds(metadata?.adAccountIds ?? metadata?.ad_account_ids ?? metadata?.adAccountId ?? metadata?.ad_account_id ?? '');
    if (accountIds.length === 0) return { ok: false, message: 'Meta integration requires one or more valid ad account IDs.' };
    const normalizedPageId = String(metadata?.pageId ?? metadata?.page_id ?? '').replaceAll(/\D/g, '');
    metadata = {
      ...metadata,
      adAccountIds: accountIds,
      ad_account_ids: accountIds,
      adAccountId: accountIds.join(','),
      ad_account_id: accountIds.join(','),
      pageId: normalizedPageId,
      page_id: normalizedPageId,
    };
  }
  return { ok: true, metadata };
}

async function handleIntegrationsConnectPost(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, authUser, resource, sub, req, sendJson } = ctx;
  if (resource === 'integrations' && sub === 'connect' && req.method === 'POST') {
    const rawBody = await req.json();
    const body = (rawBody && typeof rawBody === 'object') ? rawBody as Record<string, any> : {};
    const service = String(body.service ?? '').trim();
    if (!service) return sendJson({ success: false, message: 'service is required' }, 400);
    const reqToken = body.token;
    if (!reqToken) return sendJson({ success: false, message: 'token is required' }, 400);

    const { ok, message, metadata } = validateAndNormalizeMetadata(service, body.metadata);
    if (!ok) return sendJson({ success: false, message }, 400);

    await ensurePublicUserRow(adminClient, authUser);
    const encryptedKey = await encryptCred(String(reqToken).trim());

    const { error: credErr } = await adminClient.from('credentials')
      .upsert({ user_id: userId, service, encrypted_key: encryptedKey }, { onConflict: 'user_id,service' });
    if (credErr) throw credErr;

    const { error: intErr } = await adminClient.from('integrations')
      .upsert(
        { user_id: userId, service, status: 'connected', metadata, updated_at: new Date().toISOString() },
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
    const rawBody = await req.json().catch(() => ({}));
    const body = (rawBody && typeof rawBody === 'object') ? rawBody as Record<string, any> : {};
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
  
    const { data: cred } = await adminClient.from('credentials').select('service').eq('user_id', userId).eq('service', service).single();
    const status = cred ? 'connected' : 'error';
    return sendJson({ success: !!cred, service, status, metadata: {} });
  }
  return null;
}

async function handlePlaybooksGet(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, resource, sub, req, sendJson } = ctx;
  if (resource === 'playbooks' && req.method === 'GET' && sub === '') {
    const { data, error } = await adminClient.from('playbooks')
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

function getPlaybookStrategyPrompt(pbTitle: string, clinic: any) {
  return [
    `Generate a concise WhatsApp message for playbook strategy: ${pbTitle}.`,
    `Audience: ${clinic.specialty} clinic leads in ${clinic.city}.`,
    'Style: professional, warm, and action-oriented.',
    'Length: max 3 short paragraphs and one CTA.',
  ].join('\n');
}

async function logPlaybookExecution(adminClient: any, userId: string, playbookId: string, agentOutputId: string | null, status: string = 'success') {
  const { data: exec, error: execErr } = await adminClient.from('playbook_executions')
    .insert({
      playbook_id: playbookId,
      user_id: userId,
      status,
      metadata: agentOutputId ? { agent_output_id: agentOutputId } : {},
      agent_output_id: agentOutputId,
    })
    .select().single();
  if (execErr) throw execErr;

  const { data: pb } = await adminClient.from('playbooks').select('run_count').eq('id', playbookId).single();
  if (pb) {
    await adminClient.from('playbooks')
      .update({ run_count: (pb.run_count || 0) + 1, last_run_at: new Date().toISOString() })
      .eq('id', playbookId);
  }
  return exec;
}

async function handlePlaybooksRunPost(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, sub2, req, sendJson } = ctx;
  if (resource === 'playbooks' && sub2 === 'run' && req.method === 'POST') {
    const rawBody = await req.json().catch(() => ({}));
    const body = (rawBody && typeof rawBody === 'object') ? rawBody as Record<string, any> : {};
    const preferredProvider = String(body?.provider ?? '').trim();
    const { data: pb, error: pbErr } = await adminClient.from('playbooks').select('id, title, status, run_count').eq('slug', sub).single();
    if (pbErr || !pb) return sendJson({ success: false, message: `Playbook '${sub}' not found` }, 404);
    if (pb.status === 'archived') return sendJson({ success: false, message: 'Playbook is archived' }, 400);
  
    let generatedMessage = '';
    let providerUsed: 'gemini' | 'openai' | null = null;
    let providerErrors: string[] = [];
    const clinic = await resolveClinicMetadata(adminClient, userId);
    const strategyPrompt = getPlaybookStrategyPrompt(pb.title, clinic);
  
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

    const exec = await logPlaybookExecution(adminClient, userId, pb.id, agentOutputId);

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
    const { data: cred } = await adminClient.from('credentials').select('service').eq('user_id', userId).in('service', ['openai', 'gemini']);
    const hasAi = Array.isArray(cred) && cred.length > 0;
    return sendJson({
      success: true,
      available: hasAi,
      provider: hasAi ? cred?.[0]?.service ?? null : null,
    });
  }
  return null;
}

async function handleAiGeneratePost(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, sendJson } = ctx;
  if (resource === 'ai' && sub === 'generate' && req.method === 'POST') {
    const rawBody = await req.json();
    const body = (rawBody && typeof rawBody === 'object') ? rawBody as Record<string, any> : {};
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

async function autoFetchCampaignDataForAi(adminClient: any, userId: string): Promise<string> {
  try {
    const dbCampaigns = await fetchDbCampaigns(adminClient, userId, '');
    if (dbCampaigns.length > 0) return JSON.stringify(dbCampaigns.slice(0, 25), null, 2);
  } catch (snapshotErr) {
    console.error('[ai.analyze-campaign] snapshot fetch failed', snapshotErr);
  }
  return '';
}

function buildAnalyzeCampaignPrompt(clinic: { name: string; specialty: string; city: string }, campaignData: string, prior: Array<{ created_at: string; output_text: string }>): string {
  return [
    `Eres el "Agente de Análisis de Campañas" de ${clinic.name}, una clínica ${clinic.specialty} premium en ${clinic.city}.`,
    'Tu objetivo es analizar TODAS las variables disponibles (gasto, leads, CPL, CTR, conversiones, fuente, estado, antigüedad del último lead) y producir recomendaciones específicas, medibles y orientadas a reducir CPL y aumentar conversión.',
    'No inventes datos: cita exclusivamente los números del dataset.',
    '',
    '## Datos de campañas (snapshot actual)',
    campaignData,
    buildPriorContextSection(prior),
    '',
    'Responde EXACTAMENTE con este formato markdown en español:',
    '## Resumen de rendimiento',
    '[2-3 líneas con el estado general y la diferencia respecto al análisis previo si existe]',
    '',
    '## ✅ Fortalezas',
    '• [dato concreto con números]',
    '• [dato concreto con números]',
    '• [dato concreto con números]',
    '',
    '## ⚠️ Áreas de mejora',
    '• [oportunidad + recomendación concreta]',
    '• [oportunidad + recomendación concreta]',
    '• [oportunidad + recomendación concreta]',
    '',
    '## 🚀 Acciones esta semana',
    '1. [acción específica y medible]',
    '2. [acción específica y medible]',
    '3. [acción específica y medible]',
    '',
    '## 🚨 Alertas',
    '[KPIs preocupantes o tendencias negativas a vigilar]',
  ].join('\n');
}

async function handleAiAnalyzeCampaignPost(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, sendJson } = ctx;
  if (resource !== 'ai' || sub !== 'analyze-campaign' || req.method !== 'POST') return null;

  const rawBody = await req.json().catch(() => ({}));
  const body = (rawBody && typeof rawBody === 'object') ? rawBody as Record<string, any> : {};
  let campaignData = String(body?.campaignData ?? '').trim();
  const provider = String(body?.provider ?? '').trim();
  const playbookExecutionId = String(body?.playbookExecutionId ?? '').trim();

  if (!campaignData) campaignData = await autoFetchCampaignDataForAi(adminClient, userId);
  if (!campaignData) {
    return sendJson({
      success: true,
      analysis: null,
      empty: true,
      message: 'Aún no hay datos de campañas para analizar. Conecta Meta Ads o importa leads para que el agente pueda trabajar.',
    });
  }

  const clinic = await resolveClinicMetadata(adminClient, userId);
  const prior = await fetchPriorAgentOutputs(adminClient, userId, 'ai.analyze-campaign', 5);
  const prompt = buildAnalyzeCampaignPrompt(clinic, campaignData, prior);

  try {
    const { text, provider: usedProvider, providerErrors } = await runAiPrompt(adminClient, userId, prompt, provider || 'gemini');
    const outputId = await persistAgentOutput(adminClient, userId, 'ai.analyze-campaign', { analysis: text }, {
      providerRequested: provider || null,
      providerUsed: usedProvider,
      providerErrors,
      priorOutputsUsed: prior.length,
      source: 'api.ai.analyze-campaign',
      playbookExecutionId: playbookExecutionId || null,
    });

    if (playbookExecutionId && outputId) {
      await linkAgentOutputToPlaybookExecution(adminClient, userId, playbookExecutionId, outputId);
    }
    return sendJson({ success: true, analysis: text, provider: usedProvider, outputId });
  } catch (err: any) {
    console.error('AI request error:', err);
    const message = err?.message?.includes('No AI integration')
      ? err.message
      : 'AI request failed. Please try again.';
    return sendJson({ success: false, code: 'AI_REQUEST_FAILED', message }, 502);
  }
}

async function handleAiSuggestionsPost(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, sendJson } = ctx;
  if (resource === 'ai' && sub === 'suggestions' && req.method === 'POST') {
    const { data: leads } = await adminClient
      .from('leads')
      .select('stage, source, revenue, created_at')
      .eq('user_id', userId)
      .neq('source', 'doctoralia'); // NUVANX: Doctoralia nunca es fuente de leads
    const leadList = leads ?? [];
    const total = leadList.length;
    const byStage: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    let pipelineValue = 0;
    for (const l of leadList as any[]) {
      const stage = String(l?.stage ?? 'unknown');
      const source = String(l?.source ?? 'unknown');
      byStage[stage] = (byStage[stage] ?? 0) + 1;
      bySource[source] = (bySource[source] ?? 0) + 1;
      pipelineValue += Number(l?.revenue || 0);
    }
    const snapshot = { total, byStage, bySource, pipelineValue };

    const ruleBased = total === 0
      ? [
          'Añade tu primer lead para activar los insights del agente.',
          'Conecta Meta Ads para empezar a medir el rendimiento publicitario.',
          'Configura WhatsApp para automatizar el primer contacto.',
        ]
      : [
          `Tienes ${total} leads — prioriza mover los ${byStage['whatsapp'] ?? 0} de WhatsApp a cita.`,
          `Hay ${byStage['appointment'] ?? 0} citas pendientes — envía recordatorios de seguimiento.`,
          `Pipeline total: €${pipelineValue.toLocaleString('es-ES')}.`,
        ];

    let suggestions: string[] = ruleBased;
    let providerUsed: string | null = null;
    let providerErrors: string[] = [];

    if (total > 0) {
      const clinic = await resolveClinicMetadata(adminClient, userId).catch(() => ({ name: 'la clínica', specialty: 'estética', city: '' }));
      const prior = await fetchPriorAgentOutputs(adminClient, userId, 'ai.suggestions', 5);
      const prompt = [
        `Eres el "Agente de Sugerencias Operativas" de ${clinic.name} (${clinic.specialty}, ${clinic.city}).`,
        'Tu objetivo: emitir 3-5 sugerencias accionables HOY basadas en TODAS las variables del CRM. Cada sugerencia es una sola frase, empieza con un verbo en imperativo y cita números reales.',
        'No repitas literalmente sugerencias de la memoria si la situación no ha cambiado — propón nuevos ángulos.',
        '',
        '## Snapshot CRM',
        JSON.stringify(snapshot, null, 2),
        buildPriorContextSection(prior),
        '',
        'Responde SOLO con un array JSON de strings. Ejemplo:',
        '["Llama a los 3 leads de WhatsApp con más de 24h sin respuesta", "..."]',
      ].join('\n');

      try {
        const aiResult = await runAiPrompt(adminClient, userId, prompt, 'gemini');
        providerUsed = aiResult.provider;
        providerErrors = aiResult.providerErrors;
        const parsed = parseAiSuggestionsList(aiResult.text);
        if (parsed.length > 0) suggestions = parsed;
      } catch (aiErr: any) {
        providerErrors = aiErr?.providerErrors ?? [aiErr?.message ?? 'unknown'];
        // Fall back to rule-based suggestions silently — panel still works.
      }
    }

    const outputId = await persistAgentOutput(adminClient, userId, 'ai.suggestions', {
      suggestions,
      totalLeads: total,
    }, {
      source: 'api.ai.suggestions',
      providerUsed,
      providerErrors,
      snapshot,
    });

    return sendJson({ success: true, suggestions, outputId, provider: providerUsed });
  }
  return null;
}

/** Best-effort parse of an AI response into a list of suggestion strings. */
function parseAiSuggestionsList(text: string): string[] {
  const trimmed = String(text || '').trim();
  if (!trimmed) return [];
  // Try strict JSON first.
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.map((s: any) => String(s ?? '').trim()).filter(Boolean);
    }
  } catch {
    // ignore
  }
  // Try to locate a JSON array inside the response.
  const match = /\[[\s\S]*\]/.exec(trimmed);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) {
        return parsed.map((s: any) => String(s ?? '').trim()).filter(Boolean);
      }
    } catch {
      // ignore
    }
  }
  // Last resort: bullet/line splitting.
  return trimmed
    .split(/\r?\n+/)
    .map((line) => line.replace(/^\s*(?:[-•*\d.)\]]+\s*)+/, '').trim())
    .filter((line) => line.length > 0)
    .slice(0, 6);
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
      const { data: execRows } = await adminClient.from('playbook_executions')
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

function aggregateGoogleAdsInsights(daily: any[], prevData: any[]) {
  const micros2eur = (m: number) => Number.parseFloat((m / 1_000_000).toFixed(2));
  const sumF = (rows: any[], field: string) => rows.reduce((s, r) => {
    const value = r?.metrics?.[field];
    return s + Number(value ?? 0);
  }, 0);

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
  
  return {
    currImp, currClicks, currSpend, currConv,
    prevImp, prevClicks, prevSpend, prevConv,
    ctr, cpc, cpm, cpp
  };
}

async function handleGoogleAdsInsightsGet(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, url, sendJson } = ctx;
  if (resource === 'google-ads' && sub === 'insights' && req.method === 'GET') {
    const g = await resolveGoogleAdsCreds(adminClient, userId, url.searchParams.get('customerId') ?? '');
    if (g.noServiceAccount) return sendJson({ success: false, noServiceAccount: true, message: 'Google Ads service account not configured.' });
    if (g.notConnected) return sendJson({ success: false, notConnected: true, message: 'Google Ads not connected. Add your developer token in Integrations.' });
    const { customerId, devToken, serviceAccount } = g;
    if (!customerId) return sendJson({ success: false, noAccountId: true, message: 'Google Ads Customer ID not configured.' });
    const days = Math.min(Math.max(Number.parseInt(url.searchParams.get('days') ?? '30', 10) || 30, 1), 90);
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
  
    const { currImp, currClicks, currSpend, currConv, prevImp, prevClicks, prevSpend, prevConv, ctr, cpc, cpm, cpp } = aggregateGoogleAdsInsights(daily, prevData);
    const pct = percentChange;
    const micros2eur = (m: number) => Number.parseFloat((m / 1_000_000).toFixed(2));
  
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
    if (g.noServiceAccount) return sendJson({ success: false, noServiceAccount: true, message: 'Google Ads service account not configured.' });
    if (g.notConnected) return sendJson({ success: false, notConnected: true, message: 'Google Ads not connected.' });
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

function calculateAvgLiquidationDays(settled: any[]) {
  const liquidationDays = settled
    .filter((r: any) => r.intake_at)
    .map((r: any) => (new Date(r.settled_at).getTime() - new Date(r.intake_at).getTime()) / 86400000);
  return liquidationDays.length
    ? liquidationDays.reduce((a: number, b: number) => a + b, 0) / liquidationDays.length
    : 0;
}

function calculateFinancialMetrics(rows: any[]) {
  const operationsCount = rows.length;
  const settled = rows.filter((r: any) => !r.cancelled_at);
  const cancelledCount = operationsCount - settled.length;
  const totalNet = settled.reduce((s: number, r: any) => s + Number(r.amount_net), 0);
  const totalGross = settled.reduce((s: number, r: any) => s + (Number(r.amount_gross) || Number(r.amount_net)), 0);
  const totalDiscount = settled.reduce((s: number, r: any) => s + Number(r.amount_discount), 0);
  const avgTicket = settled.length ? totalNet / settled.length : 0;
  
  const effectiveDiscount = totalDiscount > 0 ? totalDiscount : Math.max(0, totalGross - totalNet);
  const discountRate = totalGross > 0 ? (effectiveDiscount / totalGross) * 100 : 0;
  const cancellationRate = operationsCount > 0 ? (cancelledCount / operationsCount) * 100 : 0;

  const avgLiquidationDays = calculateAvgLiquidationDays(settled);

  return {
    totalNet, totalGross, totalDiscount, avgTicket, discountRate, cancellationRate, avgLiquidationDays,
    settledCount: settled.length, cancelledCount, operationsCount,
    settled
  };
}

async function handleFinancialsSummary(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, url, sendJson } = ctx;
  if (resource === 'financials' && sub === 'summary') {
    return await processFinancialsSummary(adminClient, userId, url, sendJson);
  }
  return null;
}

async function processFinancialsSummary(adminClient: any, userId: string, url: URL, sendJson: any): Promise<Response> {
  const { data: usr } = await adminClient.from('users').select('clinic_id').eq('id', userId).single();
  const clinicId = usr?.clinic_id;
  if (!clinicId) return sendJson({ success: false, message: 'No clinic' }, 400);

  const fromParam = url.searchParams.get('from') ?? '';
  const toParam = url.searchParams.get('to') ?? '';

  let query = adminClient
    .from('financial_settlements')
    .select('amount_gross, amount_discount, amount_net, template_name, settled_at, intake_at, cancelled_at, source_system')
    .eq('clinic_id', clinicId)
    .eq('source_system', 'doctoralia')
    .order('settled_at', { ascending: false });
  if (fromParam) query = query.gte('settled_at', fromParam);
  if (toParam) query = query.lte('settled_at', toParam);

  const { data: rows } = await query;
  const metrics = calculateFinancialMetrics(rows || []);
  const { settled, totalNet } = metrics;

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
    pct: Math.round((v.net / (totalNet || 1)) * 1000) / 10,
  })).sort((a, b) => b.net - a.net);

  const monthMap: Record<string, { net: number; gross: number; discount: number; count: number }> = {};
  for (const r of settled) {
    const m = r.settled_at?.slice(0, 7);
    if (m) {
      if (!monthMap[m]) monthMap[m] = { net: 0, gross: 0, discount: 0, count: 0 };
      monthMap[m].net += Number(r.amount_net);
      monthMap[m].gross += Number(r.amount_gross) || Number(r.amount_net);
      monthMap[m].discount += Number(r.amount_discount);
      monthMap[m].count++;
    }
  }
  const monthly = Object.entries(monthMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({
      month,
      net: Math.round(v.net * 100) / 100,
      gross: Math.round(v.gross * 100) / 100,
      discount: Math.round(v.discount * 100) / 100,
      count: v.count,
    }));

  return sendJson({
    success: true,
    summary: {
      totalNet: Math.round(metrics.totalNet * 100) / 100,
      totalGross: Math.round(metrics.totalGross * 100) / 100,
      totalDiscount: Math.round(metrics.totalDiscount * 100) / 100,
      avgTicket: Math.round(metrics.avgTicket * 100) / 100,
      discountRate: Math.round(metrics.discountRate * 10) / 10,
      cancellationRate: Math.round(metrics.cancellationRate * 10) / 10,
      avgLiquidationDays: Math.round(metrics.avgLiquidationDays * 10) / 10,
      settledCount: metrics.settledCount,
      cancelledCount: metrics.cancelledCount,
      operationsCount: metrics.operationsCount,
    },
    templateMix,
    monthly,
    diagnostics: {
      reason: settled.length > 0 ? 'ok' : 'no_settlements',
      clinicId,
    },
  });
}

async function handleFinancialsSettlements(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, sendJson } = ctx;
  if (resource === 'financials' && sub === 'settlements') {
    const { data: usr } = await adminClient.from('users').select('clinic_id').eq('id', userId).single();
    const clinicId = usr?.clinic_id;
    if (!clinicId) return sendJson({ success: false, message: 'No clinic' }, 400);
  
    const { data: rows } = await adminClient.from('financial_settlements')
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
  
    const { data: rows } = await adminClient.from('patients')
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

async function fetchLeadCampaignMap(adminClient: any, userId: string, leadIds: string[]) {
  const leadCampaignMap: Map<string, string> = new Map();
  if (leadIds.length === 0) return leadCampaignMap;

  const [leadRows, traceRows] = await Promise.all([
    adminClient.from('leads').select('id,source,stage').eq('user_id', userId).in('id', leadIds),
    adminClient.from(LEAD_TRACEABILITY_VIEW).select('lead_id,campaign_name,source').eq('lead_user_id', userId).in('lead_id', leadIds)
  ]);

  for (const t of (traceRows.data ?? [])) {
    if (t.campaign_name) leadCampaignMap.set(t.lead_id, t.campaign_name);
  }
  for (const l of (leadRows.data ?? [])) {
    if (!leadCampaignMap.has(l.id) && l.source) leadCampaignMap.set(l.id, l.source);
  }
  return leadCampaignMap;
}

async function resolveMetaCampaignAttribution(adminClient: any, userId: string, clinicId: string, docIds: string[]) {
  const patientMap: Map<string, any> = new Map();
  if (docIds.length === 0) return patientMap;

  const { data: dpRows } = await adminClient.from('doctoralia_patients')
    .select('doc_patient_id,lead_id,match_class,match_confidence')
    .eq('clinic_id', clinicId)
    .in('doc_patient_id', docIds);

  if (dpRows && dpRows.length > 0) {
    const leadIds = [...new Set((dpRows as any[]).map((d: any) => d.lead_id).filter(Boolean))];
    const leadCampaignMap = await fetchLeadCampaignMap(adminClient, userId, leadIds);

    for (const dp of (dpRows as any[])) {
      patientMap.set(dp.doc_patient_id, {
        lead_id: dp.lead_id,
        match_class: dp.match_class,
        match_confidence: dp.match_confidence,
        campaign_name: dp.lead_id ? (leadCampaignMap.get(dp.lead_id) ?? null) : null,
      });
    }
  }
  return patientMap;
}

async function handleAgendaDoctoraliaGet(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, url, sendJson } = ctx;
  if (resource === 'agenda' && sub === 'doctoralia') {
    const clinicId = await resolveClinicId(adminClient, userId);
    if (!clinicId) return sendJson({ success: false, message: 'Clinic not configured for this user.' }, 400);

    const date = url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10);

    // Fetch appointments from doctoralia_raw for the given date, joined with
    // doctoralia_patients to get the Meta campaign attribution.
    const { data: rows, error } = await adminClient.from('doctoralia_raw')
      .select(
        'raw_hash,paciente_id,paciente_nombre,patient_name,hora,hora_inicio,estado,' +
        'asunto,procedimiento_nombre,treatment,agenda,sala_box,procedencia,' +
        'importe_numerico,importe_clean,importe,confirmada,timestamp_cita,appointment_start,' +
        'doc_patient_id'
      )
      .eq('clinic_id', clinicId)
      .eq('fecha', date)
      .order('hora', { ascending: true });

    if (error) throw error;

    if (!rows || rows.length === 0) {
      return sendJson({ success: true, appointments: [], total: 0 });
    }

    // Collect doc_patient_ids to resolve Meta campaign attribution
    const docIds = [...new Set((rows as any[]).map((r: any) => r.doc_patient_id).filter(Boolean))];
    const patientMap = await resolveMetaCampaignAttribution(adminClient, userId, clinicId, docIds);

    const appointments = (rows as any[]).map((r: any) => {
      const attr = r.doc_patient_id ? patientMap.get(r.doc_patient_id) : null;
      return {
        raw_hash: r.raw_hash,
        paciente_nombre: r.paciente_nombre ?? r.patient_name ?? null,
        hora: r.hora_inicio ?? r.hora ?? null,
        estado: r.estado ?? null,
        asunto: r.procedimiento_nombre ?? r.treatment ?? r.asunto ?? null,
        agenda: r.agenda ?? null,
        sala_box: r.sala_box ?? null,
        procedencia: r.procedencia ?? null,
        importe: r.importe_numerico ?? r.importe_clean ?? Number(r.importe ?? 0),
        confirmada: r.confirmada ?? false,
        timestamp_cita: r.timestamp_cita ?? r.appointment_start ?? null,
        doc_patient_id: r.doc_patient_id ?? null,
        // Meta campaign attribution
        lead_id: attr?.lead_id ?? null,
        campaign_name: attr?.campaign_name ?? null,
        match_class: attr?.match_class ?? null,
        match_confidence: attr?.match_confidence ?? null,
      };
    });

    return sendJson({ success: true, appointments, total: appointments.length, date });
  }
  return null;
}

const TRACEABILITY_MATCH_FIELDS = ['patient_id', 'doc_patient_id', 'doctoralia_template_name'] as const;
const TRACEABILITY_MATCH_OR = TRACEABILITY_MATCH_FIELDS.map((field) => `${field}.not.is.null`).join(',');

function isTraceabilityMatched(row: any) {
  return TRACEABILITY_MATCH_FIELDS.some((field) => Boolean(row?.[field]));
}

function isTraceabilityClosed(row: any) {
  return Number(row?.doctoralia_net ?? 0) > 0;
}

function buildTraceabilitySummary(rows: any[]): any {
  return rows.reduce((summary: any, row: any) => {
    const revenue = Number(row.doctoralia_net ?? 0);
    summary.totalLeads += 1;
    if (isTraceabilityMatched(row)) summary.matchedTotal += 1;
    if (revenue > 0) {
      summary.verifiedSales += 1;
      summary.totalRevenue += revenue;
    }
    return summary;
  }, { totalLeads: 0, matchedTotal: 0, verifiedSales: 0, totalRevenue: 0 });
}

function buildTraceabilityCampaigns(rows: any[]): any[] {
  const campaigns = new Map<string, any>();
  for (const row of rows) {
    const campaignName = row.campaign_name || row.source || 'Sin campaña';
    const source = row.source || 'unknown';
    const key = `${source}::${campaignName}`;
    const current = campaigns.get(key) ?? {
      campaign_name: campaignName,
      source,
      total_leads: 0,
      booked: 0,
      closed: 0,
      lead_to_close_rate_pct: 0,
      verified_revenue_crm: 0,
      first_lead_at: row.lead_created_at ?? null,
      last_lead_at: row.lead_created_at ?? null,
    };

    current.total_leads += 1;
    if (isTraceabilityMatched(row)) current.booked += 1;
    if (isTraceabilityClosed(row)) current.closed += 1;
    current.verified_revenue_crm += Number(row.doctoralia_net ?? 0);
    if (row.lead_created_at && (!current.first_lead_at || row.lead_created_at < current.first_lead_at)) current.first_lead_at = row.lead_created_at;
    if (row.lead_created_at && (!current.last_lead_at || row.lead_created_at > current.last_lead_at)) current.last_lead_at = row.lead_created_at;
    campaigns.set(key, current);
  }

  return Array.from(campaigns.values())
    .map((campaign: any) => ({
      ...campaign,
      lead_to_close_rate_pct: campaign.total_leads > 0
        ? Number.parseFloat(((campaign.closed / campaign.total_leads) * 100).toFixed(1))
        : 0,
      verified_revenue_crm: Number.parseFloat(campaign.verified_revenue_crm.toFixed(2)),
    }))
    .sort((a: any, b: any) => b.total_leads - a.total_leads);
}

function applyTraceabilityFilters(query: any, userId: string, url: URL, options: { includeMatchedOnly?: boolean } = {}) {
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  const source = url.searchParams.get('source') ?? '';
  const campaignName = url.searchParams.get('campaign_name') ?? '';
  const matchedOnly = options.includeMatchedOnly && url.searchParams.get('matched') === 'true';

  let filtered = query.eq('lead_user_id', userId);
  if (from) filtered = filtered.gte('lead_created_at', from);
  if (to) filtered = filtered.lte('lead_created_at', `${to}T23:59:59Z`);
  if (source) filtered = filtered.eq('source', source);
  if (campaignName) filtered = filtered.ilike('campaign_name', `%${campaignName}%`);
  if (matchedOnly) filtered = filtered.or(TRACEABILITY_MATCH_OR);
  return filtered;
}

async function fetchTraceabilityRowsForAggregation(adminClient: any, userId: string, url: URL): Promise<any[]> {
  const pageSize = 1000;
  const rows: any[] = [];

  for (let fromIdx = 0; ; fromIdx += pageSize) {
    const toIdx = fromIdx + pageSize - 1;
    const query = applyTraceabilityFilters(
      adminClient
        .from(LEAD_TRACEABILITY_VIEW)
        .select('lead_id,source,campaign_name,lead_created_at,patient_id,doc_patient_id,doctoralia_template_name,doctoralia_net')
        .order('lead_created_at', { ascending: false }),
      userId,
      url,
      { includeMatchedOnly: true },
    ).range(fromIdx, toIdx);

    const { data, error } = await query;
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows;
}

type TraceabilityFunnelRpcRow = {
  lead_id: string;
  lead_name: string | null;
  lead_created_at: string | null;
  cita_valoracion: string | null;
  cita_posterior: string | null;
  fuente: string | null;
  estado: string | null;
  revenue: string | number | null;
  conversion_date: string | null;
};

type TraceabilityFunnelRow = Omit<TraceabilityFunnelRpcRow, 'revenue'> & {
  revenue: number;
};

function normalizeTraceabilityFunnelRow(row: TraceabilityFunnelRpcRow): TraceabilityFunnelRow {
  return {
    ...row,
    revenue: Number(row.revenue ?? 0),
  };
}

async function handleTraceabilityLeads(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, url, sendJson } = ctx;
  if (resource === 'traceability' && sub === 'leads') {
    const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') ?? '250'), 1), 500);
    const dataQ = applyTraceabilityFilters(
      adminClient
        .from(LEAD_TRACEABILITY_VIEW)
        .select(
          'lead_id,lead_name,source,campaign_name,lead_created_at,' +
          'phone_normalized,' +
          'patient_id,patient_name,patient_dni,patient_phone,patient_last_visit,patient_ltv,' +
          'doc_patient_id,match_confidence,match_class,' +
          'settlement_date,first_settlement_at,doctoralia_net,doctoralia_template_name'
        )
        .order('lead_created_at', { ascending: false })
        .limit(limit),
      userId,
      url,
      { includeMatchedOnly: true },
    );

    // COUNT queries run in parallel — real totals independent of row limit
    const countQ = applyTraceabilityFilters(
      adminClient
        .from(LEAD_TRACEABILITY_VIEW)
        .select('lead_id', { count: 'exact', head: true }),
      userId,
      url,
      { includeMatchedOnly: true },
    );
    const matchedCountQ = applyTraceabilityFilters(
      adminClient
        .from(LEAD_TRACEABILITY_VIEW)
        .select('lead_id', { count: 'exact', head: true })
        .or(TRACEABILITY_MATCH_OR),
      userId,
      url,
      { includeMatchedOnly: false },
    );

    const [{ data: rows, error }, { count }, { count: matchedCount }, summaryRows] = await Promise.all([
      dataQ,
      countQ,
      matchedCountQ,
      fetchTraceabilityRowsForAggregation(adminClient, userId, url),
    ]);
    if (error) throw error;

    let funnelRows: TraceabilityFunnelRow[] = [];
    let hasFunnelRevenue = false;
    try {
      const funnelResult = await adminClient.rpc('get_trazabilidad_funnel', buildTraceabilityFunnelRpcArgs(userId, url));
      if (funnelResult.error) {
        console.error('get_trazabilidad_funnel enrichment error:', funnelResult.error);
      } else {
        funnelRows = ((funnelResult.data || []) as TraceabilityFunnelRpcRow[]).map(normalizeTraceabilityFunnelRow);
        hasFunnelRevenue = true;
      }
    } catch (funnelError) {
      console.error('get_trazabilidad_funnel enrichment exception:', funnelError);
    }

    const appointmentByLead = new Map(funnelRows.map((row) => [row.lead_id, row]));
    const leads = (rows || []).map((row: { lead_id: string; doctoralia_net?: number | string | null; settlement_date?: string | null }) => {
      const appointment = appointmentByLead.get(row.lead_id);
      const revenue = Number(appointment?.revenue ?? 0);
      return {
        ...row,
        cita_valoracion: appointment?.cita_valoracion ?? null,
        cita_posterior: appointment?.cita_posterior ?? null,
        appointment_date: appointment?.cita_valoracion ?? null,
        doctoralia_net: revenue > 0 ? revenue : row.doctoralia_net,
        settlement_date: appointment?.conversion_date ?? row.settlement_date ?? null,
      };
    });

    const summary = buildTraceabilitySummary(summaryRows);
    const funnelRevenue = funnelRows.reduce((sum, row) => sum + Number(row.revenue || 0), 0);
    const funnelVerifiedSales = funnelRows.filter((row) => Number(row.revenue || 0) > 0).length;

    return sendJson({
      success: true,
      leads,
      total: count ?? summary.totalLeads,
      matchedTotal: matchedCount ?? summary.matchedTotal,
      summary: {
        ...summary,
        verifiedSales: hasFunnelRevenue ? funnelVerifiedSales : summary.verifiedSales,
        totalRevenue: Number.parseFloat((hasFunnelRevenue ? funnelRevenue : summary.totalRevenue).toFixed(2)),
      },
    });
  }
  return null;
}

function getNullableDateParam(url: URL, name: string): string | null {
  const value = url.searchParams.get(name)?.trim() ?? '';
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function buildTraceabilityFunnelRpcArgs(userId: string, url: URL) {
  return {
    p_user_id: userId,
    p_lead_from: getNullableDateParam(url, 'lead_from') ?? getNullableDateParam(url, 'from'),
    p_lead_to: getNullableDateParam(url, 'lead_to') ?? getNullableDateParam(url, 'to'),
    p_valoracion_from: getNullableDateParam(url, 'valoracion_from'),
    p_valoracion_to: getNullableDateParam(url, 'valoracion_to'),
    p_posterior_from: getNullableDateParam(url, 'posterior_from'),
    p_posterior_to: getNullableDateParam(url, 'posterior_to'),
  };
}

async function handleTrazabilidadFunnel(ctx: AuthenticatedRouteContext): Promise<Response> {
  const { adminClient, userId, url, sendJson } = ctx;

  const params = {
    p_user_id: userId,
    p_lead_from: url.searchParams.get('lead_from'),
    p_lead_to: url.searchParams.get('lead_to'),
    p_valoracion_from: url.searchParams.get('valoracion_from'),
    p_valoracion_to: url.searchParams.get('valoracion_to'),
    p_posterior_from: url.searchParams.get('posterior_from'),
    p_posterior_to: url.searchParams.get('posterior_to')
  };

  const { data, error } = await adminClient.rpc('get_trazabilidad_funnel', params);

  if (error) {
    console.error('Error en get_trazabilidad_funnel:', error);
    return sendJson({ success: false, error: error.message }, 500);
  }

  return sendJson({
    success: true,
    total: (data ?? []).length,
    records: data ?? []
  });
}

async function handleTraceabilityCampaigns(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, url, sendJson } = ctx;
  if (resource === 'traceability' && sub === 'campaigns') {
    const rows = await fetchTraceabilityRowsForAggregation(adminClient, userId, url);
    return sendJson({
      success: true,
      campaigns: buildTraceabilityCampaigns(rows),
      summary: buildTraceabilitySummary(rows),
    });
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
    const { data: rows } = await adminClient.from('figma_sync_log')
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

async function matchPatientByPhone(adminClient: any, clinicId: string, normalizedPhone: string) {
  if (!normalizedPhone) return null;
  const { data: patient } = await adminClient.from('patients')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('phone_normalized', normalizedPhone)
    .maybeSingle();
  return patient?.id ?? null;
}

async function matchLeadByPhone(adminClient: any, userId: string, normalizedPhone: string) {
  if (!normalizedPhone) return null;
  const { data: lead } = await adminClient.from('leads')
    .select('id, stage, phone_normalized')
    .eq('user_id', userId)
    .eq('phone_normalized', normalizedPhone)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return lead ?? null;
}

async function matchLeadByEmail(adminClient: any, userId: string, email: string) {
  if (!email) return null;
  const normalizedEmail = String(email).trim();
  const { data: lead } = await adminClient.from('leads')
    .select('id, stage, email')
    .eq('user_id', userId)
    .ilike('email', normalizedEmail)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return lead ?? null;
}

async function findWhatsappConversionLead(adminClient: any, userId: string, phone: string, email: string) {
  const normalizedPhone = normalizePhoneForMeta(phone);
  let matchedLead = normalizedPhone
    ? await matchLeadByPhone(adminClient, userId, normalizedPhone)
    : null;
  let leadMatchMethod: string | null = null;

  if (!matchedLead && email) {
    matchedLead = await matchLeadByEmail(adminClient, userId, email);
    leadMatchMethod = matchedLead ? 'email' : null;
  } else if (matchedLead) {
    leadMatchMethod = 'phone';
  }

  return { matchedLead, leadMatchMethod };
}

async function updateLeadStageToWhatsapp(adminClient: any, userId: string, matchedLead: any): Promise<boolean> {
  if (!matchedLead?.id) return false;
  const currentStage = String(matchedLead.stage ?? 'lead').toLowerCase();
  if (currentStage !== 'lead') return false;

  const { error } = await adminClient.from('leads')
    .update({ stage: 'whatsapp', first_inbound_at: new Date().toISOString() })
    .eq('id', matchedLead.id)
    .eq('user_id', userId);

  return !error;
}

async function handleWhatsappConversionPost(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, url, sendJson } = ctx;
  if (resource === 'whatsapp' && sub === 'conversion' && req.method === 'POST') {
    return await processWhatsappConversionPost(adminClient, userId, req, url, sendJson);
  }
  return null;
}

async function processWhatsappConversionPost(adminClient: any, userId: string, req: Request, url: URL, sendJson: any): Promise<Response> {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return sendJson({ success: false, message: 'Invalid JSON body' }, 400);
  }

  const phone = String(body.phone ?? '').trim();
  const email = body.email ? String(body.email).trim() : '';
  if (!phone && !email) {
    return sendJson({ success: false, message: 'phone or email is required' }, 400);
  }

  const creds = await resolveMetaCreds(adminClient, userId, url.searchParams.get('adAccountId') ?? '');
  const validation = validateMetaCredentialResult(creds);
  if (!validation.ok) {
    return sendJson({ success: false, message: validation.message }, validation.statusCode);
  }

  try {
    const result = await trackMetaWhatsappConversion(creds.accessToken, phone || null, email || null);
    const { data: usr } = await adminClient.from('users').select('clinic_id').eq('id', userId).single();
    const clinicId = usr?.clinic_id;
    let matchedPatientId: string | null = null;
    let matchedLeadId: string | null = null;
    let leadStageUpdated = false;

    if (clinicId && phone) {
      const normalizedPhone = normalizePhoneForMeta(phone);
      matchedPatientId = normalizedPhone
        ? await matchPatientByPhone(adminClient, clinicId, normalizedPhone)
        : null;
    }

    const { matchedLead, leadMatchMethod } = await findWhatsappConversionLead(adminClient, userId, phone, email);
    if (matchedLead) {
      matchedLeadId = matchedLead.id;
      leadStageUpdated = await updateLeadStageToWhatsapp(adminClient, userId, matchedLead);
    }

    return sendJson({
      success: true,
      result,
      matchedPatientId,
      matchedLeadId,
      leadMatchMethod,
      leadStageUpdated,
      phone: phone || null,
      email: email || null,
    });
  } catch (e: any) {
    return sendJson({ success: false, message: e?.message ?? 'Meta pixel event failed' }, 502);
  }
}

function getKpiDateRange(url: URL) {
  const days = Math.min(Math.max(Number.parseInt(url.searchParams.get('days') ?? '30', 10) || 30, 1), 90);
  const fromParam = url.searchParams.get('from') ?? '';
  const toParam = url.searchParams.get('to') ?? '';
  const since = fromParam || new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const until = toParam || new Date().toISOString().slice(0, 10);
  return { since, until, days, period: { since, until, range: `${days}d` } };
}

function processLeadsByStage(leads: any[]) {
  const byStage: Record<string, number> = { lead: 0, whatsapp: 0, appointment: 0, treatment: 0, closed: 0 };
  for (const row of leads) {
    const s = (row.stage ?? 'lead').toLowerCase();
    if (s in byStage) byStage[s]++;
    else byStage['lead']++;
  }
  return byStage;
}

function identifyUniquePatients(settlements: any[]) {
  const patientFirstSettlement: Record<string, string> = {};
  const firstSettlementRows: Record<string, any[]> = {};
  for (const row of settlements) {
    const patientId = String(row.patient_id ?? row.phone_normalized ?? row.dni_hash ?? '').trim();
    if (!patientId) continue;
    const settledAt = String(row.settled_at);
    if (!patientFirstSettlement[patientId] || new Date(settledAt) < new Date(patientFirstSettlement[patientId])) {
      patientFirstSettlement[patientId] = settledAt;
      firstSettlementRows[patientId] = [row];
    } else if (new Date(settledAt).getTime() === new Date(patientFirstSettlement[patientId]).getTime()) {
      firstSettlementRows[patientId].push(row);
    }
  }
  return { patientFirstSettlement, firstSettlementRows };
}

export function calculateVerifiedRevenueInRange(patientFirstSettlement: Record<string, string>, settlements: any[], since: string, until: string) {
  const windowStart = new Date(`${since}T00:00:00Z`);
  const windowEnd = new Date(`${until}T23:59:59Z`);
  const verifiedPatientIds = new Set<string>();

  const settlementsInRange = settlements.filter((row: any) => {
    const settledAt = row.settled_at ? new Date(row.settled_at) : null;
    return settledAt !== null
      && settledAt >= windowStart
      && settledAt <= windowEnd
      && !row.cancelled_at
      && Number(row.amount_net ?? 0) > 0
      && String(row.source_system ?? '').toLowerCase() === 'doctoralia';
  });

  const verifiedRevenue = settlementsInRange.reduce((sum: number, row: any) => sum + Number(row.amount_net ?? 0), 0);

  for (const patientId of Object.keys(patientFirstSettlement)) {
    const firstDate = new Date(patientFirstSettlement[patientId]);
    if (firstDate >= windowStart && firstDate <= windowEnd) {
      verifiedPatientIds.add(patientId);
    }
  }

  const settlementsAttributed = settlementsInRange.filter((row: any) => String(row.patient_id ?? row.dni_hash ?? '').trim()).length;
  const settlementsUnattributed = settlementsInRange.length - settlementsAttributed;
  const attributionStatus = settlementsInRange.length === 0
    ? 'none'
    : settlementsAttributed === 0
      ? 'low_attribution'
      : settlementsUnattributed > 0
        ? 'partial'
        : 'complete';

  return {
    verifiedPatientIds,
    verifiedRevenue,
    settlementsInRange,
    settlementsAttributed,
    settlementsUnattributed,
    attributionStatus,
  };
}

async function fetchMetaKpis(adminClient: any, userId: string, url: URL, since: string, until: string, hasCachedMeta: boolean, cachedMetrics: any) {
  return await loadMetaKpis(adminClient, userId, url, since, until, hasCachedMeta, cachedMetrics);
}

function calculateMetaRates(metrics: any) {
  metrics.ctr = metrics.impressions > 0 ? Number.parseFloat(((metrics.clicks / metrics.impressions) * 100).toFixed(2)) : 0;
  metrics.cpc = metrics.clicks > 0 ? Number.parseFloat((metrics.spend / metrics.clicks).toFixed(2)) : 0;
}

function applyCachedMetaMetrics(metaResult: any, cachedMetrics: any) {
  metaResult.spend = Number.parseFloat((cachedMetrics.spend ?? 0).toFixed(2));
  metaResult.leads = Math.max(cachedMetrics.conversions ?? 0, metaResult.leads);
  metaResult.impressions = cachedMetrics.impressions ?? 0;
  metaResult.clicks = cachedMetrics.clicks ?? 0;
  calculateMetaRates(metaResult);
  metaResult.data_source = 'meta_daily_insights';
}

function sumCachedRowsForAccount(cachedRows: any[], accountId: string) {
  const rows = cachedRows.filter((r: any) => r.ad_account_id === accountId);
  return {
    spend: rows.reduce((s: number, r: any) => s + Number(r.spend ?? 0), 0),
    conversions: rows.reduce((s: number, r: any) => s + Number(r.conversions ?? 0), 0),
    impressions: rows.reduce((s: number, r: any) => s + Number(r.impressions ?? 0), 0),
    clicks: rows.reduce((s: number, r: any) => s + Number(r.clicks ?? 0), 0),
    rows: rows.length,
  };
}

function sumLiveAccountRows(account: any) {
  const rows: any[] = Array.isArray(account?.data) ? account.data : [];
  return {
    spend: rows.reduce((s: number, row: any) => s + parseMetaMetric(row.spend), 0),
    conversions: rows.reduce((s: number, row: any) => s + parseMetaMetric(row.conversions), 0),
    impressions: rows.reduce((s: number, row: any) => s + parseMetaMetric(row.impressions), 0),
    clicks: rows.reduce((s: number, row: any) => s + parseMetaMetric(row.clicks), 0),
  };
}

async function loadMetaKpis(adminClient: any, userId: string, url: URL, since: string, until: string, hasCachedMeta: boolean, cachedMetrics: any) {
  const cachedRows: any[] = Array.isArray(cachedMetrics?.rows) ? cachedMetrics.rows : [];
  const metaResult = {
    spend: 0, leads: 0, impressions: 0, clicks: 0, ctr: 0, cpc: 0,
    live: false, message: '', data_source: 'none',
    per_account: [] as any[],
  } as any;
  try {
    const creds = await resolveMetaCreds(adminClient, userId, url.searchParams.get('adAccountId') ?? '');
    const validation = validateMetaCredentialResult(creds);
    metaResult.accountIds = creds.adAccountIds;
    metaResult.accountId = creds.adAccountId;

    if (!validation.ok) {
      metaResult.message = validation.message;
      if (hasCachedMeta) applyCachedMetaMetrics(metaResult, cachedMetrics);
      return metaResult;
    }

    const accountResults = await Promise.allSettled(creds.adAccountIds.map(async (accountId: string) => {
      const live = await metaFetch(`/${accountId}/insights`, {
        fields: 'date_start,spend,impressions,clicks,ctr,cpc,conversions',
        time_range: JSON.stringify({ since, until }),
        time_increment: '1',
        limit: '1000',
      }, creds.accessToken);
      return { accountId, live };
    }));

    let liveCount = 0;
    let cacheCount = 0;
    const failureMessages: string[] = [];

    creds.adAccountIds.forEach((accountId: string, idx: number) => {
      const settled = accountResults[idx];
      let source: 'meta_api' | 'meta_daily_insights' | 'none' = 'none';
      let totals = { spend: 0, conversions: 0, impressions: 0, clicks: 0 };

      if (settled.status === 'fulfilled') {
        totals = sumLiveAccountRows(settled.value?.live);
        source = 'meta_api';
        liveCount += 1;
      } else {
        const { reason } = settled;
        const reasonMsg = reason?.message ?? String(reason ?? 'unknown error');
        failureMessages.push(`${accountId}: ${reasonMsg}`);
        const cachedTotals = sumCachedRowsForAccount(cachedRows, accountId);
        if (cachedTotals.rows > 0) {
          totals = {
            spend: cachedTotals.spend,
            conversions: cachedTotals.conversions,
            impressions: cachedTotals.impressions,
            clicks: cachedTotals.clicks,
          };
          source = 'meta_daily_insights';
          cacheCount += 1;
        }
      }

      metaResult.spend += totals.spend;
      metaResult.leads += totals.conversions;
      metaResult.impressions += totals.impressions;
      metaResult.clicks += totals.clicks;
      metaResult.per_account.push({
        accountId,
        spend: Number.parseFloat(totals.spend.toFixed(2)),
        leads: totals.conversions,
        data_source: source,
      });
    });

    metaResult.spend = Number.parseFloat(metaResult.spend.toFixed(2));
    calculateMetaRates(metaResult);
    metaResult.live = liveCount > 0;
    if (liveCount > 0 && cacheCount === 0) {
      metaResult.data_source = 'meta_api';
    } else if (liveCount > 0 && cacheCount > 0) {
      metaResult.data_source = 'meta_api+meta_daily_insights';
    } else if (cacheCount > 0) {
      metaResult.data_source = 'meta_daily_insights';
    } else {
      metaResult.data_source = 'meta_api_failed';
    }
    if (failureMessages.length > 0) {
      metaResult.message = `Meta live partial: ${failureMessages.join('; ')}`;
    }
  } catch (e: any) {
    metaResult.message = e?.message ?? 'Meta API error';
    if (hasCachedMeta) applyCachedMetaMetrics(metaResult, cachedMetrics);
  }
  return metaResult;
}

function determineKpiDataQuality(metaResult: any, crmLeads: number, settlementsCount: number, newVerifiedPatients: number) {
  const metaSpendReal = metaResult.live || metaResult.data_source === 'meta_daily_insights';
  const leadsReal = crmLeads > 0;
  const doctoraliaSettlementsReal = settlementsCount > 0;
  const doctoraliaMatchingReal = newVerifiedPatients > 0;

  let overallMode = 'full_demo';
  if (metaSpendReal && leadsReal && doctoraliaSettlementsReal) {
    overallMode = 'full_real';
  } else if (metaSpendReal || leadsReal || doctoraliaSettlementsReal) {
    overallMode = 'partial_demo';
  }

  let cacConfidence = 'low';
  if (doctoraliaMatchingReal) {
    cacConfidence = metaSpendReal ? 'high' : 'medium';
  }

  return {
    metaSpendReal,
    leadsReal,
    doctoraliaSettlementsReal,
    doctoraliaMatchingReal,
    overallMode,
    cacConfidence,
  };
}

async function handleKpisGet(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, url, sendJson } = ctx;
  if (resource === 'kpis' && sub === '' && req.method === 'GET') {
    return await processKpisGet(adminClient, userId, url, sendJson);
  }
  return null;
}

async function processKpisGet(adminClient: any, userId: string, url: URL, sendJson: any): Promise<Response> {
  const { since, until, period } = getKpiDateRange(url);

  const { data: usr } = await adminClient.from('users').select('clinic_id').eq('id', userId).single();
  const clinicId = usr?.clinic_id;
  if (!clinicId) return sendJson({ success: false, message: 'No clinic configured' }, 400);

  // Reconciliar leads antes de calcular KPIs
  await runLeadPipelineReconciliation(adminClient, userId);

  const metaSources = ['meta_leadgen', 'meta_lead_gen', 'facebook_leadgen'];

  const [leadCountRes, leadMetaCountRes, leadsByStageRes, settlementsRes, metaDailyInsightsRes] = await Promise.all([
    adminClient.from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .neq('source', 'doctoralia')
      .gte('created_at', since)
      .lte('created_at', until),

    adminClient.from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .in('source', metaSources)
      .gte('created_at', since)
      .lte('created_at', until),

    adminClient.from('leads')
      .select('stage')
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .neq('source', 'doctoralia')
      .gte('created_at', since)
      .lte('created_at', until),

    adminClient.from('financial_settlements')
      .select('id, patient_id, amount_net, settled_at, cancelled_at')
      .eq('clinic_id', clinicId)
      .eq('source_system', 'doctoralia')
      .is('cancelled_at', null)
      .gt('amount_net', 0)
      .gte('settled_at', since)
      .lte('settled_at', until),

    adminClient.from('meta_daily_insights')
      .select('spend, impressions, clicks, conversions')
      .eq('clinic_id', clinicId)
      .gte('date', since)
      .lte('date', until),
  ]);

  const crmLeads = leadCountRes.count ?? 0;
  const metaLeads = leadMetaCountRes.count ?? 0;
  const byStage = processLeadsByStage(leadsByStageRes.data ?? []);
  const settlements = (settlementsRes.data ?? []).filter((r: any) => Number(r.amount_net) > 0);
  const metaInsights = metaDailyInsightsRes.data ?? [];

  // Revenue verificado real
  const verifiedRevenue = settlements.reduce((sum: number, r: any) => sum + Number(r.amount_net), 0);
  const newVerifiedPatients = new Set(settlements.map((r: any) => r.patient_id).filter(Boolean)).size;

  const metaSpend = metaInsights.reduce((sum: number, r: any) => sum + Number(r.spend ?? 0), 0);
  const metaCpl = metaLeads > 0 ? Number((metaSpend / metaLeads).toFixed(2)) : 0;

  const cacDoctoralia = newVerifiedPatients > 0 ? Number((metaSpend / newVerifiedPatients).toFixed(2)) : 0;

  return sendJson({
    success: true,
    period,
    meta: {
      spend: Number(metaSpend.toFixed(2)),
      leads: metaLeads,
      cpl: metaCpl,
      is_real: metaSpend > 0,
    },
    crm: {
      totalLeads: crmLeads,
      metaLeads,
      by_stage: byStage,
      is_real: crmLeads > 0,
    },
    doctoralia: {
      total_settlements: settlements.length,
      newVerifiedPatients,
      verifiedRevenue: Number(verifiedRevenue.toFixed(2)),
      avgTicket: newVerifiedPatients > 0 ? Number((verifiedRevenue / newVerifiedPatients).toFixed(2)) : 0,
      cacDoctoralia,
      is_real: newVerifiedPatients > 0,
    },
    data_quality: {
      leads_real: crmLeads > 0,
      meta_spend_real: metaSpend > 0,
      doctoralia_real: newVerifiedPatients > 0,
    }
  });
}

function aggregateDoctoraliaTemplates(templateRows: any[]) {
  const templateMap: Record<string, any> = {};
  for (const row of (templateRows || [])) {
    const key = row.template_id || row.template_name;
    if (!templateMap[key]) {
      templateMap[key] = {
        template_id: row.template_id,
        template_name: row.template_name,
        operations_count: 0,
        total_net: 0,
        total_gross: 0,
        total_discount: 0,
        cancellation_count: 0,
        source_system: row.source_system,
      };
    }
    templateMap[key].operations_count  += Number(row.operations_count  ?? 0);
    templateMap[key].total_net         += Number(row.total_net         ?? 0);
    templateMap[key].total_gross       += Number(row.total_gross       ?? 0);
    templateMap[key].total_discount    += Number(row.total_discount    ?? 0);
    templateMap[key].cancellation_count += Number(row.cancellation_count ?? 0);
  }

  const byTemplate = Object.values(templateMap).map((t: any) => ({
    ...t,
    total_net: Math.round(t.total_net * 100) / 100,
    total_gross: Math.round(t.total_gross * 100) / 100,
    avg_ticket: t.operations_count ? Math.round((t.total_net / t.operations_count) * 100) / 100 : 0,
    revenue_share_pct: 0,
    cancellation_rate_pct: t.operations_count
      ? Math.round((t.cancellation_count / t.operations_count) * 1000) / 10
      : 0,
  })).sort((a: any, b: any) => b.total_net - a.total_net);

  const totalNetAll = byTemplate.reduce((sum: number, row: any) => sum + Number(row.total_net ?? 0), 0);
  return byTemplate.map((t: any) => ({
    ...t,
    revenue_share_pct: totalNetAll ? Math.round((t.total_net / totalNetAll) * 1000) / 10 : 0,
  }));
}

function mapDoctoraliaMonthlyData(monthRows: any[]) {
  return (monthRows || []).map((m: any) => ({
    settled_month: m.settled_month,
    operations_count: m.operations_count,
    cancellation_count: m.cancellation_count,
    total_gross: Math.round(Number(m.total_gross ?? 0) * 100) / 100,
    total_discount: Math.round(Number(m.total_discount ?? 0) * 100) / 100,
    total_net: Math.round(Number(m.total_net ?? 0) * 100) / 100,
    avg_ticket_net: computeAvgTicketNet(m),
    discount_rate_pct: Number(m.discount_rate_pct ?? 0),
    cancellation_rate_pct: Number(m.cancellation_rate_pct ?? 0),
    avg_liquidation_lag_days: Number(m.avg_liquidation_lag_days ?? 0),
  })).sort((a: any, b: any) => a.settled_month.localeCompare(b.settled_month));
}

async function handleReportsDoctoraliaFinancialsGet(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, url, sendJson } = ctx;
  if (resource === 'reports' && sub === 'doctoralia-financials' && req.method === 'GET') {
    const { data: usr } = await adminClient.from('users').select('clinic_id').eq('id', userId).single();
    const clinicId = usr?.clinic_id;
    if (!clinicId) return sendJson({ success: false, message: 'No clinic' }, 400);

    // settled_month is 'YYYY-MM'; compare date params truncated to 7 chars
    const fromMonth = (url.searchParams.get('from') ?? '').slice(7);
    const toMonth   = (url.searchParams.get('to')   ?? '').slice(7);

    // vw_doctoralia_financials: rows are already aggregated per template × month by the DB view
    let templateQ = adminClient
      .from('vw_doctoralia_financials')
      .select('*')
      .eq('source_system', 'doctoralia')
      .order('settled_month', { ascending: true });
    if (fromMonth) templateQ = templateQ.gte('settled_month', fromMonth);
    if (toMonth)   templateQ = templateQ.lte('settled_month', toMonth);
    const { data: templateRows } = await templateQ;

    // vw_doctoralia_by_month: rows are already aggregated per month by the DB view
    let monthQ = adminClient
      .from('vw_doctoralia_by_month')
      .select('*')
      .order('settled_month', { ascending: true });
    if (fromMonth) monthQ = monthQ.gte('settled_month', fromMonth);
    if (toMonth)   monthQ = monthQ.lte('settled_month', toMonth);
    const { data: monthRows } = await monthQ;

    const byTemplate = aggregateDoctoraliaTemplates(templateRows || []);
    const byMonth = mapDoctoraliaMonthlyData(monthRows || []);

    return sendJson({ success: true, byTemplate, byMonth, templateSummary: byTemplate });
  }
  return null;
}

function computeAvgTicketNet(row: any): number {
  if (row.avg_ticket_net == null) {
    if (!row.operations_count) return 0;
    return Math.round((Number(row.total_net ?? 0) / row.operations_count) * 100) / 100;
  }
  return Math.round(Number(row.avg_ticket_net) * 100) / 100;
}

async function handleReportsCampaignPerformanceGet(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, url, sendJson } = ctx;
  if (resource === 'reports' && sub === 'campaign-performance' && req.method === 'GET') {
    const from   = url.searchParams.get('from')   ?? '';
    const to     = url.searchParams.get('to')     ?? '';
    const source = url.searchParams.get('source') ?? '';
    let query = adminClient
      .from('vw_campaign_performance_real')
      .select('*')
      .eq('user_id', userId)
      .order('total_leads', { ascending: false });
    if (from)   query = query.gte('first_lead_at', from);
    if (to)     query = query.lte('last_lead_at', to);
    if (source) query = query.eq('source', source);
    const { data: rows } = await query;
    return sendJson({ success: true, campaigns: rows || [] });
  }
  return null;
}

async function handleReportsSourceComparisonGet(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, url, sendJson } = ctx;
  if (resource === 'reports' && sub === 'source-comparison' && req.method === 'GET') {
    const from = url.searchParams.get('from') ?? '';
    const to   = url.searchParams.get('to')   ?? '';
    let query = adminClient
      .from('vw_source_comparison')
      .select('*')
      .eq('user_id', userId)
      .order('total_leads', { ascending: false });
    if (from) query = query.gte('first_lead_at', from);
    if (to)   query = query.lte('last_lead_at', to);
    const { data: rows } = await query;
    return sendJson({ success: true, sources: rows || [] });
  }
  return null;
}

async function handleReportsWhatsappConversionGet(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, sendJson } = ctx;
  if (resource === 'reports' && sub === 'whatsapp-conversion' && req.method === 'GET') {
    const { data: rows } = await adminClient.from('vw_whatsapp_conversion_real')
      .select('*')
      .eq('user_id', userId);
    return sendJson({ success: true, cohorts: rows || [] });
  }
  return null;
}

function buildLeadAuditQuery(
  adminClient: any,
  userId: string,
  limit: number,
  matchedOnly: boolean,
  dateRange: { from?: string; to?: string },
  campaignName: string,
  normalizedPhone: string | null,
) {
  let query = adminClient
    .from(LEAD_TRACEABILITY_VIEW)
    .select(
      'lead_id,lead_name,source,campaign_name,ad_name,form_name,lead_created_at,' +
      'phone_normalized,patient_id,patient_name,patient_dni,patient_phone,match_confidence,match_class,settlement_id,settlement_date,first_settlement_at,doctoralia_net,doctoralia_template_name,doc_patient_id'
    )
    .eq('lead_user_id', userId)
    .order('lead_created_at', { ascending: false })
    .limit(limit);

  if (matchedOnly) query = query.or('patient_id.not.is.null,doc_patient_id.not.is.null,settlement_id.not.is.null,doctoralia_template_name.not.is.null');
  if (dateRange?.from) query = query.gte('lead_created_at', dateRange.from);
  if (dateRange?.to) query = query.lte('lead_created_at', dateRange.to + 'T23:59:59Z');
  if (campaignName) query = query.ilike('campaign_name', `%${campaignName}%`);
  if (normalizedPhone) query = query.eq('phone_normalized', normalizedPhone);

  return query;
}

function normalizeLeadAuditRow(row: any) {
  const normalizedPatientPhone = normalizePhoneForMeta(row.patient_phone);
  const phoneCrossMatch = Boolean(
    row.phone_normalized && normalizedPatientPhone && row.phone_normalized === normalizedPatientPhone,
  );
  const doctoraliaMatched = Boolean(
    row.patient_id
    || row.doc_patient_id
    || row.settlement_id
    || row.doctoralia_template_name
    || phoneCrossMatch,
  );

  return {
    ...row,
    phoneCrossMatch,
    doctoraliaMatched,
  };
}

async function handleReportsLeadAuditGet(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, url, sendJson } = ctx;
  if (resource === 'reports' && sub === 'lead-audit' && req.method === 'GET') {
    const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') ?? '1000', 10), 1), 1000);
    const matchedOnly = url.searchParams.get('matched') === 'true';
    const from = url.searchParams.get('from') ?? '';
    const to = url.searchParams.get('to') ?? '';
    const campaignName = url.searchParams.get('campaign_name') ?? '';
    const phone = url.searchParams.get('phone') ?? '';
    const reconcile = url.searchParams.get('reconcile') === 'true';

    const normalizedPhone = phone ? normalizePhoneForMeta(phone) : null;
    if (phone && normalizedPhone === null) {
      const failureReason = getPhoneNormalizationFailureReason(phone);
      const message = failureReason === 'missing-default-country-code'
        ? 'Phone filter could not be normalized because DEFAULT_PHONE_COUNTRY_CODE is not configured. Use an international phone number or set DEFAULT_PHONE_COUNTRY_CODE.'
        : 'Phone filter could not be normalized because the phone number format is invalid. Provide a valid phone number.';
      return sendJson({ success: false, message }, 400);
    }

    try {
      if (reconcile) await runLeadPipelineReconciliation(adminClient, userId);

      const query = buildLeadAuditQuery(
        adminClient,
        userId,
        limit,
        matchedOnly,
        { from, to },
        campaignName,
        normalizedPhone,
      );

      const { data: rows, error } = await query;
      if (error) throw error;

      const audited = (rows || []).map(normalizeLeadAuditRow);

      return sendJson({ success: true, leads: audited, total: audited.length, reconciled: reconcile });
    } catch (err: any) {
      console.error('Lead Audit Error:', err);
      return sendJson({ success: false, message: err.message || 'Error fetching lead audit data' }, 500);
    }
  }
  return null;
}


async function handleReportsPhoneCoverageGet(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, sendJson } = ctx;
  if (resource === 'reports' && sub === 'phone-coverage' && req.method === 'GET') {
    const clinicId = await resolveClinicId(adminClient, userId);
    if (!clinicId) return sendJson({ success: false, message: 'Clinic not configured.' }, 400);

    const { data: coverage, error } = await adminClient.rpc('get_phone_normalization_coverage', {
      p_clinic_id: clinicId,
    });

    if (error) {
      console.error('get_phone_normalization_coverage error:', error);
      return sendJson({ success: false, code: 'PHONE_COVERAGE_QUERY_ERROR', message: 'Failed to load phone normalization coverage.' }, 500);
    }

    return sendJson({ success: true, coverage: coverage || [] });
  }
  return null;
}

async function handleReportsDoctorPerformanceGet(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, sendJson } = ctx;
  if (resource === 'reports' && sub === 'doctor-performance' && req.method === 'GET') {
    const clinicId = await resolveClinicId(adminClient, userId);
    if (!clinicId) return sendJson({ success: false, message: 'Clinic not configured.' }, 400);

    const { data: rows } = await adminClient.from('vw_doctor_performance_real')
      .select('*')
      .eq('clinic_id', clinicId)
      .order('total_appointments', { ascending: false });
    return sendJson({ success: true, doctors: rows || [] });
  }
  return null;
}

async function handleReportsCampaignRoiGet(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, userId, resource, sub, req, url, sendJson } = ctx;
  if (resource === 'reports' && sub === 'campaign-roi' && req.method === 'GET') {
    const from   = url.searchParams.get('from')   ?? '';
    const to     = url.searchParams.get('to')     ?? '';
    const source = url.searchParams.get('source') ?? '';
    const { data: rows, error } = await adminClient.rpc('get_campaign_roi', {
      p_user_id: userId,
      p_from:    from,
      p_to:      to,
      p_source:  source,
    });
    if (error) {
      console.error('get_campaign_roi error:', error);
      return sendJson({ success: false, code: 'ROI_QUERY_ERROR', message: 'Failed to load campaign ROI.' }, 500);
    }
    return sendJson({ success: true, rows: rows || [] });
  }
  return null;
}

async function handleLeadsReconcilePost(ctx: AuthenticatedRouteContext): Promise<Response | null> {
  const { adminClient, resource, sub, sub2, req, sendJson } = ctx;
  if (resource === 'leads' && sub2 === 'reconcile' && req.method === 'POST') {
    const leadId = sub;
    if (!leadId) return sendJson({ success: false, message: 'lead id required' }, 400);
    const { data, error } = await adminClient.rpc('reconcile_lead_to_patient', { p_lead_id: leadId });
    if (error) {
      console.error('reconcile_lead_to_patient error:', error);
      return sendJson({ success: false, code: 'RECONCILE_ERROR', message: 'Failed to reconcile lead.' }, 500);
    }
    return sendJson({ success: true, matched: data !== null, patient_id: data ?? null });
  }
  return null;
}


Deno.serve(async (req: Request) => {
  try {
    return await handleRequest(req);
  } catch (err: any) {
    console.error('Top-level error in Edge Function:', err);
    return new Response(
      JSON.stringify({ success: false, message: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
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

  if (!hasOwn(payload, 'success')) payload.success = Boolean(success);
  if (!hasOwn(payload, 'data')) {
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


