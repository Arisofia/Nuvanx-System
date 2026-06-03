/// <reference lib="deno.ns" />
// supabase/functions/daily-aggregates/index.ts
import { createClient } from '@supabase/supabase-js'
import { ENCRYPTION_KEY, META_APP_SECRET, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from '../_shared/config.ts'

/**
 * Creates and returns a Supabase admin client bound to the service role key.
 *
 * This helper centralizes client construction for the daily-aggregates
 * function and fails fast when core Supabase configuration is missing.
 *
 * Throws if SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY are not set.
 */
function createSupabaseAdminClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured for daily-aggregates.');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

// Lazy getter so module load never throws on missing envs (e.g. during health or cold start).
// Real supabase client created on first use inside handlers only.
let supabaseInstance: ReturnType<typeof createSupabaseAdminClient> | null = null;
function getSupabase() {
  if (!supabaseInstance) {
    supabaseInstance = createSupabaseAdminClient();
  }
  return supabaseInstance;
}

// ── Encryption Helpers ──────────────────────────────────────────────────────

/**
 * Converts a hex-encoded string into a byte array buffer.
 *
 * Used to reconstruct binary keying material required by Web Crypto during
 * PBKDF2 and AES-GCM operations.
 *
 * Args:
 *   hex: A hex string where each pair of characters represents one byte.
 *
 * Returns:
 *   A Uint8Array backed by an ArrayBuffer containing the decoded bytes.
 */
function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(hex.length >>> 1);
  const arr = new Uint8Array(buf);
  for (let i = 0; i < hex.length; i += 2) arr[i >>> 1] = Number.parseInt(hex.slice(i, i + 2), 16);
  return arr;
}

/**
 * Converts a Uint8Array view into a minimal ArrayBuffer without extra padding.
 *
 * This avoids leaking the underlying backing store when passing slices into
 * Web Crypto APIs that expect tightly packed ArrayBuffer instances.
 *
 * Args:
 *   bytes: A Uint8Array whose visible window should be converted.
 *
 * Returns:
 *   A new ArrayBuffer containing exactly the visible bytes of the input view.
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/**
 * Encodes a string into an ArrayBuffer using UTF‑8.
 *
 * This is a small helper to bridge from string-based secrets into the
 * BufferSource types required by Web Crypto.
 *
 * Args:
 *   value: The string to encode.
 *
 * Returns:
 *   An ArrayBuffer containing the UTF‑8 encoding of the input string.
 */
function encodeBufferSource(value: string): ArrayBuffer {
  return toArrayBuffer(new TextEncoder().encode(value));
}

/**
 * Decrypts an encrypted credential string using PBKDF2 + AES‑256‑GCM.
 *
 * The ciphertext format is `salt:iv:tag:ciphertext`, each segment hex‑encoded.
 * This mirrors the encryption scheme used in the api Edge Function so
 * daily-aggregates can reuse stored API keys without duplicating logic.
 *
 * Args:
 *   encoded: The encrypted credential string in the expected salt/iv/tag/ct format.
 *
 * Returns:
 *   The decrypted plaintext credential string.
 *
 * Throws:
 *   Error: If ENCRYPTION_KEY is missing, the ciphertext is malformed,
 *   or any Web Crypto operation fails.
 */
async function decryptCred(encoded: string): Promise<string> {
  const masterKey = ENCRYPTION_KEY;
  if (!masterKey) throw new Error('ENCRYPTION_KEY not set');
  const parts = encoded.split(':');
  if (parts.length !== 4) throw new Error('malformed ciphertext');
  const [saltH, ivH, tagH, ctH] = parts;
  const salt = hexToBytes(saltH), iv = hexToBytes(ivH);
  const tag = hexToBytes(tagH), ct = hexToBytes(ctH);
  const combined = new Uint8Array(ct.length + tag.length);
  combined.set(ct); combined.set(tag, ct.length);
  const km = await crypto.subtle.importKey('raw', encodeBufferSource(masterKey), 'PBKDF2', false, ['deriveKey']);
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: toArrayBuffer(salt), iterations: 100_000, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
  );
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, aesKey, toArrayBuffer(combined)));
}

// ── Meta Fetch Helpers ──────────────────────────────────────────────────────
const META_GRAPH = 'https://graph.facebook.com/v22.0';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function computeAppsecretProof(accessToken: string, appSecret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encodeBufferSource(appSecret), 'HMAC', false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encodeBufferSource(accessToken)));
  return bytesToHex(sig);
}

async function metaFetch(path: string, params: Record<string, string>, token: string) {
  const url = new URL(`${META_GRAPH}${path}`);
  url.searchParams.set('access_token', token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (META_APP_SECRET) {
    url.searchParams.set('appsecret_proof', await computeAppsecretProof(token, META_APP_SECRET));
  }
  const r = await fetch(url.toString());
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.error?.message || `Meta API ${r.status}`);
  }
  return await r.json();
}

function actionValue(actions: any[], matcher: (t: string) => boolean): number {
  if (!Array.isArray(actions)) return 0;
  return actions.reduce((sum, a) => matcher(a.action_type || '') ? sum + Number(a.value || 0) : sum, 0);
}

// ── Core Logic ──────────────────────────────────────────────────────────────
async function fetchAllClinicsMetaInsights(days: number) {
  const sb = getSupabase();
  const { data: credentials } = await sb
    .from('credentials')
    .select('*')
    .eq('service', 'meta')
    .is('deleted_at', null);

  if (!credentials) return { rowsInserted: 0 };

  let totalRows = 0;
  const untilDate = new Date().toISOString().slice(0, 10);
  const sinceDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  for (const cred of credentials) {
    try {
      const accessToken = await decryptCred(cred.encrypted_key);
      const adAccountIds = cred.metadata?.ad_account_ids || (cred.metadata?.ad_account_id ? [cred.metadata.ad_account_id] : []);
      
      for (const adAccountId of adAccountIds) {
        const insights = await metaFetch(`/${adAccountId}/insights`, {
          fields: 'date_start,impressions,reach,clicks,spend,ctr,cpc,cpm,actions',
          time_range: JSON.stringify({ since: sinceDate, until: untilDate }),
          time_increment: '1',
          limit: '1000',
        }, accessToken);

        const rows = (insights.data || []).map((r: any) => ({
          user_id: cred.user_id,
          clinic_id: cred.clinic_id,
          ad_account_id: adAccountId,
          date: r.date_start,
          impressions: Math.round(Number(r.impressions || 0)),
          reach: Math.round(Number(r.reach || 0)),
          clicks: Math.round(Number(r.clicks || 0)),
          spend: Number(r.spend || 0),
          conversions: actionValue(r.actions, (t) => t.includes('lead') || t.includes('conversion') || t.includes('complete_registration')),
          ctr: Number(r.ctr || 0),
          cpc: Number(r.cpc || 0),
          cpm: Number(r.cpm || 0),
          messaging_conversations: actionValue(r.actions, (t) => t.includes('messaging') || t.includes('conversation')),
          updated_at: new Date().toISOString(),
        }));

        if (rows.length > 0) {
          const { error } = await getSupabase().from('meta_daily_insights').upsert(rows, { onConflict: 'clinic_id,ad_account_id,date' });
          if (error) console.error(`Error upserting insights for ${adAccountId}:`, error);
          else totalRows += rows.length;
        }
      }

      // Daily AI-powered insight for this clinic (agent runs daily, stored for morning access)
      try {
        const clinicContext = {
          clinic_id: cred.clinic_id,
          ad_account_ids: adAccountIds,
          date: sinceDate,
          insights_rows: totalRows // cumulative but per cred in loop
        };
        const aiPrompt = `Eres un analista de marketing experto para clínicas de medicina estética. Analiza estos datos diarios de Meta Ads para la clínica: ${JSON.stringify(clinicContext)}. Proporciona 3-4 insights clave accionables y 2 recomendaciones específicas para mañana. Usa números, sé conciso y orientado a decisiones de presupuesto y conversión.`;

        let aiInsight = `Datos del día para ${adAccountIds.join(', ')}: ${rows.length} registros de insights. Base: priorizar cuentas con mejor CTR y CPC.`;

        const gemKey = Deno.env.get('GEMINI_API_KEY') || '';
        if (gemKey) {
          const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${gemKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: aiPrompt }] }],
              generationConfig: { maxOutputTokens: 400 }
            })
          });
          if (gRes.ok) {
            const gData = await gRes.json();
            aiInsight = gData.candidates?.[0]?.content?.parts?.[0]?.text || aiInsight;
          }
        }

        if (cred.user_id) {
          await getSupabase().from('agent_outputs').insert({
            user_id: cred.user_id,
            agent_type: 'daily-meta-insight',
            input_context: clinicContext,
            output_text: aiInsight,
            status: 'completed'
          });
        }
      } catch (aiErr) {
        console.warn('[daily-aggregates] daily-meta-insight AI failed for clinic', cred.clinic_id, aiErr);
      }
    } catch (err) {
      console.error(`Failed to process credentials for user ${cred.user_id}:`, err);
    }
  }
  return { rowsInserted: totalRows };
}


async function handleMetaDailyInsights(daysInput: number = 2) {
  try {
    const days = typeof daysInput === 'number' && Number.isFinite(daysInput) ? daysInput : 2;

    console.log(`[Daily] Fetching Meta insights for last ${days} days`);
    const result = await fetchAllClinicsMetaInsights(days);

    return new Response(JSON.stringify({
      success: true,
      message: `Meta insights updated: ${result.rowsInserted} rows`,
      rowsInserted: result.rowsInserted,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('Meta Daily Insights error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

type DailyAggregatesRequest = {
  action?: string;
  days?: number;
};

Deno.serve(async (req: Request) => {
  const body = (await req.json().catch((): DailyAggregatesRequest => ({}))) as DailyAggregatesRequest;
  const { action, days = 2 } = body;

  if (action === 'fetch_meta_insights' || action === 'meta-daily-insights') {
    return await handleMetaDailyInsights(days);
  }

  // Fallback to existing logic if no action is provided (for legacy compatibility)
  console.log('[daily-aggregates] Iniciando tareas diarias...')

  const today = new Date().toISOString().slice(0, 10)
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)

  // ============================================
  // TAREA 1: Leads en riesgo (>14 días en "Nuevo")
  // ============================================
  const sb1 = getSupabase();
  const { data: riskLeads } = await sb1
    .from('leads')
    .select('id, name, phone, clinic_id, created_at, stage')
    .eq('stage', 'Nuevo')
    .lt('created_at', fourteenDaysAgo)
    .neq('source', 'doctoralia')
    .order('created_at', { ascending: true })
    .limit(100)

  // ============================================
  // TAREA 2: Ranking semanal de campañas (top 5)
  // ============================================
  const sb2 = getSupabase();
  const { data: campaignRanking } = await sb2
    .from('financial_settlements')
    .select('campaign_name, amount_net')
    .gte('settled_at', new Date(Date.now() - 7 * 86400000).toISOString())
    .neq('source_system', 'doctoralia') // solo campañas de marketing (real acquisition, no doctoralia)

  let processedRanking: any[] = []
  if (campaignRanking) {
    const revenueByCampaign = campaignRanking.reduce((acc: Record<string, number>, curr: any) => {
      const name = curr.campaign_name || 'Sin nombre'
      acc[name] = (acc[name] || 0) + Number(curr.amount_net || 0)
      return acc
    }, {})

    processedRanking = Object.entries(revenueByCampaign)
      .map(([campaign_name, revenue]) => ({ campaign_name, revenue }))
      .sort((a, b) => (b.revenue as number) - (a.revenue as number))
      .slice(0, 5)
  }

  // ============================================
  // TAREA 3: Resumen diario Doctoralia (revenue verificado)
  // ============================================
  const sb3 = getSupabase();
  const { data: settlementsToday } = await sb3
    .from('financial_settlements')
    .select('amount_net')
    .eq('source_system', 'doctoralia')
    .gte('settled_at', today)

  const doctoraliaSummary = {
    total_revenue: settlementsToday?.reduce((sum, s) => sum + Number(s.amount_net || 0), 0) || 0,
    total_patients: settlementsToday?.length || 0
  }

  // Daily insights (rule-based + AI agent if key available in secrets)
  const dailyInsights: any = {
    date: today,
    risk_leads: riskLeads?.length || 0,
    top_campaigns: processedRanking,
    doctoralia_summary: doctoraliaSummary,
    recommendations: [
      riskLeads && riskLeads.length > 0 ? `Atender los ${riskLeads.length} leads en riesgo (>14d en Nuevo).` : 'Sin leads en riesgo alto.',
      processedRanking.length > 0 ? `Priorizar campañas top revenue: ${processedRanking.slice(0, 3).map((c: any) => c.campaign_name).join(', ')}.` : '',
      `Doctoralia hoy: €${doctoraliaSummary.total_revenue} (${doctoraliaSummary.total_patients} pacientes verificados).`
    ].filter(Boolean)
  };

  try {
    const gemKey = Deno.env.get('GEMINI_API_KEY') || '';
    if (gemKey) {
      const prompt = `Eres analista experto para clínicas estéticas. Datos del día: ${JSON.stringify({risk: riskLeads?.length||0, top: processedRanking, doc: doctoraliaSummary})}. Da 3 insights clave y 2 acciones concretas para mañana.`;
      const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${gemKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 350 } })
      });
      if (gRes.ok) {
        const gData = await gRes.json();
        dailyInsights.ai_summary = gData.candidates?.[0]?.content?.parts?.[0]?.text || '';
      }
    }
    // Persist as daily agent output (system or first user for visibility)
    const { data: sysU } = await getSupabase().from('users').select('id').limit(1).single();
    if (sysU) {
      await getSupabase().from('agent_outputs').insert({
        user_id: sysU.id,
        agent_type: 'daily-insight',
        input_context: { date: today, source: 'daily-aggregates' },
        output_text: JSON.stringify(dailyInsights),
        status: 'completed'
      });
    }
  } catch (aiE) {
    console.warn('[daily-aggregates] daily AI insight failed (using rules):', aiE);
  }

  console.log('[daily-aggregates] ✅ Tareas diarias completadas')
  return new Response(JSON.stringify({
    success: true,
    tasks: {
      riskLeadsCount: riskLeads?.length || 0,
      topCampaigns: processedRanking,
      doctoraliaSummary,
      dailyInsights
    }
  }), { 
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
})
