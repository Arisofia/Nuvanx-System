# NUVANX KPI Live Contract

The fourth Figma presentation must read live data through Supabase REST views, not pasted values.

Production binding must come from environment configuration:

- `SUPABASE_PROJECT_REF`
- `SUPABASE_URL`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY` or `VITE_SUPABASE_ANON_KEY`

Required views:

- `public.v_figma_kpi_snapshot`
- `public.v_figma_campaign_kpis`
- `public.v_figma_data_health`
- `public.v_figma_doctoralia_kpis`

Source ownership:

- Meta Ads: `public.meta_daily_insights`
- CRM leads: `public.leads`
- Campaign conversion: `public.vw_campaign_performance_real`
- Doctoralia cash: `public.financial_settlements`
- Google operational sheet: configured Doctoralia sheet/tab from secrets and workflow env

Figma behavior:

- Show global operational freshness.
- Show Meta freshness separately from CRM and Doctoralia cash.
- Label cash as Doctoralia / caja clínica.
- Do not claim current Meta efficiency while `meta_sync_status` is `META_STALE`.

Current operational risk:

- Meta ingestion must be live before making current paid-media efficiency decisions.
