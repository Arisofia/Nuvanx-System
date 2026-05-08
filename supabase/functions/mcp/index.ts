import { createClient } from '@supabase/supabase-js'
import { Hono } from 'hono'
import { McpServer, StreamableHttpTransport } from 'mcp-lite'
import { z } from 'zod'

const app = new Hono()

const mcp = new McpServer({
  name: 'nuvanx-mcp',
  version: '1.0.0',
  schemaAdapter: (schema) => z.toJSONSchema(schema as z.ZodType),
})

function requireEnv(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

const supabase = createClient(
  requireEnv('SUPABASE_URL'),
  requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false } },
)

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
const LimitSchema = z.number().int().min(1).max(200).default(50)

function jsonContent(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value ?? [], null, 2) }],
  }
}

function errorContent(message: string) {
  return {
    content: [{ type: 'text' as const, text: `Error: ${message}` }],
    isError: true,
  }
}

function escapeIlikeTerm(rawQuery: string): string {
  return rawQuery
    .trim()
    .replace(/[(),]/g, ' ')
    .replace(/[%_]/g, (match) => `\\${match}`)
    .replace(/\s+/g, ' ')
}

function getBearerToken(request: Request): string {
  const authorization = request.headers.get('authorization') ?? ''
  return authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : ''
}

function isAuthorized(request: Request): boolean {
  const expectedApiKey = Deno.env.get('MCP_API_KEY')?.trim()
  if (!expectedApiKey) return true
  return getBearerToken(request) === expectedApiKey
}

mcp.tool('get_dashboard_metrics', {
  description: 'Returns dashboard KPI metrics from real Nuvanx production tables: leads, financial settlements, integrations, and Meta insights.',
  inputSchema: z.object({
    clinic_id: z.string().uuid().optional().describe('Clinic UUID. When omitted, aggregates all clinics available to the service role.'),
    date_from: DateSchema.optional().describe('Start date in YYYY-MM-DD format.'),
    date_to: DateSchema.optional().describe('End date in YYYY-MM-DD format.'),
  }),
  handler: async ({ clinic_id, date_from, date_to }) => {
    let leadsQuery = supabase
      .from('leads')
      .select('id,stage,source,revenue,converted_patient_id,created_at')
      .is('deleted_at', null)

    if (clinic_id) leadsQuery = leadsQuery.eq('clinic_id', clinic_id)
    if (date_from) leadsQuery = leadsQuery.gte('created_at', date_from)
    if (date_to) leadsQuery = leadsQuery.lte('created_at', date_to)

    let settlementsQuery = supabase
      .from('financial_settlements')
      .select('amount_net,cancelled_at,settled_at')
      .is('cancelled_at', null)

    if (clinic_id) settlementsQuery = settlementsQuery.eq('clinic_id', clinic_id)
    if (date_from) settlementsQuery = settlementsQuery.gte('settled_at', date_from)
    if (date_to) settlementsQuery = settlementsQuery.lte('settled_at', date_to)

    let metaQuery = supabase
      .from('meta_daily_insights')
      .select('spend,impressions,clicks,conversions,date')

    if (clinic_id) metaQuery = metaQuery.eq('clinic_id', clinic_id)
    if (date_from) metaQuery = metaQuery.gte('date', date_from)
    if (date_to) metaQuery = metaQuery.lte('date', date_to)

    const integrationsQuery = clinic_id
      ? supabase.from('integrations').select('service,status,clinic_id').eq('clinic_id', clinic_id)
      : supabase.from('integrations').select('service,status,clinic_id')

    const [leadsRes, settlementsRes, integrationsRes, metaRes] = await Promise.all([
      leadsQuery.limit(5000),
      settlementsQuery.limit(5000),
      integrationsQuery.limit(5000),
      metaQuery.limit(5000),
    ])

    const firstError = leadsRes.error ?? settlementsRes.error ?? integrationsRes.error ?? metaRes.error
    if (firstError) return errorContent(firstError.message)

    const leads = leadsRes.data ?? []
    const settlements = settlementsRes.data ?? []
    const integrations = integrationsRes.data ?? []
    const metaRows = metaRes.data ?? []

    const byStage = leads.reduce<Record<string, number>>((acc, lead) => {
      const key = String(lead.stage ?? 'unknown')
      acc[key] = (acc[key] ?? 0) + 1
      return acc
    }, {})

    const bySource = leads.reduce<Record<string, number>>((acc, lead) => {
      const key = String(lead.source ?? 'unknown')
      acc[key] = (acc[key] ?? 0) + 1
      return acc
    }, {})

    const totalLeads = leads.length
    const conversions = leads.filter((lead) => ['treatment', 'closed'].includes(String(lead.stage))).length
    const verifiedRevenue = settlements.reduce((sum, row) => sum + Number(row.amount_net ?? 0), 0)
    const metaSpend = metaRows.reduce((sum, row) => sum + Number(row.spend ?? 0), 0)
    const metaConversions = metaRows.reduce((sum, row) => sum + Number(row.conversions ?? 0), 0)
    const metaClicks = metaRows.reduce((sum, row) => sum + Number(row.clicks ?? 0), 0)
    const metaImpressions = metaRows.reduce((sum, row) => sum + Number(row.impressions ?? 0), 0)

    return jsonContent({
      period: { date_from: date_from ?? null, date_to: date_to ?? null },
      clinic_id: clinic_id ?? null,
      leads: {
        total: totalLeads,
        conversions,
        conversion_rate_pct: totalLeads > 0 ? Number(((conversions / totalLeads) * 100).toFixed(1)) : 0,
        patient_matches: leads.filter((lead) => lead.converted_patient_id != null).length,
        by_stage: byStage,
        by_source: bySource,
      },
      revenue: {
        verified: Number(verifiedRevenue.toFixed(2)),
        settlements_count: settlements.length,
      },
      integrations: {
        connected: integrations.filter((integration) => integration.status === 'connected').length,
        total: integrations.length,
      },
      meta: {
        spend: Number(metaSpend.toFixed(2)),
        conversions: metaConversions,
        impressions: metaImpressions,
        clicks: metaClicks,
        cpl: metaConversions > 0 ? Number((metaSpend / metaConversions).toFixed(2)) : null,
        cpc: metaClicks > 0 ? Number((metaSpend / metaClicks).toFixed(2)) : null,
      },
    })
  },
})

mcp.tool('get_leads', {
  description: 'Returns CRM leads with optional filters for clinic, stage, source, and creation date.',
  inputSchema: z.object({
    clinic_id: z.string().uuid().optional(),
    stage: z.string().min(1).max(64).optional(),
    source: z.string().min(1).max(64).optional(),
    date_from: DateSchema.optional(),
    date_to: DateSchema.optional(),
    limit: LimitSchema,
  }),
  handler: async ({ clinic_id, stage, source, date_from, date_to, limit }) => {
    let query = supabase
      .from('leads')
      .select('id,clinic_id,user_id,name,email,phone,source,stage,revenue,created_at,updated_at,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })

    if (clinic_id) query = query.eq('clinic_id', clinic_id)
    if (stage) query = query.eq('stage', stage)
    if (source) query = query.eq('source', source)
    if (date_from) query = query.gte('created_at', date_from)
    if (date_to) query = query.lte('created_at', date_to)

    const { data, error } = await query.limit(limit)
    if (error) return errorContent(error.message)
    return jsonContent(data)
  },
})

mcp.tool('get_meta_campaign_insights', {
  description: 'Returns cached Meta Ads daily insights from the production meta_daily_insights table.',
  inputSchema: z.object({
    clinic_id: z.string().uuid().optional(),
    ad_account_id: z.string().min(1).max(32).optional(),
    date_from: DateSchema.optional(),
    date_to: DateSchema.optional(),
    limit: z.number().int().min(1).max(500).default(100),
  }),
  handler: async ({ clinic_id, ad_account_id, date_from, date_to, limit }) => {
    let query = supabase
      .from('meta_daily_insights')
      .select('clinic_id,user_id,ad_account_id,date,impressions,reach,clicks,spend,conversions,ctr,cpc,cpm,messaging_conversations,updated_at')
      .order('date', { ascending: false })

    if (clinic_id) query = query.eq('clinic_id', clinic_id)
    if (ad_account_id) query = query.eq('ad_account_id', ad_account_id)
    if (date_from) query = query.gte('date', date_from)
    if (date_to) query = query.lte('date', date_to)

    const { data, error } = await query.limit(limit)
    if (error) return errorContent(error.message)
    return jsonContent(data)
  },
})

mcp.tool('search_leads', {
  description: 'Searches active leads by name, phone, or email.',
  inputSchema: z.object({
    query: z.string().min(1).max(120),
    clinic_id: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(100).default(30),
  }),
  handler: async ({ query, clinic_id, limit }) => {
    const term = escapeIlikeTerm(query)
    if (!term) return jsonContent([])

    let sqlQuery = supabase
      .from('leads')
      .select('id,clinic_id,user_id,name,email,phone,source,stage,revenue,created_at,updated_at')
      .is('deleted_at', null)
      .or(`name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`)
      .order('created_at', { ascending: false })

    if (clinic_id) sqlQuery = sqlQuery.eq('clinic_id', clinic_id)

    const { data, error } = await sqlQuery.limit(limit)
    if (error) return errorContent(error.message)
    return jsonContent(data)
  },
})

const transport = new StreamableHttpTransport()
const httpHandler = transport.bind(mcp)
const mcpApp = new Hono()

mcpApp.get('/', (c) => c.json({
  name: 'Nuvanx MCP Server',
  version: '1.0.0',
  endpoints: { mcp: '/mcp', health: '/health' },
}))

mcpApp.get('/health', (c) => c.json({
  status: 'ok',
  timestamp: new Date().toISOString(),
  auth: Deno.env.get('MCP_API_KEY')?.trim() ? 'bearer' : 'disabled',
}))

mcpApp.all('/mcp', async (c) => {
  if (!isAuthorized(c.req.raw)) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  return await httpHandler(c.req.raw)
})

app.route('/mcp', mcpApp)

Deno.serve(app.fetch)
