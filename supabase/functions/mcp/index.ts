import { createClient } from '@supabase/supabase-js'
import { Hono } from 'hono'
import { McpServer, StreamableHttpTransport } from 'mcp-lite'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'

const app = new Hono()

const mcp = new McpServer({
  name: 'nuvanx-mcp',
  version: '1.0.0',
  schemaAdapter: (schema) =>
    zodToJsonSchema(schema as z.ZodType, {
      target: 'jsonSchema7',
      $refStrategy: 'none',
    }),
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

function errorContent(userMessage: string) {
  return {
    content: [{ type: 'text' as const, text: `Error: ${userMessage}` }],
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
  const prefix = authorization.slice(0, 7)

  if (prefix.toLowerCase() === 'bearer ') {
    return authorization.slice(7).trim()
  }

  return authorization.trim()
}

function isAuthorized(request: Request): boolean {
  const providedKey = request.headers.get('x-api-key')?.trim() || getBearerToken(request)
  const expectedApiKey = Deno.env.get('MCP_API_KEY')?.trim()
  if (!expectedApiKey) return false
  return providedKey === expectedApiKey
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
    if (firstError) {
      console.error('[get_dashboard_metrics] Supabase error', firstError)
      return errorContent('Database error while fetching dashboard metrics')
    }

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
    if (error) {
      console.error('[get_leads] Supabase error', error)
      return errorContent('Database error while fetching leads')
    }
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
    if (error) {
      console.error('[get_meta_campaign_insights] Supabase error', error)
      return errorContent('Database error while fetching Meta campaign insights')
    }
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
    if (error) {
      console.error('[search_leads] Supabase error', error)
      return errorContent('Database error while searching leads')
    }
    return jsonContent(data)
  },
})

// ==================== NUEVAS TOOLS (08-05-2026) ====================

// 7. Leads en riesgo (>14 días en "Nuevo")
mcp.tool('get_risk_leads', {
  description: 'Obtiene leads que llevan más de 14 días en etapa "Nuevo" (riesgo de pérdida)',
  inputSchema: z.object({
    clinic_id: z.string().uuid().optional(),
    limit: LimitSchema,
  }),
  handler: async ({ clinic_id, limit }) => {
    let query = supabase
      .from('leads')
      .select('id, name, phone, email, stage, created_at, clinic_id')
      .eq('stage', 'Nuevo')
      .lt('created_at', new Date(Date.now() - 14 * 86400000).toISOString())
      .neq('source', 'doctoralia')
      .order('created_at', { ascending: true })

    if (clinic_id) query = query.eq('clinic_id', clinic_id)

    const { data, error } = await query.limit(limit)
    if (error) {
      console.error('[get_risk_leads] Supabase error', error)
      return errorContent('Database error while fetching risk leads')
    }

    return jsonContent(data)
  },
})

// 8. Top campañas por revenue (últimos 7 días)
mcp.tool('get_top_campaigns', {
  description: 'Top 5 campañas por revenue verificado en los últimos 7 días',
  inputSchema: z.object({
    clinic_id: z.string().uuid().optional(),
  }),
  handler: async ({ clinic_id }) => {
    let query = supabase
      .from('financial_settlements')
      .select('campaign_name, amount_net')
      .gte('settled_at', new Date(Date.now() - 7 * 86400000).toISOString())
      .eq('source_system', 'doctoralia') // solo revenue real

    if (clinic_id) query = query.eq('clinic_id', clinic_id)

    const { data, error } = await query
    if (error) {
      console.error('[get_top_campaigns] Supabase error', error)
      return errorContent('Database error while fetching top campaigns')
    }

    const revenueByCampaign = (data || []).reduce((acc: Record<string, number>, curr: any) => {
      const name = curr.campaign_name || 'Sin nombre'
      acc[name] = (acc[name] || 0) + Number(curr.amount_net || 0)
      return acc
    }, {})

    const processedRanking = Object.entries(revenueByCampaign)
      .map(([campaign_name, revenue]) => ({ campaign_name, revenue }))
      .sort((a, b) => (b.revenue as number) - (a.revenue as number))
      .slice(0, 5)

    return jsonContent(processedRanking)
  },
})

// 9. Leads por etapa
mcp.tool('get_leads_by_stage', {
  description: 'Conteo de leads por etapa (funnel)',
  inputSchema: z.object({
    clinic_id: z.string().uuid().optional(),
    date_from: DateSchema.optional(),
  }),
  handler: async ({ clinic_id, date_from }) => {
    let query = supabase
      .from('leads')
      .select('stage')
      .is('deleted_at', null)
      .neq('source', 'doctoralia')

    if (clinic_id) query = query.eq('clinic_id', clinic_id)
    if (date_from) query = query.gte('created_at', date_from)

    const { data, error } = await query
    if (error) {
      console.error('[get_leads_by_stage] Supabase error', error)
      return errorContent('Database error while fetching leads by stage')
    }

    const counts = (data || []).reduce((acc: any, row: any) => {
      const stage = row.stage || 'lead'
      acc[stage] = (acc[stage] || 0) + 1
      return acc
    }, {})

    return jsonContent(counts)
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
  // === API KEY AUTHENTICATION ===
  const providedKey = c.req.header('x-api-key') ||
                      c.req.header('authorization')?.replace(/^Bearer\s+/i, '')
  const expectedKey = Deno.env.get('MCP_API_KEY')

  if (!expectedKey || providedKey !== expectedKey) {
    console.warn('[MCP] Unauthorized request')
    return c.json({ error: 'Unauthorized - Invalid or missing API Key' }, 401)
  }

  const response = await httpHandler(c.req.raw)
  return response
})

app.route('/mcp', mcpApp)

Deno.serve(app.fetch)
