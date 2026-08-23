-- Replace the daily Control Centre insight introduced by the pending 095000
-- migration with a contract that reports only what the persisted sources prove.
-- Doctoralia appointment "Importe" is not a reconciled payment ledger, so this
-- function deliberately emits no revenue/cash metric from that source.
--
-- Campaign ranking is computed directly from public.leads. The legacy
-- vw_campaign_performance_real view currently fails on production PostgreSQL
-- because of a non-mergeable FULL JOIN condition and is therefore not a safe
-- runtime dependency for the daily job.

CREATE OR REPLACE FUNCTION public.nvx_generate_daily_control_centre_insights()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Europe/Madrid')::date;
  v_doctoralia_today integer := 0;
  v_doctoralia_realized integer := 0;
  v_doctoralia_cancelled integer := 0;
  v_latest_doctoralia_import timestamptz;
  v_user record;
  v_risk_leads integer := 0;
  v_top_campaigns jsonb := '[]'::jsonb;
  v_latest_crm_lead timestamptz;
  v_latest_meta_date date;
  v_payload jsonb;
  v_inserted integer := 0;
BEGIN
  SELECT
    count(*)::integer,
    count(*) FILTER (
      WHERE NOT COALESCE(i.is_cancelled, false)
        AND lower(trim(COALESCE(i.estado::text, ''))) = 'realizada'
    )::integer,
    count(*) FILTER (WHERE COALESCE(i.is_cancelled, false))::integer
  INTO v_doctoralia_today, v_doctoralia_realized, v_doctoralia_cancelled
  FROM public.doctoralia_appointments_ingestion i
  WHERE COALESCE(i.appointment_date, i.normalized_date) = v_today
    AND NOT COALESCE(i.is_control, false);

  SELECT max(i.imported_at)
    INTO v_latest_doctoralia_import
  FROM public.doctoralia_appointments_ingestion i;

  FOR v_user IN
    SELECT u.id, u.clinic_id
    FROM public.users u
    WHERE u.clinic_id IS NOT NULL
  LOOP
    SELECT count(*)::integer
      INTO v_risk_leads
    FROM public.leads l
    WHERE l.user_id = v_user.id
      AND l.deleted_at IS NULL
      AND lower(COALESCE(l.stage::text, '')) IN ('nuevo', 'lead')
      AND l.created_at < now() - interval '14 days'
      AND lower(COALESCE(l.source::text, '')) <> 'doctoralia';

    SELECT max(l.created_at)
      INTO v_latest_crm_lead
    FROM public.leads l
    WHERE l.user_id = v_user.id
      AND l.deleted_at IS NULL;

    SELECT max(m.date)
      INTO v_latest_meta_date
    FROM public.meta_daily_insights m
    WHERE m.user_id = v_user.id;

    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'campaign_name', ranked.campaign_name,
          'total_leads', ranked.total_leads,
          'appointments', ranked.appointments,
          'converted_stage', ranked.converted_stage,
          'last_lead_at', ranked.last_lead_at
        )
        ORDER BY ranked.total_leads DESC, ranked.last_lead_at DESC NULLS LAST
      ),
      '[]'::jsonb
    )
      INTO v_top_campaigns
    FROM (
      SELECT
        COALESCE(NULLIF(trim(l.campaign_name::text), ''), 'Sin campaña') AS campaign_name,
        count(*)::integer AS total_leads,
        count(*) FILTER (
          WHERE l.appointment_date IS NOT NULL
             OR lower(COALESCE(l.stage::text, '')) = 'appointment'
        )::integer AS appointments,
        count(*) FILTER (
          WHERE lower(COALESCE(l.stage::text, '')) = 'convertido'
        )::integer AS converted_stage,
        max(l.created_at) AS last_lead_at
      FROM public.leads l
      WHERE l.user_id = v_user.id
        AND l.deleted_at IS NULL
      GROUP BY COALESCE(NULLIF(trim(l.campaign_name::text), ''), 'Sin campaña')
      ORDER BY total_leads DESC, last_lead_at DESC NULLS LAST
      LIMIT 5
    ) ranked;

    v_payload := jsonb_build_object(
      'date', v_today::text,
      'risk_leads', v_risk_leads,
      'top_campaigns', v_top_campaigns,
      'campaign_semantics', jsonb_build_object(
        'appointments', 'appointment_date_present_or_stage_appointment',
        'converted_stage', 'literal_crm_stage_convertido_not_cash'
      ),
      'doctoralia_operations', jsonb_build_object(
        'appointments_today', v_doctoralia_today,
        'realized_today', v_doctoralia_realized,
        'cancelled_today', v_doctoralia_cancelled,
        'amount_semantics', 'not_reported_without_reconciled_cash_source'
      ),
      'data_freshness', jsonb_build_object(
        'crm_latest_lead_at', v_latest_crm_lead,
        'doctoralia_imported_at', v_latest_doctoralia_import,
        'meta_latest_date', v_latest_meta_date
      ),
      'recommendations', jsonb_build_array(
        CASE
          WHEN v_risk_leads > 0 THEN format('Revisar %s leads con más de 14 días sin avance.', v_risk_leads)
          ELSE 'Sin leads de más de 14 días pendientes según el CRM.'
        END,
        CASE
          WHEN v_latest_crm_lead IS NULL THEN 'CRM sin leads persistidos para este usuario.'
          WHEN v_latest_crm_lead < now() - interval '48 hours' THEN format('La fuente CRM está desactualizada; último lead persistido: %s.', v_latest_crm_lead)
          ELSE 'La fuente CRM tiene actividad reciente.'
        END,
        CASE
          WHEN v_latest_meta_date IS NULL THEN 'Meta Insights no tiene fecha persistida para este usuario.'
          WHEN v_latest_meta_date < v_today - 2 THEN format('Meta Insights está desactualizado; última fecha persistida: %s.', v_latest_meta_date)
          ELSE 'Meta Insights tiene datos recientes.'
        END,
        format(
          'Doctoralia hoy: %s citas operativas, %s realizadas y %s canceladas. No se reporta caja sin una fuente de cobros reconciliada.',
          v_doctoralia_today,
          v_doctoralia_realized,
          v_doctoralia_cancelled
        )
      )
    );

    DELETE FROM public.agent_outputs ao
    WHERE ao.user_id = v_user.id
      AND ao.agent_type = 'daily-insight'
      AND (ao.created_at AT TIME ZONE 'Europe/Madrid')::date = v_today;

    INSERT INTO public.agent_outputs (
      user_id,
      clinic_id,
      agent_type,
      input_context,
      output_text,
      model_used,
      status,
      output,
      metadata
    ) VALUES (
      v_user.id,
      v_user.clinic_id,
      'daily-insight',
      jsonb_build_object(
        'generator', 'nvx_generate_daily_control_centre_insights',
        'date', v_today::text,
        'semantics', 'operational_facts_no_unreconciled_cash'
      ),
      v_payload::text,
      'deterministic-control-centre-v2',
      'completed',
      v_payload,
      jsonb_build_object(
        'source', 'postgres-canonical',
        'generated_for_date', v_today::text,
        'semantics', 'operational_facts_no_unreconciled_cash',
        'doctoralia_imported_at', v_latest_doctoralia_import,
        'meta_latest_date', v_latest_meta_date,
        'crm_latest_lead_at', v_latest_crm_lead
      )
    );

    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.nvx_generate_daily_control_centre_insights() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nvx_generate_daily_control_centre_insights() TO service_role;

-- 095000 may have generated today's row immediately before this correction.
-- Replace it in the same migration sequence so consumers never retain the
-- superseded cash-labelled payload.
SELECT public.nvx_generate_daily_control_centre_insights();

-- Remove the deployment-only shim after the old pending function body has been
-- replaced. No business data was ever written to this field.
ALTER TABLE IF EXISTS public.financial_settlements
  DROP COLUMN IF EXISTS campaign_name;
