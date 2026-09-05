/// <reference lib="deno.ns" />
import { createClient } from '@supabase/supabase-js'
import { ENCRYPTION_KEY, META_APP_SECRET, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from '../_shared/config.ts'
import { numberInput } from './normalize.ts'
import { resolveMetaDateRange, type MetaDateRangeInput } from './date-range.ts'
import { hasServiceRoleBearer, secretMatches } from './request-auth.ts'

type MetaAction = {
  action_type?: string
  value?: number
}

type MetaInsightRow = {
  date_start: string
  impressions?: number
  reach?: number
  clicks?: number
  spend?: number
  ctr?: number
  cpc?: number
  cpm?: number
  actions?: MetaAction[]
}

type MetaInsightsResponse = {
  data: MetaInsightRow[]
}

type CredentialRow = {
  user_id: string | null
  clinic_id: string | null
  service: string | null
  encrypted_key: string
  metadata: unknown
}

type IngestFailure = {
  clinic_id: string | null
  ad_account_id: string | null
  message: string
}

type DailyAggregatesRequest = MetaDateRangeInput & {
  action?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeMetaAction(value: unknown): MetaAction | null {
  if (!isRecord(value)) return null
  const actionType = typeof value.action_type === 'string' ? value.action_type : undefined
  const actionValue = numberInput(value.value)
  if (actionType === undefined && actionValue === undefined) return null
  return { action_type: actionType, value: actionValue }
}

function normalizeMetaInsightRow(value: unknown): MetaInsightRow | null {
  if (!isRecord(value) || typeof value.date_start !== 'string') return null
  const actions = Array.isArray(value.actions)
    ? value.actions.map(normalizeMetaAction).filter((action): action is MetaAction => action !== null)
    : undefined
  return {
    date_start: value.date_start,
    impressions: numberInput(value.impressions),
    reach: numberInput(value.reach),
    clicks: numberInput(value.clicks),
    spend: numberInput(value.spend),
    ctr: numberInput(value.ctr),
    cpc: numberInput(value.cpc),
    cpm: numberInput(value.cpm),
    actions,
  }
}

function normalizeMetaInsightsResponse(value: unknown): MetaInsightsResponse {
  if (!isRecord(value) || !Array.isArray(value.data)) return { data: [] }
  return {
    data: value.data.map(normalizeMetaInsightRow).filter((row): row is MetaInsightRow => row !== null),
  }
}

function externalErrorMessage(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.error)) return undefined
  return typeof value.error.message === 'string' ? value.error.message : undefined
}

function adAccountIdsFromMetadata(metadata: unknown): string[] {
  if (!isRecord(metadata)) return []
  if (Array.isArray(metadata.ad_account_ids)) {
    return metadata.ad_account_ids.map((id) => String(id ?? '').trim()).filter(Boolean)
  }
  if (typeof metadata.ad_account_id === 'string' && metadata.ad_account_id.trim()) {
    return [metadata.ad_account_id.trim()]
  }
  return []
}

function createSupabaseAdminClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured for daily-aggregates.')
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
}

let supabaseInstance: ReturnType<typeof createSupabaseAdminClient> | null = null
function getSupabase() {
  if (!supabaseInstance) supabaseInstance = createSupabaseAdminClient()
  return supabaseInstance
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(hex.length >>> 1)
  const arr = new Uint8Array(buf)
  for (let i = 0; i < hex.length; i += 2) arr[i >>> 1] = Number.parseInt(hex.slice(i, i + 2), 16)
  return arr
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function encodeBufferSource(value: string): ArrayBuffer {
  return toArrayBuffer(new TextEncoder().encode(value))
}

async function decryptCred(encoded: string): Promise<string> {
  const masterKey = ENCRYPTION_KEY
  if (!masterKey) throw new Error('ENCRYPTION_KEY not set')
  const parts = encoded.split(':')
  if (parts.length !== 4) throw new Error('malformed ciphertext')
  const [saltH, ivH, tagH, ctH] = parts
  const salt = hexToBytes(saltH)
  const iv = hexToBytes(ivH)
  const tag = hexToBytes(tagH)
  const ct = hexToBytes(ctH)
  const combined = new Uint8Array(ct.length + tag.length)
  combined.set(ct)
  combined.set(tag, ct.length)
  const km = await crypto.subtle.importKey('raw', encodeBufferSource(masterKey), 'PBKDF2', false, ['deriveKey'])
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: toArrayBuffer(salt), iterations: 100_000, hash: 'SHA-256' },
    km,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  )
  return new TextDecoder().decode(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, aesKey, toArrayBuffer(combined)),
  )
}

const META_GRAPH_VERSION = Deno.env.get('META_GRAPH_VERSION') || 'v22.0'
const META_GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`
const META_CANONICAL_APP_SECRET = Deno.env.get('META_CANONICAL_APP_SECRET') ?? Deno.env.get('META_REPORTING_APP_SECRET') ?? ''

function metaAppSecretForService(service: string): string | null | undefined {
  return service === 'meta_ads' ? META_CANONICAL_APP_SECRET : META_APP_SECRET
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function computeAppsecretProof(accessToken: string, appSecret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encodeBufferSource(appSecret), 'HMAC', false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encodeBufferSource(accessToken)))
  return bytesToHex(sig)
}

async function metaFetch(
  path: string,
  params: Record<string, string>,
  token: string,
  appSecretOverride?: string | null,
): Promise<MetaInsightsResponse> {
  const url = new URL(`${META_GRAPH}${path}`)
  url.searchParams.set('access_token', token)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const appSecret = appSecretOverride === undefined ? META_APP_SECRET : appSecretOverride
  if (appSecret) {
    url.searchParams.set('appsecret_proof', await computeAppsecretProof(token, appSecret))
  }
  const r = await fetch(url.toString())
  const payload: unknown = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(externalErrorMessage(payload) || `Meta API ${r.status}`)
  return normalizeMetaInsightsResponse(payload)
}

function actionValue(actions: readonly MetaAction[] | null | undefined, matcher: (t: string) => boolean): number {
  if (!Array.isArray(actions)) return 0
  return actions.reduce((sum, action) => matcher(action.action_type || '') ? sum + Number(action.value || 0) : sum, 0)
}

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function fetchAllClinicsMetaInsights(range: { since: string; until: string }) {
  const sb = getSupabase()
  const { data: credentials, error: credentialsError } = await sb
    .from('credentials')
    .select('user_id,clinic_id,service,encrypted_key,metadata')
    .in('service', ['meta', 'meta_ads'])

  if (credentialsError) {
    throw new Error(`Failed to load Meta credentials: ${credentialsError.message}`)
  }
  if (!credentials?.length) return { rowsInserted: 0, failures: [] as IngestFailure[] }

  let totalRows = 0
  const failures: IngestFailure[] = []

  for (const raw of credentials) {
    const cred = raw as CredentialRow
    const clinicId = cred.clinic_id
    try {
      const accessToken = await decryptCred(cred.encrypted_key)
      const appSecret = metaAppSecretForService(String(cred.service ?? 'meta'))
      const adAccountIds = adAccountIdsFromMetadata(cred.metadata)
      if (adAccountIds.length === 0) {
        failures.push({ clinic_id: clinicId, ad_account_id: null, message: 'credential has no ad account ids' })
        continue
      }

      for (const adAccountId of adAccountIds) {
        try {
          const insights = await metaFetch(`/${adAccountId}/insights`, {
            fields: 'date_start,impressions,reach,clicks,spend,ctr,cpc,cpm,actions',
            time_range: JSON.stringify({ since: range.since, until: range.until }),
            time_increment: '1',
            limit: '1000',
          }, accessToken, appSecret)

          const rows = insights.data.map((row) => ({
            user_id: cred.user_id,
            clinic_id: clinicId,
            ad_account_id: adAccountId,
            date: row.date_start,
            impressions: Math.round(Number(row.impressions || 0)),
            reach: Math.round(Number(row.reach || 0)),
            clicks: Math.round(Number(row.clicks || 0)),
            spend: Number(row.spend || 0),
            conversions: actionValue(row.actions, (t) => t.includes('lead') || t.includes('conversion') || t.includes('complete_registration')),
            ctr: Number(row.ctr || 0),
            cpc: Number(row.cpc || 0),
            cpm: Number(row.cpm || 0),
            messaging_conversations: actionValue(row.actions, (t) => t.includes('messaging') || t.includes('conversation')),
            updated_at: new Date().toISOString(),
          }))

          if (rows.length === 0) continue

          const { error } = await getSupabase()
            .from('meta_daily_insights')
            .upsert(rows, { onConflict: 'clinic_id,ad_account_id,date' })
          if (error) {
            failures.push({ clinic_id: clinicId, ad_account_id: adAccountId, message: error.message })
            continue
          }
          totalRows += rows.length
        } catch (err) {
          failures.push({
            clinic_id: clinicId,
            ad_account_id: adAccountId,
            message: err instanceof Error ? err.message : 'account ingest failed',
          })
        }
      }
    } catch (err) {
      failures.push({
        clinic_id: clinicId,
        ad_account_id: null,
        message: err instanceof Error ? err.message : 'credential ingest failed',
      })
    }
  }

  return { rowsInserted: totalRows, failures }
}

async function handleMetaDailyInsights(input: MetaDateRangeInput = {}) {
  try {
    const range = resolveMetaDateRange(input)
    const result = await fetchAllClinicsMetaInsights(range)
    if (result.failures.length > 0) {
      return json({
        success: false,
        kind: 'provider_error',
        message: `Meta insights ingest incomplete: ${result.failures.length} failure(s)`,
        rowsInserted: result.rowsInserted,
        failures: result.failures,
        range,
      }, 502)
    }
    return json({
      success: true,
      message: `Meta insights updated: ${result.rowsInserted} rows`,
      rowsInserted: result.rowsInserted,
      range,
    }, 200)
  } catch (error) {
    return json({
      success: false,
      kind: 'ingest_error',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500)
  }
}

Deno.serve(async (req: Request) => {
  const authorizedByServiceRole = hasServiceRoleBearer(req, SUPABASE_SERVICE_ROLE_KEY)
  const internalSecretHeader = String(req.headers.get('x-nvx-internal-secret') || '').trim()
  let authorizedByInternalSecret = false

  if (!authorizedByServiceRole && internalSecretHeader) {
    const { data: expectedInternalSecret, error: internalSecretError } = await getSupabase().rpc('nvx_get_runtime_secret', {
      p_name: 'REVOPS_INTERNAL_SECRET',
    })

    if (internalSecretError || !expectedInternalSecret) {
      return json({ success: false, error: 'Server configuration error' }, 500)
    }

    authorizedByInternalSecret = await secretMatches(
      internalSecretHeader,
      String(expectedInternalSecret),
    )
  }

  if (!authorizedByServiceRole && !authorizedByInternalSecret) {
    return json({ success: false, error: 'Forbidden' }, 403)
  }

  const body = (await req.json().catch((): DailyAggregatesRequest => ({}))) as DailyAggregatesRequest
  const { action } = body

  if (action === 'fetch_meta_insights' || action === 'meta-daily-insights') {
    return await handleMetaDailyInsights(body)
  }

  return json({ success: false, error: 'Unsupported action' }, 422)
})
