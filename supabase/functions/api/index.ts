// Nuvanx API Edge Function — v7
// Routes all frontend API calls. Supabase strips /functions/v1 so the path
// starts at /api/...
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
};

// ── Web Crypto helpers (PBKDF2 + AES-256-GCM — mirrors backend encryption) ───
function hexToBytes(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length >>> 1);
  for (let i = 0; i < hex.length; i += 2) arr[i >>> 1] = parseInt(hex.slice(i, i + 2), 16);
  return arr;
}

async function decryptCred(encoded: string): Promise<string> {
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
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
  );
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, combined));
}

// ── Meta Graph API ────────────────────────────────────────────────────────────
const META_GRAPH = 'https://graph.facebook.com/v21.0';
async function metaFetch(path: string, params: Record<string, string>, token: string) {
  const url = new URL(`${META_GRAPH}${path}`);
  url.searchParams.set('access_token', token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url.toString(), { signal: AbortSignal.timeout(20_000) });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message ?? `Meta API ${r.status}`);
  return d;
}

// ── AI helpers ────────────────────────────────────────────────────────────────
async function callGemini(prompt: string, apiKey: string): Promise<string> {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.6, maxOutputTokens: 1500 },
      }),
    },
  );
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message ?? `Gemini ${r.status}`);
  return d.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

async function callOpenAI(prompt: string, apiKey: string): Promise<string> {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.6,
      max_tokens: 1500,
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message ?? `OpenAI ${r.status}`);
  return d.choices?.[0]?.message?.content ?? '';
}

// ── Meta credential resolver ──────────────────────────────────────────────────
async function resolveMetaCreds(adminClient: any, userId: string, qAccountId: string) {  const { data: credRow } = await adminClient
    .from('credentials').select('encrypted_key').eq('user_id', userId).eq('service', 'meta').single();
  if (!credRow) return { notConnected: true } as const;
  const accessToken = await decryptCred(credRow.encrypted_key);
  let adAccountId = qAccountId;
  if (!adAccountId) {
    const { data: intg } = await adminClient
      .from('integrations').select('metadata').eq('user_id', userId).eq('service', 'meta').single();
    adAccountId = intg?.metadata?.adAccountId ?? intg?.metadata?.ad_account_id ?? '';
  }
  adAccountId = normalizeMetaAccountId(adAccountId);
  return { notConnected: false, accessToken, adAccountId } as const;
}

function normalizeMetaAccountId(raw: unknown): string {
  if (!raw) return '';
  let value = String(raw).trim();
  if (!value) return '';

  // Some rows have JSON-encoded metadata values.
  if ((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('"') && value.endsWith('"'))) {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'string') value = parsed.trim();
      if (parsed && typeof parsed === 'object') {
        const nested = (parsed as any).adAccountId ?? (parsed as any).ad_account_id ?? '';
        value = String(nested).trim();
      }
    } catch {
      // keep original value
    }
  }

  // Reject UUID-like values that were incorrectly saved in metadata.
  const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (uuidLike.test(value)) return '';

  const digitsOnly = value.replace(/^act_/, '').replace(/[^\d]/g, '');
  if (!digitsOnly) return '';
  return `act_${digitsOnly}`;
}

// ── Google Ads helpers ────────────────────────────────────────────────────────
function b64url(data: ArrayBuffer | string): string {
  let str: string;
  if (typeof data === 'string') {
    str = btoa(data);
  } else {
    str = btoa(String.fromCharCode(...new Uint8Array(data)));
  }
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function importRSAPrivateKey(pem: string): Promise<CryptoKey> {
  const pemBody = pem.replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(pemBody);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
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
  const cleanId = customerId.replace(/-/g, '');
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
  return (d.results ?? []) as any[];
}

async function resolveGoogleAdsCreds(adminClient: any, userId: string, qCustomerId: string) {
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = new URL(req.url);
  // Supabase strips /functions/v1 — path is /api/<resource>/...
  const parts = url.pathname.split('/').filter(Boolean);
  // parts[0] = 'api', parts[1] = resource, parts[2+] = sub-paths
  const resource = parts[1] ?? '';
  const sub = parts[2] ?? '';
  const sub2 = parts[3] ?? '';

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  // Auth — verify Supabase JWT
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');

  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  let userId: string | null = null;

  if (token && token !== anonKey) {
    const { data: { user }, error } = await adminClient.auth.getUser(token);
    if (error || !user) {
      return new Response(JSON.stringify({ success: false, message: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    userId = user.id;
  } else {
    return new Response(JSON.stringify({ success: false, message: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    // ── GET /api/health ──────────────────────────────────────────────────────
    if (resource === 'health') {
      return json({ success: true, status: 'ok', timestamp: new Date().toISOString() });
    }

    // ── GET /api/auth/me ─────────────────────────────────────────────────────
    if (resource === 'auth' && sub === 'me' && req.method === 'GET') {
      const { data: { user: sbUser } } = await adminClient.auth.admin.getUserById(userId);
      if (!sbUser) return json({ success: false, message: 'User not found' }, 404);
      return json({
        success: true,
        user: {
          id: sbUser.id,
          email: sbUser.email,
          name: sbUser.user_metadata?.name ?? sbUser.email,
        },
      });
    }

    // ── GET /api/leads ───────────────────────────────────────────────────────
    if (resource === 'leads' && req.method === 'GET' && !sub) {
      const { data, error } = await adminClient
        .from('leads')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return json({ success: true, leads: data, total: data.length });
    }

    // ── POST /api/leads ──────────────────────────────────────────────────────
    if (resource === 'leads' && req.method === 'POST') {
      const body = await req.json();
      const { data, error } = await adminClient
        .from('leads')
        .insert({ ...body, user_id: userId })
        .select()
        .single();
      if (error) throw error;
      return json({ success: true, lead: data }, 201);
    }

    // ── GET /api/dashboard/metrics ───────────────────────────────────────────
    if (resource === 'dashboard' && sub === 'metrics') {
      const { data: usr } = await adminClient.from('users').select('clinic_id').eq('id', userId).single();
      const clinicId = usr?.clinic_id;

      const [leadsRes, intRes, settlementsRes] = await Promise.all([
        adminClient.from('leads').select('stage, revenue').eq('user_id', userId),
        adminClient.from('integrations').select('service, status').eq('user_id', userId),
        clinicId
          ? adminClient.from('financial_settlements')
              .select('amount_net, cancelled_at, settled_at, template_name')
              .eq('clinic_id', clinicId)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (leadsRes.error) throw leadsRes.error;
      const leads = leadsRes.data ?? [];
      const integrations = intRes.data ?? [];
      const settlements = (settlementsRes.data ?? []).filter((r: any) => !r.cancelled_at);

      const totalLeads = leads.length;
      const totalRevenue = leads.reduce((s: number, l: any) => s + Number(l.revenue || 0), 0);
      const verifiedRevenue = settlements.reduce((s: number, r: any) => s + Number(r.amount_net), 0);
      const settledCount = settlements.length;

      const conversions = leads.filter((l: any) => l.stage === 'treatment' || l.stage === 'closed').length;
      const conversionRate = totalLeads > 0 ? parseFloat(((conversions / totalLeads) * 100).toFixed(1)) : 0;
      const stages = ['lead', 'whatsapp', 'appointment', 'treatment', 'closed'];
      const byStage: Record<string, number> = {};
      for (const s of stages) byStage[s] = leads.filter((l: any) => l.stage === s).length;
      const bySource: Record<string, number> = {};
      for (const l of leads) bySource[l.source] = (bySource[l.source] || 0) + 1;
      const connectedIntegrations = integrations.filter((i: any) => i.status === 'connected').length;
      return json({
        success: true,
        metrics: {
          totalLeads, totalRevenue: parseFloat(totalRevenue.toFixed(2)),
          verifiedRevenue: parseFloat(verifiedRevenue.toFixed(2)),
          settledCount,
          conversions, conversionRate, byStage, bySource,
          connectedIntegrations, totalIntegrations: integrations.length,
        },
      });
    }

    // ── GET /api/dashboard/lead-flow ─────────────────────────────────────────
    if (resource === 'dashboard' && sub === 'lead-flow') {
      const { data: leads } = await adminClient
        .from('leads').select('stage, created_at').eq('user_id', userId);
      const stages = ['lead', 'whatsapp', 'appointment', 'treatment', 'closed'];
      const total = (leads ?? []).length || 1;
      const funnel = stages.map(stage => ({
        stage, label: stage,
        count: (leads ?? []).filter((l: any) => l.stage === stage).length,
        percentage: parseFloat((((leads ?? []).filter((l: any) => l.stage === stage).length / total) * 100).toFixed(1)),
      }));
      return json({ success: true, funnel });
    }

    // ── GET /api/dashboard/meta-trends ──────────────────────────────────────
    if (resource === 'dashboard' && sub === 'meta-trends') {
      const creds = await resolveMetaCreds(adminClient, userId, url.searchParams.get('adAccountId') ?? '');
      if (creds.notConnected || !creds.adAccountId) {
        return json({ success: true, trends: [], message: creds.notConnected ? 'Meta Ads not connected' : 'Ad Account ID not configured' });
      }
      try {
        const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
        const until = new Date().toISOString().slice(0, 10);
        const data = await metaFetch(`/${creds.adAccountId}/insights`, {
          fields: 'date_start,impressions,reach,clicks,spend,ctr,cpc,cpm,conversions',
          time_range: JSON.stringify({ since, until }),
          time_increment: '1', limit: '1000',
        }, creds.accessToken);
        return json({ success: true, trends: data.data ?? [] });
      } catch (e: any) {
        return json({ success: true, trends: [], message: e.message });
      }
    }

    // ── GET /api/meta/insights ───────────────────────────────────────────────
    if (resource === 'meta' && sub === 'insights' && req.method === 'GET') {
      const creds = await resolveMetaCreds(adminClient, userId, url.searchParams.get('adAccountId') ?? '');
      if (creds.notConnected) return json({ success: false, notConnected: true, message: 'Meta not connected. Add your credentials in Integrations.' });
      if (!creds.adAccountId) return json({ success: false, noAccountId: true, message: 'Meta Ad Account ID not configured.' });

      const days = parseInt(url.searchParams.get('days') ?? '30');
      const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
      const until = new Date().toISOString().slice(0, 10);
      const prevSince = new Date(Date.now() - days * 2 * 86400_000).toISOString().slice(0, 10);
      const fields = 'date_start,impressions,reach,clicks,spend,ctr,cpc,cpm,frequency,conversions,cost_per_conversion,unique_clicks';

      const [currRes, prevRes] = await Promise.allSettled([
        metaFetch(`/${creds.adAccountId}/insights`, {
          fields, time_range: JSON.stringify({ since, until }), time_increment: '1', limit: '1000',
        }, creds.accessToken),
        metaFetch(`/${creds.adAccountId}/insights`, {
          fields: 'impressions,reach,clicks,spend,conversions,cost_per_conversion',
          time_range: JSON.stringify({ since: prevSince, until: since }),
        }, creds.accessToken),
      ]);

      const daily = currRes.status === 'fulfilled' ? (currRes.value.data ?? []) : [];
      const prevD = prevRes.status === 'fulfilled' ? (prevRes.value.data?.[0] ?? {}) : {};
      const sumN = (arr: any[], k: string) => arr.reduce((s: number, d: any) => s + parseFloat(d[k] || 0), 0);

      const curr = {
        impressions: Math.round(sumN(daily, 'impressions')),
        reach: Math.round(sumN(daily, 'reach')),
        clicks: Math.round(sumN(daily, 'clicks')),
        spend: parseFloat(sumN(daily, 'spend').toFixed(2)),
        conversions: Math.round(sumN(daily, 'conversions')),
      };
      const ctr = curr.impressions > 0 ? parseFloat(((curr.clicks / curr.impressions) * 100).toFixed(2)) : 0;
      const cpc = curr.clicks > 0 ? parseFloat((curr.spend / curr.clicks).toFixed(2)) : 0;
      const cpm = curr.impressions > 0 ? parseFloat((curr.spend / curr.impressions * 1000).toFixed(2)) : 0;
      const cpp = curr.conversions > 0 ? parseFloat((curr.spend / curr.conversions).toFixed(2)) : 0;
      const prev = {
        impressions: parseFloat(prevD.impressions ?? 0),
        reach: parseFloat(prevD.reach ?? 0),
        clicks: parseFloat(prevD.clicks ?? 0),
        spend: parseFloat(prevD.spend ?? 0),
        conversions: parseFloat(prevD.conversions ?? 0),
      };
      const pct = (c: number, p: number) => p === 0 ? (c > 0 ? 100 : 0) : parseFloat(((c - p) / p * 100).toFixed(1));

      return json({
        success: true,
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
          impressions: parseFloat(d.impressions || 0),
          reach: parseFloat(d.reach || 0),
          clicks: parseFloat(d.clicks || 0),
          spend: parseFloat(d.spend || 0),
          ctr: parseFloat(d.ctr || 0),
          cpc: parseFloat(d.cpc || 0),
          cpm: parseFloat(d.cpm || 0),
        })),
      });
    }

    // ── GET /api/meta/campaigns ──────────────────────────────────────────────
    if (resource === 'meta' && sub === 'campaigns' && req.method === 'GET') {
      const creds = await resolveMetaCreds(adminClient, userId, url.searchParams.get('adAccountId') ?? '');
      if (creds.notConnected) return json({ success: false, notConnected: true, message: 'Meta not connected.' });
      if (!creds.adAccountId) return json({ success: false, noAccountId: true, message: 'Meta Ad Account ID not configured.' });

      const data = await metaFetch(`/${creds.adAccountId}/campaigns`, {
        fields: 'id,name,status,objective,daily_budget,lifetime_budget,insights.date_preset(last_30d){impressions,reach,clicks,spend,ctr,cpc,cpm,conversions,cost_per_conversion}',
        limit: '100',
      }, creds.accessToken);

      return json({
        success: true,
        campaigns: (data.data ?? []).map((c: any) => {
          const ins = c.insights?.data?.[0];
          return {
            id: c.id,
            name: c.name,
            status: c.status,
            objective: c.objective?.replace(/_/g, ' ') ?? '',
            dailyBudget: c.daily_budget ? parseFloat(c.daily_budget) / 100 : null,
            lifetimeBudget: c.lifetime_budget ? parseFloat(c.lifetime_budget) / 100 : null,
            insights: ins ? {
              impressions: parseFloat(ins.impressions || 0),
              reach: parseFloat(ins.reach || 0),
              clicks: parseFloat(ins.clicks || 0),
              spend: parseFloat(ins.spend || 0),
              ctr: parseFloat(ins.ctr || 0),
              cpc: parseFloat(ins.cpc || 0),
              cpm: parseFloat(ins.cpm || 0),
              conversions: parseFloat(ins.conversions || 0),
              cpp: ins.cost_per_conversion ? parseFloat(ins.cost_per_conversion) : null,
            } : null,
          };
        }),
      });
    }

    // ── POST /api/ai/analyze ─────────────────────────────────────────────────
    if (resource === 'ai' && sub === 'analyze' && req.method === 'POST') {
      const body = await req.json();
      const { data, context = '' } = body;

      const { data: creds } = await adminClient
        .from('credentials').select('service, encrypted_key').eq('user_id', userId).in('service', ['gemini', 'openai']);
      const geminiCred = (creds ?? []).find((c: any) => c.service === 'gemini');
      const openaiCred = (creds ?? []).find((c: any) => c.service === 'openai');
      if (!geminiCred && !openaiCred) {
        return json({ success: false, message: 'No AI integration connected. Add Gemini or OpenAI in Integrations.' });
      }

      const prompt = [
        'Eres un experto en marketing digital para una clínica de medicina estética premium en Madrid.',
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
      ].filter(l => l !== undefined).join('\n');

      let analysis = '';
      const providerErrors: string[] = [];

      if (geminiCred) {
        try {
          const apiKey = await decryptCred(geminiCred.encrypted_key);
          analysis = await callGemini(prompt, apiKey);
        } catch (err: any) {
          providerErrors.push(`gemini: ${err?.message ?? 'unknown error'}`);
        }
      }

      if (!analysis && openaiCred) {
        try {
          const apiKey = await decryptCred(openaiCred.encrypted_key);
          analysis = await callOpenAI(prompt, apiKey);
        } catch (err: any) {
          providerErrors.push(`openai: ${err?.message ?? 'unknown error'}`);
        }
      }

      if (!analysis) {
        return json({
          success: false,
          message: 'AI request failed for all connected providers.',
          details: providerErrors,
        }, 502);
      }
      return json({ success: true, analysis });
    }

    // ── PATCH /api/integrations/:service (update metadata) ───────────────────
    if (resource === 'integrations' && sub && !sub2 && req.method === 'PATCH') {
      const body = await req.json();
      const { error } = await adminClient
        .from('integrations')
        .update({ metadata: body.metadata, updated_at: new Date().toISOString() })
        .eq('user_id', userId).eq('service', sub);
      if (error) throw error;
      return json({ success: true });
    }

    // ── GET /api/integrations/validate-all ──────────────────────────────────
    if (resource === 'integrations' && sub === 'validate-all' && req.method === 'GET') {
      const [intRes, credRes] = await Promise.all([
        adminClient.from('integrations').select('service, status, last_sync, metadata').eq('user_id', userId),
        adminClient.from('credentials').select('service').eq('user_id', userId),
      ]);
      const integrations = intRes.data ?? [];
      const storedServices = new Set((credRes.data ?? []).map((c: any) => c.service));
      const validated = integrations.map((i: any) => {
        const hasCredential = storedServices.has(i.service);
        return {
          service: i.service,
          status: hasCredential ? 'connected' : i.status,
          lastSync: i.last_sync,
          skipped: false,
          accountName: i.metadata?.accountName ?? null,
          login: i.metadata?.login ?? null,
          email: i.metadata?.email ?? null,
        };
      });
      return json({ success: true, validated });
    }

    // ── GET /api/integrations ────────────────────────────────────────────────
    if (resource === 'integrations' && req.method === 'GET' && !sub) {
      const { data, error } = await adminClient
        .from('integrations')
        .select('id, service, status, last_sync, last_error, metadata')
        .eq('user_id', userId)
        .order('service');
      if (error) throw error;
      return json({ success: true, integrations: data });
    }

    // ── POST /api/integrations/:service/connect ───────────────────────────────
    if (resource === 'integrations' && sub2 === 'connect' && req.method === 'POST') {
      const service = sub;
      const body = await req.json();
      const reqToken = body.token;
      if (!reqToken) return json({ success: false, message: 'token is required' }, 400);
      const { error: intErr } = await adminClient
        .from('integrations')
        .update({ status: 'connected', metadata: body.metadata ?? {}, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('service', service);
      if (intErr) throw intErr;
      return json({ success: true, service, status: 'connected' });
    }

    // ── POST /api/integrations/:service/test ─────────────────────────────────
    if (resource === 'integrations' && sub2 === 'test' && req.method === 'POST') {
      const service = sub;
      const { data: cred } = await adminClient
        .from('credentials').select('service').eq('user_id', userId).eq('service', service).single();
      const status = cred ? 'connected' : 'error';
      return json({ success: !!cred, service, status, metadata: {} });
    }

    // ── GET /api/playbooks ───────────────────────────────────────────────────
    if (resource === 'playbooks' && req.method === 'GET' && !sub) {
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
      return json({ success: true, playbooks });
    }

    // ── POST /api/playbooks/:slug/run ────────────────────────────────────────
    if (resource === 'playbooks' && sub2 === 'run' && req.method === 'POST') {
      const { data: pb, error: pbErr } = await adminClient
        .from('playbooks').select('id, title, status, run_count').eq('slug', sub).single();
      if (pbErr || !pb) return json({ success: false, message: `Playbook '${sub}' not found` }, 404);
      if (pb.status === 'archived') return json({ success: false, message: 'Playbook is archived' }, 400);
      const { data: exec, error: execErr } = await adminClient
        .from('playbook_executions')
        .insert({ playbook_id: pb.id, user_id: userId, status: 'success', metadata: {} })
        .select().single();
      if (execErr) throw execErr;
      await adminClient.from('playbooks')
        .update({ run_count: (pb as any).run_count + 1, last_run_at: new Date().toISOString() })
        .eq('id', pb.id);
      return json({ success: true, execution: { id: exec.id, playbookSlug: sub, playbookTitle: pb.title, status: exec.status, ranAt: exec.created_at } });
    }

    // ── GET /api/ai/status ───────────────────────────────────────────────────
    if (resource === 'ai' && sub === 'status') {
      const { data: cred } = await adminClient
        .from('credentials').select('service').eq('user_id', userId).in('service', ['openai', 'gemini']);
      const hasAi = (cred ?? []).length > 0;
      return json({ success: true, available: hasAi, provider: hasAi ? (cred![0] as any).service : null });
    }

    // ── POST /api/ai/suggestions ─────────────────────────────────────────────
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
      return json({ success: true, suggestions });
    }

    // ── GET /api/google-ads/insights ─────────────────────────────────────────
    if (resource === 'google-ads' && sub === 'insights' && req.method === 'GET') {
      const g = await resolveGoogleAdsCreds(adminClient, userId, url.searchParams.get('customerId') ?? '');
      if ('noServiceAccount' in g && g.noServiceAccount) return json({ success: false, noServiceAccount: true, message: 'Google Ads service account not configured.' });
      if ('notConnected' in g && g.notConnected) return json({ success: false, notConnected: true, message: 'Google Ads not connected. Add your developer token in Integrations.' });
      if (!(g as any).customerId) return json({ success: false, noAccountId: true, message: 'Google Ads Customer ID not configured.' });
      const { devToken, customerId, serviceAccount } = g as any;

      const days = parseInt(url.searchParams.get('days') ?? '30');
      const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
      const until = new Date().toISOString().slice(0, 10);
      const prevSince = new Date(Date.now() - days * 2 * 86400_000).toISOString().slice(0, 10);

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

      const micros2eur = (m: number) => parseFloat((m / 1_000_000).toFixed(2));
      const sumF = (rows: any[], field: string) => rows.reduce((s, r) => s + (Number(r.metrics?.[field] ?? 0)), 0);

      const currImp = Math.round(sumF(daily, 'impressions'));
      const currClicks = Math.round(sumF(daily, 'clicks'));
      const currSpend = micros2eur(sumF(daily, 'costMicros'));
      const currConv = Math.round(sumF(daily, 'conversions'));
      const prevImp = Math.round(sumF(prevData, 'impressions'));
      const prevClicks = Math.round(sumF(prevData, 'clicks'));
      const prevSpend = micros2eur(sumF(prevData, 'costMicros'));
      const prevConv = Math.round(sumF(prevData, 'conversions'));

      const ctr = currImp > 0 ? parseFloat(((currClicks / currImp) * 100).toFixed(2)) : 0;
      const cpc = currClicks > 0 ? parseFloat((currSpend / currClicks).toFixed(2)) : 0;
      const cpm = currImp > 0 ? parseFloat((currSpend / currImp * 1000).toFixed(2)) : 0;
      const cpp = currConv > 0 ? parseFloat((currSpend / currConv).toFixed(2)) : 0;
      const pct = (c: number, p: number) => p === 0 ? (c > 0 ? 100 : 0) : parseFloat(((c - p) / p * 100).toFixed(1));

      return json({
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
          ctr: parseFloat(Number(r.metrics?.ctr ?? 0).toFixed(4)) * 100,
          cpc: micros2eur(Number(r.metrics?.averageCpc ?? 0)),
          cpm: micros2eur(Number(r.metrics?.averageCpm ?? 0)),
        })),
      });
    }

    // ── GET /api/google-ads/campaigns ────────────────────────────────────────
    if (resource === 'google-ads' && sub === 'campaigns' && req.method === 'GET') {
      const g = await resolveGoogleAdsCreds(adminClient, userId, url.searchParams.get('customerId') ?? '');
      if ('noServiceAccount' in g && g.noServiceAccount) return json({ success: false, noServiceAccount: true, message: 'Google Ads service account not configured.' });
      if ('notConnected' in g && g.notConnected) return json({ success: false, notConnected: true, message: 'Google Ads not connected.' });
      if (!(g as any).customerId) return json({ success: false, noAccountId: true, message: 'Google Ads Customer ID not configured.' });
      const { devToken, customerId, serviceAccount } = g as any;

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

      const micros2eur = (m: number) => m > 0 ? parseFloat((m / 1_000_000).toFixed(2)) : null;
      return json({
        success: true,
        campaigns: rows.map((r: any) => ({
          id: r.campaign?.id ?? '',
          name: r.campaign?.name ?? '',
          status: r.campaign?.status ?? '',
          type: (r.campaign?.advertisingChannelType ?? '').replace(/_/g, ' '),
          budget: micros2eur(Number(r.campaignBudget?.amountMicros ?? 0)),
          insights: {
            impressions: Number(r.metrics?.impressions ?? 0),
            clicks: Number(r.metrics?.clicks ?? 0),
            spend: micros2eur(Number(r.metrics?.costMicros ?? 0)) ?? 0,
            conversions: Number(r.metrics?.conversions ?? 0),
            ctr: parseFloat((Number(r.metrics?.ctr ?? 0) * 100).toFixed(2)),
            cpc: micros2eur(Number(r.metrics?.averageCpc ?? 0)),
            cpp: micros2eur(Number(r.metrics?.costPerConversion ?? 0)),
          },
        })),
      });
    }

    // ── GET /api/financials/summary ─────────────────────────────────────────
    if (resource === 'financials' && sub === 'summary') {
      const { data: { user } } = await adminClient.auth.getUser(token!);
      if (!user) return json({ success: false, message: 'Unauthorized' }, 401);
      const { data: usr } = await adminClient.from('users').select('clinic_id').eq('id', user.id).single();
      const clinicId = usr?.clinic_id;
      if (!clinicId) return json({ success: false, message: 'No clinic' }, 400);

      const { data: rows } = await adminClient
        .from('financial_settlements')
        .select('amount_gross, amount_discount, amount_net, template_name, settled_at, intake_at, cancelled_at')
        .eq('clinic_id', clinicId)
        .order('settled_at', { ascending: false });

      const settled = (rows || []).filter((r: any) => !r.cancelled_at);
      const totalNet = settled.reduce((s: number, r: any) => s + Number(r.amount_net), 0);
      const totalGross = settled.reduce((s: number, r: any) => s + Number(r.amount_gross), 0);
      const totalDiscount = settled.reduce((s: number, r: any) => s + Number(r.amount_discount), 0);
      const avgTicket = settled.length ? totalNet / settled.length : 0;
      const discountRate = totalGross ? (totalDiscount / totalGross) * 100 : 0;

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
        .slice(-6)
        .map(([month, net]) => ({ month, net: Math.round(net * 100) / 100 }));

      return json({
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
      });
    }

    // ── GET /api/financials/settlements ──────────────────────────────────────
    if (resource === 'financials' && sub === 'settlements') {
      const { data: { user } } = await adminClient.auth.getUser(token!);
      if (!user) return json({ success: false, message: 'Unauthorized' }, 401);
      const { data: usr } = await adminClient.from('users').select('clinic_id').eq('id', user.id).single();
      const clinicId = usr?.clinic_id;
      if (!clinicId) return json({ success: false, message: 'No clinic' }, 400);

      const { data: rows } = await adminClient
        .from('financial_settlements')
        .select('id, patient_dni, patient_name, template_name, amount_gross, amount_discount, amount_net, settled_at, intake_at, cancelled_at')
        .eq('clinic_id', clinicId)
        .order('settled_at', { ascending: false })
        .limit(100);

      return json({ success: true, settlements: rows || [] });
    }

    // ── GET /api/financials/patients ─────────────────────────────────────────
    if (resource === 'financials' && sub === 'patients') {
      const { data: { user } } = await adminClient.auth.getUser(token!);
      if (!user) return json({ success: false, message: 'Unauthorized' }, 401);
      const { data: usr } = await adminClient.from('users').select('clinic_id').eq('id', user.id).single();
      const clinicId = usr?.clinic_id;
      if (!clinicId) return json({ success: false, message: 'No clinic' }, 400);

      const { data: rows } = await adminClient
        .from('patients')
        .select('id, dni, name, email, phone, total_ltv, last_visit, created_at')
        .eq('clinic_id', clinicId)
        .order('total_ltv', { ascending: false });

      return json({ success: true, patients: rows || [] });
    }

    // ── GET /api/traceability/leads ──────────────────────────────────────────
    if (resource === 'traceability' && sub === 'leads') {
      const { data: { user } } = await adminClient.auth.getUser(token!);
      if (!user) return json({ success: false, message: 'Unauthorized' }, 401);
      const { data: usr } = await adminClient.from('users').select('clinic_id').eq('id', user.id).single();
      const clinicId = usr?.clinic_id;
      if (!clinicId) return json({ success: false, message: 'No clinic' }, 400);

      const { data: rows } = await adminClient
        .from('v_lead_traceability')
        .select('*')
        .limit(250);

      return json({ success: true, leads: rows || [] });
    }

    // ── GET /api/traceability/funnel ─────────────────────────────────────────
    if (resource === 'traceability' && sub === 'funnel') {
      const { data: { user } } = await adminClient.auth.getUser(token!);
      if (!user) return json({ success: false, message: 'Unauthorized' }, 401);

      const { data: rows } = await adminClient.from('v_whatsapp_funnel').select('*');
      return json({ success: true, funnel: rows || [] });
    }

    // ── GET /api/traceability/campaigns ─────────────────────────────────────
    if (resource === 'traceability' && sub === 'campaigns') {
      const { data: { user } } = await adminClient.auth.getUser(token!);
      if (!user) return json({ success: false, message: 'Unauthorized' }, 401);

      const { data: rows } = await adminClient.from('v_campaign_roi').select('*').order('total_leads', { ascending: false });
      return json({ success: true, campaigns: rows || [] });
    }

    // ── GET /api/conversations ───────────────────────────────────────────────
    if (resource === 'conversations' && !sub) {
      const { data: { user } } = await adminClient.auth.getUser(token!);
      if (!user) return json({ success: false, message: 'Unauthorized' }, 401);
      const { data: usr } = await adminClient.from('users').select('clinic_id').eq('id', user.id).single();
      const clinicId = usr?.clinic_id;
      if (!clinicId) return json({ success: false, message: 'No clinic' }, 400);

      const leadId = url.searchParams.get('lead_id');
      let query = adminClient
        .from('whatsapp_conversations')
        .select('id, lead_id, phone, direction, message_type, message_preview, sent_at, delivered_at, read_at, replied_at')
        .eq('clinic_id', clinicId)
        .order('sent_at', { ascending: false })
        .limit(200);

      if (leadId) query = query.eq('lead_id', leadId);

      const { data: rows } = await query;
      return json({ success: true, conversations: rows || [] });
    }

    // ── GET /api/figma/events ────────────────────────────────────────────────
    if (resource === 'figma' && sub === 'events') {
      return json({ success: true, events: [] });
    }

    // ── POST /api/whatsapp/send ──────────────────────────────────────────────
    if (resource === 'whatsapp' && sub === 'send') {
      return json({ success: false, message: 'WhatsApp integration not connected. Add your credentials in Integrations.' }, 503);
    }

    // ── GET /api/kpis ────────────────────────────────────────────────────────
    // Master KPI summary: what is real now + what is blocked and why
    if (resource === 'kpis' && !sub && req.method === 'GET') {
      const { data: usr } = await adminClient.from('users').select('clinic_id').eq('id', userId).single();
      const clinicId = usr?.clinic_id;
      if (!clinicId) return json({ success: false, message: 'No clinic' }, 400);

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

      return json({
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

    // ── GET /api/reports/doctoralia-financials ───────────────────────────────
    if (resource === 'reports' && sub === 'doctoralia-financials' && req.method === 'GET') {
      const { data: usr } = await adminClient.from('users').select('clinic_id').eq('id', userId).single();
      const clinicId = usr?.clinic_id;
      if (!clinicId) return json({ success: false, message: 'No clinic' }, 400);

      const { data: byTemplate } = await adminClient
        .from('vw_doctoralia_financials')
        .select('*')
        .order('settled_month', { ascending: true });

      const { data: byMonth } = await adminClient
        .from('vw_doctoralia_by_month')
        .select('*')
        .order('settled_month', { ascending: true });

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

      return json({ success: true, byTemplate: byTemplate || [], byMonth: byMonth || [], templateSummary });
    }

    // ── GET /api/reports/campaign-performance ────────────────────────────────
    if (resource === 'reports' && sub === 'campaign-performance' && req.method === 'GET') {
      const { data: rows } = await adminClient
        .from('vw_campaign_performance_real')
        .select('*')
        .order('total_leads', { ascending: false });
      return json({ success: true, campaigns: rows || [] });
    }

    // ── GET /api/reports/whatsapp-conversion ─────────────────────────────────
    if (resource === 'reports' && sub === 'whatsapp-conversion' && req.method === 'GET') {
      const { data: rows } = await adminClient
        .from('vw_whatsapp_conversion_real')
        .select('*');
      return json({ success: true, cohorts: rows || [] });
    }

    // ── GET /api/reports/doctor-performance ──────────────────────────────────
    if (resource === 'reports' && sub === 'doctor-performance' && req.method === 'GET') {
      const { data: rows } = await adminClient
        .from('vw_doctor_performance_real')
        .select('*')
        .order('total_appointments', { ascending: false });
      return json({ success: true, doctors: rows || [] });
    }

    // ── POST /api/leads/:id/reconcile ─────────────────────────────────────────
    // Runs reconcile_lead_to_patient() for the given lead.
    // Returns { matched: true, patient_id } or { matched: false }
    if (resource === 'leads' && sub2 === 'reconcile' && req.method === 'POST') {
      const leadId = sub;
      if (!leadId) return json({ success: false, message: 'lead id required' }, 400);
      const { data, error } = await adminClient.rpc('reconcile_lead_to_patient', { p_lead_id: leadId });
      if (error) return json({ success: false, message: error.message }, 500);
      return json({ success: true, matched: data !== null, patient_id: data ?? null });
    }

    return json({ success: false, message: `Route not found: ${resource}/${sub}` }, 404);

  } catch (err: any) {
    console.error('Edge Function error:', err);
    return json({ success: false, message: err.message || 'Internal server error' }, 500);
  }
});

function json(data: unknown, status = 200) {
  const payload = (data && typeof data === 'object') ? { ...(data as Record<string, unknown>) } : { data };
  const success = payload.success ?? (status < 400);
  const hasError = payload.error !== undefined && payload.error !== null;
  const message = typeof payload.message === 'string' ? payload.message : null;

  if (!Object.prototype.hasOwnProperty.call(payload, 'success')) payload.success = Boolean(success);
  if (!Object.prototype.hasOwnProperty.call(payload, 'data')) {
    payload.data = success ? null : null;
  }
  if (!Object.prototype.hasOwnProperty.call(payload, 'error')) {
    payload.error = hasError ? payload.error : (success ? null : message ?? 'Request failed');
  }

  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
