-- Retroactively classify meta_leadgen leads based on form answer keywords stored in
-- raw_field_data, notes, form_name, and ad_name. Updates stage, appointment_date,
-- and treatment_name on all leads currently stuck in the 'lead' stage.
--
-- Classification rules (case-insensitive):
--   appointment  ← "valoración gratuita", "primera visita", "valoración rrhh",
--                   "consulta gratuita", "consulta inicial", "primera consulta"
--   treatment    ← "combo", "endolift", "bótox", "botox", "relleno", "hialu",
--                   "hialurón", "rinomodelación", "bichectomía", "lifting",
--                   "neuromodulador", "toxina", "mesoterapia", "peeling",
--                   "blefaroplastia", "rinoplastia", "liposucción", "abdominoplastia",
--                   "mamoplastia", "implantes", "prótesis", "tratamiento"
--   closed       ← "revisión de tratamiento", "revisión tratamiento", "postoperatorio",
--                   "revisión postop", "seguimiento"
--
-- Leads already in a stage other than 'lead' are NOT touched (preserves manual edits).
-- appointment_date is set to created_at_meta (or created_at if null) so Cita column is populated.
-- treatment_name is set to the ad_name or form_name when no explicit treatment keyword is found
-- in form answers (because that is the closest proxy we have from Meta data).

SET search_path TO public;

-- ─── 1. Helper function (reusable from Edge Function via RPC) ─────────────────
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
  -- Build a single lowercase text blob from all text sources
  v_text := lower(
    coalesce(p_notes, '') || ' ' ||
    coalesce(p_form_name, '') || ' ' ||
    coalesce(p_ad_name, '') || ' ' ||
    coalesce(p_raw_field_data::text, '')
  );

  -- Priority 1: closed (revisión de tratamiento / follow-up)
  IF v_text ~* 'revisi[oó]n\s*(de\s*)?tratamiento|postoperatorio|revisi[oó]n\s*postop|seguimiento' THEN
    v_stage := 'closed';

  -- Priority 2: appointment (free consultation / first visit)
  ELSIF v_text ~* 'valoraci[oó]n\s*(gratuita|rrhh|inicial)?|primera\s*visita|primera\s*consulta|consulta\s*(gratuita|inicial|informativa)' THEN
    v_stage := 'appointment';

  -- Priority 3: named treatment
  ELSIF v_text ~* 'combo|endolift|b[oó]tox|neuromodulador|toxina|relleno|hialu[rr][oó]|rinomodelaci[oó]n|bichectom[ií]a|lifting|mesoterapia|peeling|blefaroplastia|rinoplastia|liposucci[oó]n|abdominoplastia|mamoplastia|implantes|pr[oó]tesis' THEN
    v_stage := 'treatment';
    -- Extract the specific treatment keyword as treatment_name
    v_treat := CASE
      WHEN v_text ~* 'endolift'         THEN 'Endolift'
      WHEN v_text ~* 'combo'            THEN 'Combo'
      WHEN v_text ~* 'b[oó]tox'        THEN 'Bótox'
      WHEN v_text ~* 'neuromodulador'   THEN 'Neuromodulador'
      WHEN v_text ~* 'relleno'          THEN 'Relleno'
      WHEN v_text ~* 'hialu[rr][oó]'   THEN 'Hialurónico'
      WHEN v_text ~* 'rinomodelaci[oó]n' THEN 'Rinomodelación'
      WHEN v_text ~* 'bichectom[ií]a'  THEN 'Bichectomía'
      WHEN v_text ~* 'lifting'          THEN 'Lifting'
      WHEN v_text ~* 'mesoterapia'      THEN 'Mesoterapia'
      WHEN v_text ~* 'peeling'          THEN 'Peeling'
      WHEN v_text ~* 'blefaroplastia'   THEN 'Blefaroplastia'
      WHEN v_text ~* 'rinoplastia'      THEN 'Rinoplastia'
      WHEN v_text ~* 'liposucci[oó]n'  THEN 'Liposucción'
      WHEN v_text ~* 'abdominoplastia'  THEN 'Abdominoplastia'
      WHEN v_text ~* 'mamoplastia'      THEN 'Mamoplastia'
      WHEN v_text ~* 'implantes'        THEN 'Implantes'
      WHEN v_text ~* 'pr[oó]tesis'      THEN 'Prótesis'
      WHEN v_text ~* 'toxina'           THEN 'Toxina botulínica'
      ELSE coalesce(p_ad_name, p_form_name)
    END;

  END IF;

  suggested_stage    := v_stage;
  suggested_treatment := v_treat;
  RETURN NEXT;
END;
$$;

-- ─── 2. One-time retroactive UPDATE of all stuck meta_leadgen leads ──────────
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
    AND c.suggested_stage <> 'lead';  -- only update if classification changed

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'classify_meta_leads: % leads reclassified', v_updated;
END;
$$;

-- ─── 3. Grant execute on the helper function ─────────────────────────────────
GRANT EXECUTE ON FUNCTION public.classify_meta_lead_stage(JSONB, TEXT, TEXT, TEXT)
  TO authenticated, service_role;
