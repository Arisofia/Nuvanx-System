# NUVANX KPI Live Contract

Production Supabase project: nuvanx-prod.
Project ref: ssvvuuysgxyqvmovrlvk.
REST URL: https://ssvvuuysgxyqvmovrlvk.supabase.co.

The fourth Figma presentation must read live data through Supabase REST views, not pasted values.

Required views:
- public.v_figma_kpi_snapshot
- public.v_figma_campaign_kpis
- public.v_figma_data_health
- public.v_figma_doctoralia_kpis

Source ownership:
- Meta Ads: public.meta_daily_insights
- CRM leads: public.leads
- Campaign conversion: public.vw_campaign_performance_real
- Doctoralia cash: public.financial_settlements
- Google operational sheet: Base Pacientes Nuvanx / Doctoralia tab

Figma behavior:
- Show global operational freshness.
- Show Meta freshness separately from CRM and Doctoralia cash.
- Label cash as Doctoralia / caja clinica.
- Do not claim current Meta efficiency while meta_sync_status is META_STALE.

Current operational risk:
- Meta ingestion is stale and must be reactivated before making current paid-media efficiency decisions.
