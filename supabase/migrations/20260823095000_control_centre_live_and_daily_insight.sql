-- Make the Control Centre consume current operational data without demo or
-- hard-coded records.
--
-- 1. doctoralia_appointments_ingestion remains the canonical daily source.
--    doctoralia_raw is maintained as the compatibility/realtime projection still
--    consumed by the current LIVE frontend and API route.
-- 2. Generate one deterministic daily Control Centre insight per configured user
--    from current database facts. No model-generated numbers are introduced.
-- 3. Retire the unused daily-market-intel cron; the orphan Edge Function is not
--    part of the canonical repo and is handled separately after deploy verification.

BEGIN;

CREATE OR REPLACE FUNCTION public.nvx_resolve_doctoralia_live_clinic_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_clinic_id uuid;
BEGIN
  SELECT c.id
    INTO v_clinic_id
  FROM public.clinics c
  WHERE lower(c.name::text) LIKE '%nuvanx%'
  ORDER BY c.id
  LIMIT 1;

  IF v_clinic_id IS NULL THEN
    SELECT u.clinic_id
      INTO v_clinic_id
    FROM public.users u
    WHERE u.clinic_id IS NOT NULL
    GROUP BY u.clinic_id
    ORDER BY count(*) DESC, u.clinic_id
    LIMIT 1;
  END IF;

  RETURN v_clinic_id;
END;
$$;

REVOKE ALL ON FUNCTION public.nvx_resolve_doctoralia_live_clinic_id() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nvx_resolve_doctoralia_live_clinic_id() TO service_role;

CREATE OR REPLACE FUNCTION public.nvx_doctoralia_live_timestamp(p_date date, p_time text)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  IF p_date IS NULL THEN
    RETURN NULL;
  END IF;

  IF COALESCE(trim(p_time), '') ~ '^\d{1,2}:\d{2}(:\d{2})?$' THEN
    RETURN ((p_date::text || ' ' || trim(p_time))::timestamp AT TIME ZONE 'Europe/Madrid');
  END IF;

  RETURN (p_date::timestamp AT TIME ZONE 'Europe/Madrid');
END;
$$;

REVOKE ALL ON FUNCTION public.nvx_doctoralia_live_timestamp(date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nvx_doctoralia_live_timestamp(date, text) TO service_role;

CREATE OR REPLACE FUNCTION public.nvx_upsert_doctoralia_live_row(p_source_key text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.doctoralia_appointments_ingestion%ROWTYPE;
  v_clinic_id uuid;
  v_confirmed boolean;
  v_appointment_ts timestamptz;
BEGIN
  SELECT *
    INTO v_row
  FROM public.doctoralia_appointments_ingestion
  WHERE source_key = p_source_key
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_clinic_id := public.nvx_resolve_doctoralia_live_clinic_id();
  IF v_clinic_id IS NULL THEN
    RAISE EXCEPTION 'No clinic is configured for Doctoralia LIVE projection';
  END IF;

  v_confirmed := CASE
    WHEN v_row.confirmed IS NULL THEN NULL
    ELSE lower(trim(v_row.confirmed)) IN ('si', 'sí', 'yes', 'true', '1', 'confirmada', 'confirmado')
  END;

  v_appointment_ts := public.nvx_doctoralia_live_timestamp(
    COALESCE(v_row.appointment_date, v_row.normalized_date),
    v_row.appointment_time
  );

  INSERT INTO public.doctoralia_raw (
    clinic_id,
    raw_row,
    processed,
    processed_at,
    raw_hash,
    ingested_at,
    source_file_id,
    sheet_name,
    estado,
    fecha,
    hora,
    fecha_creacion,
    asunto,
    agenda,
    sala_box,
    confirmada,
    procedencia,
    importe,
    doc_patient_id,
    patient_name,
    patient_name_norm,
    phone_primary,
    treatment,
    appointment_start,
    timestamp_cita,
    importe_numerico,
    importe_clean,
    is_ingreso,
    cita_efectiva,
    cita_perdida,
    paciente_id,
    paciente_nombre,
    paciente_telefono,
    procedimiento_nombre,
    updated_at
  ) VALUES (
    v_clinic_id,
    COALESCE(v_row.raw_data, '{}'::jsonb) || jsonb_build_object(
      'source_key', v_row.source_key,
      'canonical_table', 'doctoralia_appointments_ingestion',
      'sheet_row', v_row.sheet_row
    ),
    true,
    COALESCE(v_row.updated_at, v_row.imported_at, now()),
    'ingestion:' || md5(v_row.source_key),
    v_row.imported_at,
    v_row.source_key,
    'canonical_appointments_ingestion',
    v_row.estado,
    COALESCE(v_row.appointment_date, v_row.normalized_date),
    v_row.appointment_time,
    v_row.created_date,
    COALESCE(v_row.subject, v_row.treatment),
    v_row.agenda,
    v_row.room,
    v_confirmed,
    v_row.origin,
    v_row.amount,
    v_row.doctoralia_id,
    v_row.patient_name,
    upper(trim(COALESCE(v_row.patient_name, ''))),
    COALESCE(v_row.phone_normalized, v_row.phone, v_row.patient_phone),
    v_row.treatment,
    v_appointment_ts,
    v_appointment_ts,
    v_row.amount,
    v_row.amount,
    COALESCE(v_row.amount, 0) > 0,
    NOT COALESCE(v_row.is_cancelled, false),
    COALESCE(v_row.is_cancelled, false),
    v_row.doctoralia_id,
    v_row.patient_name,
    COALESCE(v_row.phone_normalized, v_row.phone, v_row.patient_phone),
    v_row.treatment,
    COALESCE(v_row.updated_at, v_row.imported_at, now())
  )
  ON CONFLICT (raw_hash) WHERE raw_hash IS NOT NULL
  DO UPDATE SET
    clinic_id = EXCLUDED.clinic_id,
    raw_row = EXCLUDED.raw_row,
    processed = EXCLUDED.processed,
    processed_at = EXCLUDED.processed_at,
    ingested_at = EXCLUDED.ingested_at,
    source_file_id = EXCLUDED.source_file_id,
    sheet_name = EXCLUDED.sheet_name,
    estado = EXCLUDED.estado,
    fecha = EXCLUDED.fecha,
    hora = EXCLUDED.hora,
    fecha_creacion = EXCLUDED.fecha_creacion,
    asunto = EXCLUDED.asunto,
    agenda = EXCLUDED.agenda,
    sala_box = EXCLUDED.sala_box,
    confirmada = EXCLUDED.confirmada,
    procedencia = EXCLUDED.procedencia,
    importe = EXCLUDED.importe,
    doc_patient_id = EXCLUDED.doc_patient_id,
    patient_name = EXCLUDED.patient_name,
    patient_name_norm = EXCLUDED.patient_name_norm,
    phone_primary = EXCLUDED.phone_primary,
    treatment = EXCLUDED.treatment,
    appointment_start = EXCLUDED.appointment_start,
    timestamp_cita = EXCLUDED.timestamp_cita,
    importe_numerico = EXCLUDED.importe_numerico,
    importe_clean = EXCLUDED.importe_clean,
    is_ingreso = EXCLUDED.is_ingreso,
    cita_efectiva = EXCLUDED.cita_efectiva,
    cita_perdida = EXCLUDED.cita_perdida,
    paciente_id = EXCLUDED.paciente_id,
    paciente_nombre = EXCLUDED.paciente_nombre,
    paciente_telefono = EXCLUDED.paciente_telefono,
    procedimiento_nombre = EXCLUDED.procedimiento_nombre,
    updated_at = EXCLUDED.updated_at;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.nvx_upsert_doctoralia_live_row(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nvx_upsert_doctoralia_live_row(text) TO service_role;

CREATE OR REPLACE FUNCTION public.nvx_mirror_doctoralia_ingestion_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.nvx_upsert_doctoralia_live_row(NEW.source_key);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.nvx_mirror_doctoralia_ingestion_row() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_nvx_mirror_doctoralia_ingestion_row
  ON public.doctoralia_appointments_ingestion;
CREATE TRIGGER trg_nvx_mirror_doctoralia_ingestion_row
AFTER INSERT OR UPDATE ON public.doctoralia_appointments_ingestion
FOR EACH ROW
EXECUTE FUNCTION public.nvx_mirror_doctoralia_ingestion_row();

CREATE OR REPLACE FUNCTION public.nvx_sync_doctoralia_live_mirror()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source_key text;
  v_source_count integer := 0;
  v_mirrored integer := 0;
  v_pruned integer := 0;
BEGIN
  SELECT count(*)::integer
    INTO v_source_count
  FROM public.doctoralia_appointments_ingestion;

  FOR v_source_key IN
    SELECT source_key
    FROM public.doctoralia_appointments_ingestion
    ORDER BY source_key
  LOOP
    IF public.nvx_upsert_doctoralia_live_row(v_source_key) THEN
      v_mirrored := v_mirrored + 1;
    END IF;
  END LOOP;

  -- The canonical Google Sheet contract requires >= 1800 rows. Only prune the
  -- compatibility mirror when a complete source load is present, so a partial
  -- upstream outage can never erase the LIVE history.
  IF v_source_count >= 1800 THEN
    DELETE FROM public.doctoralia_raw r
    WHERE r.sheet_name = 'canonical_appointments_ingestion'
      AND r.source_file_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.doctoralia_appointments_ingestion i
        WHERE i.source_key = r.source_file_id
      );
    GET DIAGNOSTICS v_pruned = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'source_count', v_source_count,
    'mirrored', v_mirrored,
    'pruned', v_pruned,
    'complete_source', v_source_count >= 1800
  );
END;
$$;

REVOKE ALL ON FUNCTION public.nvx_sync_doctoralia_live_mirror() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nvx_sync_doctoralia_live_mirror() TO service_role;

-- Populate LIVE immediately from the current canonical source.
SELECT public.nvx_sync_doctoralia_live_mirror();

-- The frontend listens to postgres_changes on doctoralia_raw.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'doctoralia_raw'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.doctoralia_raw;
  END IF;
END;
$$;

-- Hourly reconciliation protects against rows removed from the full daily sheet
-- while row-level triggers make new/updated appointments visible immediately.
DO $$
DECLARE
  v_job record;
BEGIN
  FOR v_job IN SELECT jobid FROM cron.job WHERE jobname = 'nvx-doctoralia-live-mirror'
  LOOP
    PERFORM cron.unschedule(v_job.jobid);
  END LOOP;

  PERFORM cron.schedule(
    'nvx-doctoralia-live-mirror',
    '17 * * * *',
    'select public.nvx_sync_doctoralia_live_mirror();'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.nvx_generate_daily_control_centre_insights()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Europe/Madrid')::date;
  v_risk_leads integer := 0;
  v_top_campaigns jsonb := '[]'::jsonb;
  v_doctoralia_revenue numeric := 0;
  v_doctoralia_patients integer := 0;
  v_latest_doctoralia_import timestamptz;
  v_latest_meta_date date;
  v_payload jsonb;
  v_user record;
  v_inserted integer := 0;
BEGIN
  SELECT count(*)::integer
    INTO v_risk_leads
  FROM public.leads l
  WHERE l.deleted_at IS NULL
    AND lower(COALESCE(l.stage::text, '')) IN ('nuevo', 'lead')
    AND l.created_at < now() - interval '14 days'
    AND lower(COALESCE(l.source::text, '')) <> 'doctoralia';

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'campaign_name', ranked.campaign_name,
        'revenue', ranked.revenue
      )
      ORDER BY ranked.revenue DESC
    ),
    '[]'::jsonb
  )
    INTO v_top_campaigns
  FROM (
    SELECT
      COALESCE(NULLIF(fs.campaign_name, ''), 'Sin campaña')::text AS campaign_name,
      round(sum(COALESCE(fs.amount_net, 0)), 2) AS revenue
    FROM public.financial_settlements fs
    WHERE fs.settled_at >= ((v_today - 6)::timestamp AT TIME ZONE 'Europe/Madrid')
      AND lower(COALESCE(fs.source_system::text, '')) <> 'doctoralia'
    GROUP BY COALESCE(NULLIF(fs.campaign_name, ''), 'Sin campaña')
    ORDER BY revenue DESC
    LIMIT 5
  ) ranked;

  SELECT
    round(COALESCE(sum(COALESCE(fs.amount_net, 0)), 0), 2),
    count(DISTINCT COALESCE(fs.patient_id::text, fs.phone_normalized, fs.id::text))::integer
  INTO v_doctoralia_revenue, v_doctoralia_patients
  FROM public.financial_settlements fs
  WHERE lower(COALESCE(fs.source_system::text, '')) = 'doctoralia'
    AND (fs.settled_at AT TIME ZONE 'Europe/Madrid')::date = v_today;

  SELECT max(i.imported_at)
    INTO v_latest_doctoralia_import
  FROM public.doctoralia_appointments_ingestion i;

  SELECT max(m.date)
    INTO v_latest_meta_date
  FROM public.meta_daily_insights m;

  v_payload := jsonb_build_object(
    'date', v_today::text,
    'risk_leads', v_risk_leads,
    'top_campaigns', v_top_campaigns,
    'doctoralia_summary', jsonb_build_object(
      'total_revenue', v_doctoralia_revenue,
      'total_patients', v_doctoralia_patients
    ),
    'data_freshness', jsonb_build_object(
      'doctoralia_imported_at', v_latest_doctoralia_import,
      'meta_latest_date', v_latest_meta_date
    ),
    'recommendations', jsonb_build_array(
      CASE
        WHEN v_risk_leads > 0 THEN format('Revisar %s leads con más de 14 días sin avance.', v_risk_leads)
        ELSE 'Sin leads de más de 14 días pendientes según el CRM.'
      END,
      CASE
        WHEN jsonb_array_length(v_top_campaigns) > 0 THEN 'Revisar el ranking de campañas por caja verificada de los últimos 7 días.'
        ELSE 'No hay caja atribuida a campañas en los últimos 7 días.'
      END,
      format('Doctoralia hoy: %s EUR verificados en %s pacientes.', v_doctoralia_revenue, v_doctoralia_patients)
    )
  );

  FOR v_user IN
    SELECT u.id, u.clinic_id
    FROM public.users u
    WHERE u.clinic_id IS NOT NULL
  LOOP
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
      jsonb_build_object('date', v_today::text, 'source', 'canonical-production-data'),
      v_payload::text,
      'deterministic-sql-v1',
      'completed',
      v_payload,
      jsonb_build_object(
        'source', 'postgres-canonical',
        'generated_for_date', v_today::text,
        'doctoralia_imported_at', v_latest_doctoralia_import,
        'meta_latest_date', v_latest_meta_date
      )
    );

    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.nvx_generate_daily_control_centre_insights() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nvx_generate_daily_control_centre_insights() TO service_role;

-- Generate today's deterministic insight immediately on production deploy.
SELECT public.nvx_generate_daily_control_centre_insights();

DO $$
DECLARE
  v_job record;
BEGIN
  FOR v_job IN
    SELECT jobid
    FROM cron.job
    WHERE jobname IN ('nvx-control-centre-daily-insight', 'daily-market-intel')
  LOOP
    PERFORM cron.unschedule(v_job.jobid);
  END LOOP;

  PERFORM cron.schedule(
    'nvx-control-centre-daily-insight',
    '50 7 * * *',
    'select public.nvx_generate_daily_control_centre_insights();'
  );
END;
$$;

COMMIT;
