-- Migration: create_figma_data_views
-- Description: Create views for Figma presentations using existing NUVANX tables
-- Date: 2026-06-07T18:00:00Z
-- Purpose: Provide dynamic Supabase integration for all presentations

-- ============================================================================
-- EXECUTIVE SUMMARY VIEW (for Presentación Ejecutiva)
-- ============================================================================
CREATE OR REPLACE VIEW v_figma_executive_summary AS
SELECT 
  'Leads (30d)' as metric,
  COUNT(*)::TEXT as value,
  'leads' as type
FROM leads
WHERE created_at >= NOW() - INTERVAL '30 days'
UNION ALL
SELECT 
  'Conversions (30d)' as metric,
  COUNT(*)::TEXT as value,
  'conversions' as type
FROM leads
WHERE crm_stage = 'converted'
  AND created_at >= NOW() - INTERVAL '30 days'
UNION ALL
SELECT 
  'Revenue (30d)' as metric,
  COALESCE(SUM(amount)::TEXT, '0') as value,
  'revenue' as type
FROM financial_settlements
WHERE settlement_date >= NOW() - INTERVAL '30 days'
UNION ALL
SELECT 
  'Active Channels' as metric,
  COUNT(DISTINCT utm_source)::TEXT as value,
  'channels' as type
FROM leads
WHERE created_at >= NOW() - INTERVAL '30 days';

GRANT SELECT ON v_figma_executive_summary TO authenticated;

-- ============================================================================
-- CAMPAIGN PERFORMANCE VIEW (for Auditoría Estratégica)
-- ============================================================================
CREATE OR REPLACE VIEW v_figma_campaign_performance AS
SELECT 
  COALESCE(utm_campaign, 'Direct') as campaign_name,
  COALESCE(utm_source, 'direct') as source,
  COALESCE(utm_medium, 'organic') as medium,
  COUNT(*) as total_leads,
  COUNT(*) FILTER (WHERE crm_stage = 'converted') as conversions,
  ROUND(COUNT(*) FILTER (WHERE crm_stage = 'converted')::NUMERIC / NULLIF(COUNT(*), 0) * 100, 2) as conversion_rate,
  COALESCE(SUM(fs.amount), 0) as total_revenue,
  MAX(l.created_at) as last_activity
FROM leads l
LEFT JOIN financial_settlements fs ON l.id = fs.lead_id
WHERE l.created_at >= NOW() - INTERVAL '90 days'
GROUP BY COALESCE(utm_campaign, 'Direct'), COALESCE(utm_source, 'direct'), COALESCE(utm_medium, 'organic')
ORDER BY total_leads DESC;

GRANT SELECT ON v_figma_campaign_performance TO authenticated;

-- ============================================================================
-- CHANNEL PERFORMANCE VIEW (for Auditoría Estratégica)
-- ============================================================================
CREATE OR REPLACE VIEW v_figma_channel_performance AS
SELECT 
  COALESCE(utm_source, 'direct') as channel,
  COUNT(*) as total_leads,
  COUNT(*) FILTER (WHERE crm_stage = 'converted') as conversions,
  ROUND(COUNT(*) FILTER (WHERE crm_stage = 'converted')::NUMERIC / NULLIF(COUNT(*), 0) * 100, 2) as conversion_rate,
  SUM(CASE WHEN crm_stage = 'converted' THEN 1 ELSE 0 END) as qualified_leads,
  DATE_TRUNC('day', MAX(created_at))::DATE as last_activity
FROM leads
WHERE created_at >= NOW() - INTERVAL '90 days'
GROUP BY COALESCE(utm_source, 'direct')
ORDER BY total_leads DESC;

GRANT SELECT ON v_figma_channel_performance TO authenticated;

-- ============================================================================
-- MONTHLY TREND VIEW (for Auditoría Estratégica)
-- ============================================================================
CREATE OR REPLACE VIEW v_figma_monthly_trend AS
SELECT 
  DATE_TRUNC('month', l.created_at)::DATE as month,
  COUNT(*) as leads,
  COUNT(*) FILTER (WHERE l.crm_stage = 'converted') as conversions,
  ROUND(COUNT(*) FILTER (WHERE l.crm_stage = 'converted')::NUMERIC / NULLIF(COUNT(*), 0) * 100, 2) as conversion_rate,
  COALESCE(SUM(fs.amount), 0) as revenue,
  COUNT(DISTINCT l.utm_source) as active_channels
FROM leads l
LEFT JOIN financial_settlements fs ON l.id = fs.lead_id
WHERE l.created_at >= NOW() - INTERVAL '12 months'
GROUP BY DATE_TRUNC('month', l.created_at)
ORDER BY month DESC;

GRANT SELECT ON v_figma_monthly_trend TO authenticated;

-- ============================================================================
-- DATA HEALTH VIEW (for Auditoría Estratégica)
-- ============================================================================
CREATE OR REPLACE VIEW v_figma_data_health AS
SELECT 
  'Leads' as metric,
  COUNT(*) as total_records,
  COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as records_7d,
  COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') as records_30d,
  MAX(created_at) as last_update
FROM leads
UNION ALL
SELECT 
  'Financial Settlements' as metric,
  COUNT(*) as total_records,
  COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as records_7d,
  COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') as records_30d,
  MAX(created_at) as last_update
FROM financial_settlements
UNION ALL
SELECT 
  'Doctoralia Patients' as metric,
  COUNT(*) as total_records,
  COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as records_7d,
  COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') as records_30d,
  MAX(created_at) as last_update
FROM doctoralia_patients
UNION ALL
SELECT 
  'Meta Attribution' as metric,
  COUNT(*) as total_records,
  COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as records_7d,
  COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') as records_30d,
  MAX(created_at) as last_update
FROM meta_attribution;

GRANT SELECT ON v_figma_data_health TO authenticated;

-- ============================================================================
-- DOCTORALIA PERFORMANCE VIEW (for Estrategia SEO/GEO)
-- ============================================================================
CREATE OR REPLACE VIEW v_figma_doctoralia_performance AS
SELECT 
  COUNT(*) as total_patients,
  COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') as new_patients_30d,
  COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as new_patients_7d,
  COUNT(DISTINCT DATE_TRUNC('month', created_at)::DATE) as months_active,
  MAX(created_at) as last_patient_date
FROM doctoralia_patients;

GRANT SELECT ON v_figma_doctoralia_performance TO authenticated;

-- ============================================================================
-- LEAD SOURCE DISTRIBUTION VIEW (for Estrategia SEO/GEO)
-- ============================================================================
CREATE OR REPLACE VIEW v_figma_lead_source_distribution AS
SELECT 
  COALESCE(utm_source, 'direct') as source,
  COUNT(*) as total_leads,
  ROUND(COUNT(*)::NUMERIC / (SELECT COUNT(*) FROM leads) * 100, 2) as percentage,
  COUNT(*) FILTER (WHERE crm_stage = 'converted') as conversions,
  ROUND(AVG(CASE WHEN crm_stage = 'converted' THEN 1 ELSE 0 END)::NUMERIC * 100, 2) as conversion_rate
FROM leads
GROUP BY COALESCE(utm_source, 'direct')
ORDER BY total_leads DESC;

GRANT SELECT ON v_figma_lead_source_distribution TO authenticated;

-- ============================================================================
-- CONVERSION FUNNEL VIEW (for Estrategia SEO/GEO)
-- ============================================================================
CREATE OR REPLACE VIEW v_figma_conversion_funnel AS
SELECT 
  'Total Leads' as stage,
  COUNT(*) as count,
  100.0 as percentage
FROM leads
UNION ALL
SELECT 
  'Qualified Leads' as stage,
  COUNT(*) as count,
  ROUND(COUNT(*)::NUMERIC / (SELECT COUNT(*) FROM leads) * 100, 2) as percentage
FROM leads
WHERE crm_stage IN ('qualified', 'converted')
UNION ALL
SELECT 
  'Converted' as stage,
  COUNT(*) as count,
  ROUND(COUNT(*)::NUMERIC / (SELECT COUNT(*) FROM leads) * 100, 2) as percentage
FROM leads
WHERE crm_stage = 'converted'
UNION ALL
SELECT 
  'Paid Patients' as stage,
  COUNT(*) as count,
  ROUND(COUNT(*)::NUMERIC / (SELECT COUNT(*) FROM leads) * 100, 2) as percentage
FROM financial_settlements;

GRANT SELECT ON v_figma_conversion_funnel TO authenticated;

-- ============================================================================
-- META PERFORMANCE VIEW (for Presentación Ejecutiva & Auditoría)
-- ============================================================================
CREATE OR REPLACE VIEW v_figma_meta_performance AS
SELECT 
  DATE_TRUNC('day', created_at)::DATE as date,
  COUNT(*) as leads,
  COUNT(*) FILTER (WHERE crm_stage = 'converted') as conversions,
  MAX(created_at) as last_update
FROM leads
WHERE utm_source ILIKE '%facebook%' OR utm_source ILIKE '%instagram%'
GROUP BY DATE_TRUNC('day', created_at)
ORDER BY date DESC;

GRANT SELECT ON v_figma_meta_performance TO authenticated;

-- ============================================================================
-- GOOGLE ADS PERFORMANCE VIEW (for Presentación Ejecutiva & Auditoría)
-- ============================================================================
CREATE OR REPLACE VIEW v_figma_google_ads_performance AS
SELECT 
  DATE_TRUNC('day', created_at)::DATE as date,
  COUNT(*) as leads,
  COUNT(*) FILTER (WHERE crm_stage = 'converted') as conversions,
  MAX(created_at) as last_update
FROM leads
WHERE utm_source ILIKE '%google%' OR utm_medium ILIKE '%cpc%'
GROUP BY DATE_TRUNC('day', created_at)
ORDER BY date DESC;

GRANT SELECT ON v_figma_google_ads_performance TO authenticated;

-- ============================================================================
-- HUBSPOT INTEGRATION VIEW (for Presentación Ejecutiva & Auditoría)
-- ============================================================================
CREATE OR REPLACE VIEW v_figma_hubspot_integration AS
SELECT 
  COUNT(*) as total_forms_submitted,
  COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as forms_7d,
  COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') as forms_30d,
  COUNT(*) FILTER (WHERE crm_stage = 'converted') as forms_converted,
  MAX(created_at) as last_submission
FROM leads
WHERE source = 'hubspot' OR form_id IS NOT NULL;

GRANT SELECT ON v_figma_hubspot_integration TO authenticated;

-- ============================================================================
-- VERIFY ALL VIEWS CREATED
-- ============================================================================
SELECT 
  viewname,
  'View created successfully' as status
FROM pg_views
WHERE schemaname = 'public'
  AND viewname LIKE 'v_figma_%'
ORDER BY viewname;
