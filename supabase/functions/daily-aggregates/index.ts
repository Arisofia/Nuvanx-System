/// <reference lib="deno.ns" />
// supabase/functions/daily-aggregates/index.ts
import { createClient } from '@supabase/supabase-js'
import { ENCRYPTION_KEY, META_APP_SECRET, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from '../_shared/config.ts'

const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!)

// ── Encryption Helpers ──────────────────────────────────────────────────────
function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(hex.length >>> 1);
  const arr = new Uint8Array(buf);
  for (let i = 0; i < hex.length; i += 2) arr[i >>> 1] = Number.parseInt(hex.slice(i, i + 2), 16);
  return arr;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function encodeBufferSource(value: string): ArrayBuffer {
  return toArrayBuffer(new TextEncoder().encode(value));
}

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
  const { data: credentials } = await supabase
    .from('credentials')
    .select('*')
    .eq('provider', 'meta')
    .is('deleted_at', null);

  if (!credentials) return { rowsInserted: 0 };

  let totalRows = 0;
  const untilDate = new Date().toISOString().slice(0, 10);
  const sinceDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  for (const cred of credentials) {
    try {
      const accessToken = await decryptCred(cred.access_token);
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
          conversions: actionValue(r.actions, (t) => t.includes('lead') || t.includes('conversion')),
          ctr: Number(r.ctr || 0),
          cpc: Number(r.cpc || 0),
          cpm: Number(r.cpm || 0),
          messaging_conversations: actionValue(r.actions, (t) => t.includes('messaging') || t.includes('conversation')),
          updated_at: new Date().toISOString(),
        }));

        if (rows.length > 0) {
          const { error } = await supabase.from('meta_daily_insights').upsert(rows, { onConflict: 'clinic_id,ad_account_id,date' });
          if (error) console.error(`Error upserting insights for ${adAccountId}:`, error);
          else totalRows += rows.length;
        }
      }
    } catch (err) {
      console.error(`Failed to process credentials for user ${cred.user_id}:`, err);
    }
  }
  return { rowsInserted: totalRows };
}

type DailyAggregatesRequest = {
  action?: string;
  days?: number;
};

Deno.serve(async (req: Request) => {
  const body = (await req.json().catch((): DailyAggregatesRequest => ({}))) as DailyAggregatesRequest;
  const { action, days = 2 } = body;

  if (action === 'fetch_meta_insights') {
    console.log(`[Daily] Fetching Meta insights for last ${days} days`);
    const result = await fetchAllClinicsMetaInsights(days);
    return new Response(JSON.stringify({ 
      success: true, 
      message: `Meta insights actualizados: ${result.rowsInserted} registros` 
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // Fallback to existing logic if no action is provided (for legacy compatibility)
  console.log('[daily-aggregates] Iniciando tareas diarias...')

  const today = new Date().toISOString().slice(0, 10)
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)

  // ============================================
  // TAREA 1: Leads en riesgo (>14 días en "Nuevo")
  // ============================================
  const { data: riskLeads } = await supabase
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
  const { data: campaignRanking } = await supabase
    .from('financial_settlements')
    .select('campaign_name, amount_net')
    .gte('settled_at', new Date(Date.now() - 7 * 86400000).toISOString())
    .neq('source_system', 'doctoralia') // solo campañas de marketing

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
  const { data: settlementsToday } = await supabase
    .from('financial_settlements')
    .select('amount_net')
    .eq('source_system', 'doctoralia')
    .gte('settled_at', today)

  const doctoraliaSummary = {
    total_revenue: settlementsToday?.reduce((sum, s) => sum + Number(s.amount_net || 0), 0) || 0,
    total_patients: settlementsToday?.length || 0
  }

  console.log('[daily-aggregates] ✅ Tareas diarias completadas')
  return new Response(JSON.stringify({
    success: true,
    tasks: {
      riskLeadsCount: riskLeads?.length || 0,
      topCampaigns: processedRanking,
      doctoraliaSummary
    }
  }), { 
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
})
