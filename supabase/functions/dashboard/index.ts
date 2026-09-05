/**
 * Dashboard Edge Function (upgraded)
 * Returns real KPIs from:
 * - leads table (CRM funnel)
 * - financial_settlements (Doctoralia revenue)
 * - patients (Doctoralia patients)
 * - meta_attribution (Meta campaign data)
 * - agent_outputs (AI analysis log)
 */
import { createClient } from '@supabase/supabase-js';
import { buildCorsHeaders } from '../_shared/config.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const anonKey     = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const MAX_ROWS = 500;

type TemplateBreakdown = Record<string, { count: number; revenue: number }>;

async function getAuthUser(req: Request) {
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return null;
  const client = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await client.auth.getUser();
  return user;
}

Deno.serve(async (req: Request) => {
  const cors = buildCorsHeaders(req.headers.get('Origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  const user = await getAuthUser(req);
  if (!user) return json({ success: false, message: 'Unauthorized' }, 401);

  const supabase = createClient(supabaseUrl, serviceKey);
  const userId   = user.id;

  const { data: owner, error: ownerError } = await supabase
    .from('users')
    .select('clinic_id')
    .eq('id', userId)
    .maybeSingle();
  if (ownerError) return json({ success: false, message: 'Failed to fetch user context' }, 500);
  const clinicId = owner?.clinic_id ?? null;

  // === REAL DATA ONLY - proper multi-tenant scoping (matching main api router patterns) ===
  let leadsQuery = supabase.from('leads')
    .select('id, user_id, clinic_id, stage, revenue, source, created_at')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .neq('source', 'doctoralia')
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS);

  if (clinicId) leadsQuery = leadsQuery.eq('clinic_id', clinicId);

  let settlementsQuery = supabase.from('financial_settlements')
    .select('id, clinic_id, amount_net, amount_gross, amount_discount, settled_at, created_at, template_name, patient_name')
    .limit(MAX_ROWS);
  if (clinicId) {
    settlementsQuery = settlementsQuery.eq('clinic_id', clinicId);
  } else {
    settlementsQuery = settlementsQuery.limit(0);
  }
  settlementsQuery = settlementsQuery.order('settled_at', { ascending: false });

  let patientsQuery = supabase.from('patients')
    .select('id', { count: 'exact', head: true });
  if (clinicId) {
    patientsQuery = patientsQuery.eq('clinic_id', clinicId);
  } else {
    patientsQuery = patientsQuery.limit(0);
  }

  let metaQuery = supabase
    .from('meta_attribution')
    .select('leadgen_id, campaign_id, form_id, captured_at, leads!inner(user_id, clinic_id)')
    .eq('leads.user_id', userId)
    .order('captured_at', { ascending: false })
    .limit(MAX_ROWS);
  if (clinicId) metaQuery = metaQuery.eq('leads.clinic_id', clinicId);

  const [leadsRes, settlementsRes, patientsRes, integrationsRes, metaRes, agentRes] = await Promise.all([
    leadsQuery,
    settlementsQuery,
    patientsQuery,
    supabase.from('integrations').select('status').eq('user_id', userId),
    metaQuery,
    supabase.from('agent_outputs').select('id, agent_type, output_text, model_used, status, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(5)
  ]);

  const queryError = [leadsRes, settlementsRes, patientsRes, integrationsRes, metaRes, agentRes]
    .find((result) => result.error)?.error;
  if (queryError) {
    console.error('[Dashboard] Failed to load dashboard data:', queryError);
    return json({ success: false, message: 'Failed to load dashboard data' }, 500);
  }

  const leads       = leadsRes.data ?? [];
  const settlements = settlementsRes.data ?? [];
  const integrations = integrationsRes.data ?? [];
  const metaLeads   = metaRes.data ?? [];
  const agentOutputs = agentRes.data ?? [];

  // ── CRM metrics (from leads table)
  const totalLeads   = leads.length;
  const totalRevenue = leads.reduce((s, l) => s + (Number.parseFloat(l.revenue) || 0), 0);
  const conversions  = leads.filter(l => l.stage === 'treatment' || l.stage === 'closed').length;
  const conversionRate = totalLeads > 0 ? Number.parseFloat(((conversions / totalLeads) * 100).toFixed(1)) : 0;
  const STAGES       = ['lead','whatsapp','appointment','treatment','closed'];
  const byStage      = STAGES.reduce<Record<string, number>>((acc, s) => { acc[s] = leads.filter(l => l.stage === s).length; return acc; }, {});
  const connectedIntegrations = integrations.filter(i => i.status === 'connected').length;

  // ── Doctoralia metrics (from financial_settlements - real data)
  const docTotalNet   = settlements.reduce((s, r) => s + Number.parseFloat(r.amount_net ?? 0), 0);
  const docTotalGross = settlements.reduce((s, r) => s + Number.parseFloat(r.amount_gross ?? 0), 0);
  const docDiscount   = settlements.reduce((s, r) => s + Number.parseFloat(r.amount_discount ?? 0), 0);
  const avgTicket     = settlements.length > 0 ? docTotalNet / settlements.length : 0;
  const uniquePatients = patientsRes.count ?? 0;

  // Template breakdown
  const templateBreakdown = settlements.reduce<TemplateBreakdown>((acc, s) => {
    const key = s.template_name ?? 'Unknown';
    if (!acc[key]) acc[key] = { count: 0, revenue: 0 };
    acc[key].count++;
    acc[key].revenue = Number.parseFloat((acc[key].revenue + Number.parseFloat(s.amount_net ?? 0)).toFixed(2));
    return acc;
  }, {});

  // Settlement timeline for chart
  const settlementTimeline = settlements.map(s => ({
    date:     (s.settled_at ?? s.created_at ?? '').split('T')[0],
    net:      Number.parseFloat(s.amount_net ?? 0),
    template: s.template_name ?? '',
    patient:  s.patient_name ?? ''
  })).sort((a, b) => a.date.localeCompare(b.date));

  // ── Meta metrics
  const metaCampaigns = new Set(metaLeads.map(m => m.campaign_id).filter(Boolean)).size;
  const metaForms     = new Set(metaLeads.map(m => m.form_id).filter(Boolean)).size;

  // ── Agent outputs summary
  const agentSummary = agentOutputs.map(a => ({
    id:         a.id,
    agent_type: a.agent_type,
    preview:    (a.output_text ?? '').slice(0, 200),
    model:      a.model_used,
    status:     a.status,
    created_at: a.created_at
  }));

  return json({
    success: true,
    // Real CRM funnel data (properly scoped + filtered)
    metrics: {
      totalLeads,
      totalRevenue: Number.parseFloat(totalRevenue.toFixed(2)),
      conversions,
      conversionRate,
      byStage,
      connectedIntegrations,
      totalIntegrations: integrations.length
    },
    // Doctoralia revenue (REAL data - 6 settlements)
    doctoralia: {
      totalNet:       Number.parseFloat(docTotalNet.toFixed(2)),
      totalGross:     Number.parseFloat(docTotalGross.toFixed(2)),
      totalDiscount:  Number.parseFloat(docDiscount.toFixed(2)),
      avgTicket:      Number.parseFloat(avgTicket.toFixed(2)),
      uniquePatients,
      totalSettlements: settlements.length,
      templateBreakdown,
      timeline: settlementTimeline,
      lastSettlement: settlementTimeline.at(-1)?.date ?? null
    },
    // Real Meta acquisition data (from meta_attribution table)
    meta: {
      totalLeads:    metaLeads.length,
      uniqueCampaigns: metaCampaigns,
      uniqueForms:   metaForms,
      recentLeads:   metaLeads.slice(0, 10).map(m => ({
        leadgen_id:   m.leadgen_id,
        campaign_id:  m.campaign_id,
        form_id:      m.form_id,
        captured_at:  m.captured_at
      }))
    },
    // Agent AI outputs
    agentOutputs: agentSummary,
    // Legacy trend/funnel for backward compat (now uses real data)
    trend: settlementTimeline.map(s => ({
      month:   s.date,
      revenue: s.net,
      leads:   leads.filter(l => (l.created_at || '').startsWith(s.date)).length
    })),
    funnel: STAGES.map(stage => ({
      stage,
      label:      stage.charAt(0).toUpperCase() + stage.slice(1),
      count:      byStage[stage] ?? 0,
      percentage: Number.parseFloat(((byStage[stage] ?? 0) / (totalLeads || 1) * 100).toFixed(1)),
      revenue:    Number.parseFloat(leads.filter(l => l.stage === stage).reduce((s, l) => s + (Number.parseFloat(l.revenue) || 0), 0).toFixed(2))
    }))
  });
});
