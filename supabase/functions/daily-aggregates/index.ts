import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
)

Deno.serve(async (req) => {
  // Authorization check
  const authHeader = req.headers.get('Authorization')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  
  if (authHeader !== `Bearer ${serviceRoleKey}`) {
    console.error('[daily-aggregates] Unauthorized access attempt')
    return new Response('Unauthorized', { status: 401 })
  }

  console.log('[daily-aggregates] Starting daily batch...')

  try {
    // 1. Detect leads at risk (>14 days in 'lead' stage)
    const fourteenDaysAgo = new Date()
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)
    
    const { data: atRiskLeads, error: atRiskError } = await supabase
      .from('leads')
      .select('id, name, created_at, user_id')
      .eq('stage', 'lead')
      .lt('created_at', fourteenDaysAgo.toISOString())
      .limit(100)

    if (atRiskError) throw atRiskError
    console.log(`[daily-aggregates] Found ${atRiskLeads?.length || 0} leads at risk (>14 days in 'lead' stage)`)

    // 2. Recalculate/Log Campaign Rankings (Top 5 by lead count)
    // Using a simplified query approach since get_campaign_roi requires a user_id
    const { data: rankings, error: rankingsError } = await supabase
      .from('leads')
      .select('source, id')
      .not('source', 'is', null)

    let topCampaigns: Record<string, number> = {}
    if (!rankingsError && rankings) {
      rankings.forEach(lead => {
        topCampaigns[lead.source] = (topCampaigns[lead.source] || 0) + 1
      })
    }
    
    const sortedRankings = Object.entries(topCampaigns)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)

    console.log('[daily-aggregates] Top 5 Campaigns by lead count:', sortedRankings)
    
    console.log('[daily-aggregates] Completed successfully')
    return new Response(JSON.stringify({ 
      status: 'success', 
      tasks: {
        at_risk_leads_count: atRiskLeads?.length || 0,
        top_campaigns: sortedRankings
      },
      timestamp: new Date().toISOString()
    }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200
    })
  } catch (error) {
    console.error('[daily-aggregates] Error:', error)
    return new Response(JSON.stringify({ 
      status: 'error', 
      error: error.message 
    }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500
    })
  }
})
