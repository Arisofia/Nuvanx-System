import { createClient } from 'jsr:@supabase/supabase-js@2';
import { ALLOWED_CORS_ORIGINS } from '../_shared/config.ts';

declare const Deno: any;

const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') || '').trim();
const ANON_KEY = (Deno.env.get('SUPABASE_ANON_KEY') || '').trim();
const SERVICE_ROLE = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
const ALLOWED_ORIGINS = ALLOWED_CORS_ORIGINS;

const PROVIDERS = new Set(['meta', 'google', 'agenda']);
const TTL_SECONDS: Record<string, number> = { meta: 300, google: 300, agenda: 120 };
const PROVIDER_TIMEOUT_MS = 15_000;
const GATEWAY_TIMEOUT_MS = 45_000;

type CacheState = {
  refresh?: boolean;
  reason?: string;
  lease_owner?: string | null;
  payload?: unknown;
  fetched_at?: string | null;
  last_success_at?: string | null;
  breaker_state?: string | null;
  breaker_open_until?: string | null;
  failure_count?: number | null;
  last_error?: string | null;
};

type DynamicSupabaseClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: any; error: any }>;
  from: (table: string) => any;
};

function originFor(req: Request): string | null {
  const raw = req.headers.get('origin');
  if (!raw) return null;
  try { return new URL(raw).origin; } catch { return ''; }
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = originFor(req);
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(req: Request, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function ageSeconds(lastSuccessAt: unknown): number | null {
  const ms = Date.parse(String(lastSuccessAt || ''));
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor((Date.now() - ms) / 1000));
}

function envelope(
  provider: string,
  status: 'live' | 'stale' | 'unavailable',
  data: unknown,
  cache: CacheState,
  source: 'provider' | 'cache',
  error: string | null = null,
) {
  return {
    success: status !== 'unavailable',
    provider,
    status,
    source,
    fetched_at: cache.fetched_at || null,
    last_success_at: cache.last_success_at || null,
    age_seconds: ageSeconds(cache.last_success_at),
    breaker_state: cache.breaker_state || 'closed',
    breaker_open_until: cache.breaker_open_until || null,
    failure_count: Number(cache.failure_count || 0),
    data: data ?? null,
    error,
  };
}

async function parseProviderResponse(response: Response): Promise<any> {
  const text = await response.text();
  let payload: any = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = { message: text.slice(0, 500) }; }
  }
  if (!response.ok || payload?.success === false) {
    const message = String(payload?.error || payload?.message || `Provider HTTP ${response.status}`).replace(/\s+/g, ' ').slice(0, 500);
    throw new Error(message);
  }
  return payload;
}

function latestIso(values: unknown[]): string | null {
  let latest: string | null = null;
  let latestMs = -1;
  for (const value of values) {
    const text = String(value || '').trim();
    const ms = Date.parse(text);
    if (text && Number.isFinite(ms) && ms > latestMs) {
      latest = text;
      latestMs = ms;
    }
  }
  return latest;
}

async function fetchGoogleProvider(
  userId: string,
  query: URLSearchParams,
  admin: DynamicSupabaseClient,
): Promise<unknown> {
  const { data: internalSecret, error: secretError } = await admin.rpc('nvx_get_runtime_secret', {
    p_name: 'REVOPS_INTERNAL_SECRET',
  });
  if (secretError || !internalSecret) throw new Error('Google Ads internal health credential unavailable');

  const { data: integrations, error: integrationError } = await admin
    .from('integrations')
    .select('id,metadata,created_at')
    .eq('service', 'google_ads')
    .eq('status', 'connected')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (integrationError) throw new Error('Google Ads integration lookup failed');
  if (!Array.isArray(integrations) || integrations.length === 0) {
    throw new Error('No connected Google Ads integrations found');
  }

  const accounts: Record<string, unknown>[] = [];
  const campaigns: Record<string, unknown>[] = [];
  let apiVersion: string | null = null;
  let dateRange: unknown = null;

  const healthRequests = integrations.map(async (integration) => {
    const integrationId = String(integration?.id || '').trim();
    if (!integrationId) throw new Error('Google Ads integration identity missing');
    const body: Record<string, string> = { integration_id: integrationId };
    if (query.get('from')) body.from = query.get('from')!;
    if (query.get('to')) body.to = query.get('to')!;

    const response = await fetch(`${SUPABASE_URL}/functions/v1/google-ads-health`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-nvx-internal-secret': String(internalSecret),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    const payload = await parseProviderResponse(response);
    if (payload?.provider !== 'google_ads') throw new Error('Google Ads health returned an invalid provider contract');
    if (payload?.integration_id !== integrationId) throw new Error('Google Ads health returned an integration identity mismatch');

    const customerId = String(payload?.customer?.id || integration?.metadata?.customerId || integration?.metadata?.customer_id || '').replace(/\D/g, '');
    const account = {
      integration_id: integrationId,
      customer: payload?.customer || null,
      canonical_conversion: payload?.canonical_conversion || null,
      verified_at: payload?.verified_at || null,
    };
    const campaignList = Array.isArray(payload?.campaigns) ? payload.campaigns.map((campaign: any) => ({
      ...campaign,
      integration_id: integrationId,
      customer_id: customerId || null,
    })) : [];

    return { payload, account, campaignList };
  });

  const results = await Promise.all(healthRequests);

  for (const { payload, account, campaignList } of results) {
    apiVersion = apiVersion || String(payload?.api_version || '') || null;
    dateRange = dateRange || payload?.date_range || null;
    accounts.push(account);
    campaigns.push(...campaignList);
  }

  return {
    success: true,
    provider: 'google_ads',
    api_version: apiVersion,
    verified_at: latestIso(accounts.map((account) => account.verified_at)),
    date_range: dateRange,
    customer: accounts.length === 1 ? accounts[0].customer : null,
    accounts,
    campaigns,
  };
}

async function fetchProvider(
  provider: string,
  userId: string,
  bearer: string,
  query: URLSearchParams,
  admin: DynamicSupabaseClient,
): Promise<unknown> {
  if (provider === 'meta') {
    const params = new URLSearchParams();
    if (query.get('from')) params.set('from', query.get('from')!);
    if (query.get('to')) params.set('to', query.get('to')!);
    const response = await fetch(`${SUPABASE_URL}/functions/v1/api/meta/insights?${params.toString()}`, {
      headers: { Authorization: bearer, Accept: 'application/json' },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    return await parseProviderResponse(response);
  }

  if (provider === 'agenda') {
    const date = query.get('date') || new Date().toISOString().slice(0, 10);
    const response = await fetch(`${SUPABASE_URL}/functions/v1/api/agenda/doctoralia?date=${encodeURIComponent(date)}`, {
      headers: { Authorization: bearer, Accept: 'application/json' },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    return await parseProviderResponse(response);
  }

  return await fetchGoogleProvider(userId, query, admin);
}

Deno.serve(async (req: Request) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);
  req.signal.addEventListener('abort', () => clearTimeout(timeoutId));
  
  try {
    const origin = originFor(req);
    if (origin === '' || (origin && !ALLOWED_ORIGINS.has(origin))) {
      return json(req, 403, { success: false, error: 'Origin not allowed' });
    }
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) });
    if (req.method !== 'GET') return json(req, 405, { success: false, error: 'Method not allowed' });
    if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE) {
      return json(req, 500, { success: false, error: 'Server configuration unavailable' });
    }

    const bearer = String(req.headers.get('authorization') || '').trim();
    const token = bearer.toLowerCase().startsWith('bearer ') ? bearer.slice(7).trim() : '';
    if (!token) return json(req, 401, { success: false, error: 'Authentication required' });

    const authClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const { data: userData, error: userError } = await authClient.auth.getUser(token);
    const userId = userData?.user?.id;
    if (userError || !userId) return json(req, 401, { success: false, error: 'Invalid session' });

    const url = new URL(req.url);
    const provider = String(url.searchParams.get('provider') || '').trim().toLowerCase();
    if (!PROVIDERS.has(provider)) return json(req, 422, { success: false, error: 'Invalid provider' });

    const cacheKey = provider === 'agenda'
      ? `date:${url.searchParams.get('date') || new Date().toISOString().slice(0, 10)}`
      : `range:${url.searchParams.get('from') || ''}:${url.searchParams.get('to') || ''}`;
    const ttl = TTL_SECONDS[provider] || 300;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } }) as unknown as DynamicSupabaseClient;

    const { data: beginData, error: beginError } = await admin.rpc('nvx_control_centre_provider_begin_refresh', {
      p_user_id: userId,
      p_provider: provider,
      p_cache_key: cacheKey,
      p_ttl_seconds: ttl,
      p_lease_seconds: 45,
    });
    if (beginError || !beginData) {
      return json(req, 500, { success: false, provider, status: 'unavailable', error: 'Provider cache unavailable' });
    }
    const state = beginData as CacheState;

    if (!state.refresh) {
      const hasCache = state.payload !== null && state.payload !== undefined;
      const status = state.reason === 'fresh_cache' ? 'live' : hasCache ? 'stale' : 'unavailable';
      return json(req, 200, envelope(
        provider,
        status,
        state.payload,
        state,
        'cache',
        status === 'live' ? null : String(state.last_error || state.reason || 'Provider refresh unavailable'),
      ));
    }

    const leaseOwner = String(state.lease_owner || '');
    if (!leaseOwner) return json(req, 500, { success: false, provider, status: 'unavailable', error: 'Provider refresh lease unavailable' });

    try {
      const payload = await fetchProvider(provider, userId, bearer, url.searchParams, admin);
      const { error: finishError } = await admin.rpc('nvx_control_centre_provider_finish_success', {
        p_user_id: userId,
        p_provider: provider,
        p_cache_key: cacheKey,
        p_lease_owner: leaseOwner,
        p_payload: payload,
        p_ttl_seconds: ttl,
      });
      if (finishError) throw new Error('Provider cache persistence failed');
      const now = new Date().toISOString();
      return json(req, 200, envelope(provider, 'live', payload, {
        fetched_at: now,
        last_success_at: now,
        breaker_state: 'closed',
        failure_count: 0,
      }, 'provider'));
    } catch (error: any) {
      const message = String(error?.message || 'Provider refresh failed').replace(/\s+/g, ' ').slice(0, 500);
      const { data: failedData, error: failureError } = await admin.rpc('nvx_control_centre_provider_finish_failure', {
        p_user_id: userId,
        p_provider: provider,
        p_cache_key: cacheKey,
        p_lease_owner: leaseOwner,
        p_error: message,
        p_failure_threshold: 3,
        p_open_seconds: 300,
      });
      if (failureError) console.error('[control-centre-provider] breaker update failed', provider);
      const failed = (failedData || {}) as CacheState;
      const cached = failed.payload ?? state.payload;
      const hasCache = cached !== null && cached !== undefined;
      return json(req, 200, envelope(
        provider,
        hasCache ? 'stale' : 'unavailable',
        cached,
        { ...state, ...failed, last_error: message },
        'cache',
        message,
      ));
    }
  } finally {
    clearTimeout(timeoutId);
  }
});
