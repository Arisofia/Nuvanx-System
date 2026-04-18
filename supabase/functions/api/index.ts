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
async function resolveMetaCreds(adminClient: any, userId: string, qAccountId: string) {
  const { data: credRow } = await adminClient
    .from('credentials').select('encrypted_key').eq('user_id', userId).eq('service', 'meta').single();
  if (!credRow) return { notConnected: true } as const;
  const accessToken = await decryptCred(credRow.encrypted_key);
  let adAccountId = qAccountId;
  if (!adAccountId) {
    const { data: intg } = await adminClient
      .from('integrations').select('metadata').eq('user_id', userId).eq('service', 'meta').single();
    adAccountId = intg?.metadata?.adAccountId ?? intg?.metadata?.ad_account_id ?? '';
  }
  if (adAccountId && !adAccountId.startsWith('act_')) adAccountId = `act_${adAccountId}`;
  return { notConnected: false, accessToken, adAccountId } as const;
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
      const [leadsRes, intRes] = await Promise.all([
        adminClient.from('leads').select('stage, revenue').eq('user_id', userId),
        adminClient.from('integrations').select('service, status').eq('user_id', userId),
      ]);
      if (leadsRes.error) throw leadsRes.error;
      const leads = leadsRes.data ?? [];
      const integrations = intRes.data ?? [];
      const totalLeads = leads.length;
      const totalRevenue = leads.reduce((s: number, l: any) => s + Number(l.revenue || 0), 0);
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
      if (geminiCred) {
        const apiKey = await decryptCred(geminiCred.encrypted_key);
        analysis = await callGemini(prompt, apiKey);
      } else {
        const apiKey = await decryptCred(openaiCred!.encrypted_key);
        analysis = await callOpenAI(prompt, apiKey);
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

    // ── GET /api/figma/events ────────────────────────────────────────────────
    if (resource === 'figma' && sub === 'events') {
      return json({ success: true, events: [] });
    }

    // ── POST /api/whatsapp/send ──────────────────────────────────────────────
    if (resource === 'whatsapp' && sub === 'send') {
      return json({ success: false, message: 'WhatsApp integration not connected. Add your credentials in Integrations.' }, 503);
    }

    return json({ success: false, message: `Route not found: ${resource}/${sub}` }, 404);

  } catch (err: any) {
    console.error('Edge Function error:', err);
    return json({ success: false, message: err.message || 'Internal server error' }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
