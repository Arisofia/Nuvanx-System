-- Adds laser-based treatment keywords to classify_meta_lead_stage() that were
-- missing from the initial version, and re-runs retroactive classification on
-- all remaining meta_leadgen leads still stuck in 'lead' stage.
--
-- Newly covered ad_names (found in production data):
--   "Laser Co2"               → treatment: Láser CO2
--   "Lasérlipolisis pre verano" → treatment: Laserlipólisis

SET search_path TO public;

-- ─── 1. Replace function with extended treatment keyword list ─────────────────
CREATE OR REPLACE FUNCTION public.classify_meta_lead_stage(
  p_raw_field_data  JSONB,
  p_notes           TEXT,
  p_form_name       TEXT,
  p_ad_name         TEXT
)
RETURNS TABLE(
  suggested_stage    TEXT,
  suggested_treatment TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_text    TEXT;
  v_stage   TEXT := 'lead';
  v_treat   TEXT := NULL;
BEGIN
  v_text := lower(
    coalesce(p_notes, '') || ' ' ||
    coalesce(p_form_name, '') || ' ' ||
    coalesce(p_ad_name, '') || ' ' ||
    coalesce(p_raw_field_data::text, '')
  );

  -- Priority 1: closed (revisión / follow-up)
  IF v_text ~* 'revisi[oó]n\s*(de\s*)?tratamiento|postoperatorio|revisi[oó]n\s*postop|seguimiento' THEN
    v_stage := 'closed';

  -- Priority 2: free / first appointment
  ELSIF v_text ~* 'valoraci[oó]n(\s+(gratuita|rrhh|inicial))?|primera\s+visita|primera\s+consulta|consulta\s+(gratuita|inicial|informativa)' THEN
    v_stage := 'appointment';

  -- Priority 3: named treatment (expanded list includes laser treatments)
  ELSIF v_text ~* 'combo|endolift|b[oó]tox|neuromodulador|toxina|relleno|hialu[rr][oó]|rinomodelaci[oó]n|bichectom[ií]a|lifting|mesoterapia|peeling|blefaroplastia|rinoplastia|liposucci[oó]n|abdominoplastia|mamoplastia|implantes|pr[oó]tesis|lipolisis|l[aá]ser|co2|depilaci[oó]n|fotorrejuvenecimiento|skin\s*booster|bioestimulaci[oó]n|carboxiterapia|dermal|hilos|tensado' THEN
    v_stage := 'treatment';
    v_treat := CASE
      WHEN v_text ~* 'endolift'              THEN 'Endolift'
      WHEN v_text ~* 'lipolisis'             THEN 'Laserlipólisis'
      WHEN v_text ~* 'l[aá]ser.*co2|co2.*l[aá]ser' THEN 'Láser CO2'
      WHEN v_text ~* 'l[aá]ser'             THEN 'Láser'
      WHEN v_text ~* 'combo'                THEN 'Combo'
      WHEN v_text ~* 'b[oó]tox'             THEN 'Bótox'
      WHEN v_text ~* 'neuromodulador'        THEN 'Neuromodulador'
      WHEN v_text ~* 'toxina'               THEN 'Toxina botulínica'
      WHEN v_text ~* 'relleno'              THEN 'Relleno'
      WHEN v_text ~* 'hialu[rr][oó]'        THEN 'Hialurónico'
      WHEN v_text ~* 'rinomodelaci[oó]n'    THEN 'Rinomodelación'
      WHEN v_text ~* 'bichectom[ií]a'       THEN 'Bichectomía'
      WHEN v_text ~* 'lifting'              THEN 'Lifting'
      WHEN v_text ~* 'mesoterapia'          THEN 'Mesoterapia'
      WHEN v_text ~* 'peeling'              THEN 'Peeling'
      WHEN v_text ~* 'blefaroplastia'       THEN 'Blefaroplastia'
      WHEN v_text ~* 'rinoplastia'          THEN 'Rinoplastia'
      WHEN v_text ~* 'liposucci[oó]n'       THEN 'Liposucción'
      WHEN v_text ~* 'abdominoplastia'      THEN 'Abdominoplastia'
      WHEN v_text ~* 'mamoplastia'          THEN 'Mamoplastia'
      WHEN v_text ~* 'implantes'            THEN 'Implantes'
      WHEN v_text ~* 'pr[oó]tesis'          THEN 'Prótesis'
      WHEN v_text ~* 'co2'                  THEN 'Láser CO2'
      WHEN v_text ~* 'depilaci[oó]n'        THEN 'Depilación láser'
      WHEN v_text ~* 'fotorrejuvenecimiento' THEN 'Fotorrejuvenecimiento'
      WHEN v_text ~* 'skin\s*booster'       THEN 'Skin Booster'
      WHEN v_text ~* 'bioestimulaci[oó]n'   THEN 'Bioestimulación'
      WHEN v_text ~* 'carboxiterapia'       THEN 'Carboxiterapia'
      WHEN v_text ~* 'hilos'               THEN 'Hilos tensores'
      WHEN v_text ~* 'tensado'             THEN 'Tensado'
      ELSE coalesce(p_ad_name, p_form_name)
    END;

  END IF;

  suggested_stage    := v_stage;
  suggested_treatment := v_treat;
  RETURN NEXT;
END;
$$;

-- ─── 2. Re-run retroactive classification on still-unclassified leads ─────────
DO $$
DECLARE
  v_updated INT;
BEGIN
  UPDATE public.leads l
  SET
    stage = c.suggested_stage,
    appointment_date = CASE
      WHEN c.suggested_stage = 'appointment'
      THEN coalesce(l.created_at_meta, l.created_at)
      ELSE l.appointment_date
    END,
    treatment_name = CASE
      WHEN c.suggested_stage = 'treatment'
      THEN coalesce(c.suggested_treatment, l.treatment_name)
      ELSE l.treatment_name
    END,
    updated_at = now()
  FROM (
    SELECT
      l2.id,
      (public.classify_meta_lead_stage(
        l2.raw_field_data,
        l2.notes,
        l2.form_name,
        l2.ad_name
      )).suggested_stage  AS suggested_stage,
      (public.classify_meta_lead_stage(
        l2.raw_field_data,
        l2.notes,
        l2.form_name,
        l2.ad_name
      )).suggested_treatment AS suggested_treatment
    FROM public.leads l2
    WHERE l2.source = 'meta_leadgen'
      AND l2.stage  = 'lead'
  ) c
  WHERE l.id = c.id
    AND c.suggested_stage <> 'lead';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'classify_meta_leads_patch: % additional leads reclassified', v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.classify_meta_lead_stage(JSONB, TEXT, TEXT, TEXT)
  TO authenticated, service_role;
