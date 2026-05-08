// supabase/functions/daily-aggregates/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

Deno.serve(async (req) => {
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

  if (riskLeads && riskLeads.length > 0) {
    console.log(`[daily-aggregates] ⚠️ ${riskLeads.length} leads en riesgo (>14 días en Nuevo)`)
    // Aquí podrías insertar en una tabla de alertas si existe
  }

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

    console.log('[daily-aggregates] Top 5 campañas esta semana:', processedRanking)
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

  console.log('[daily-aggregates] Revenue Doctoralia hoy:', doctoraliaSummary)

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
