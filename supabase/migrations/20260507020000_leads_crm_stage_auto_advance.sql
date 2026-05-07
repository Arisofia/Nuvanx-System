-- Migration: CRM auto-advance stage from Doctoralia settlement template keywords
-- Adds appointment_date and treatment_name columns to leads, and updates the
-- reconcile function to classify leads by their Doctoralia settlement type.

-- 1. Add new CRM columns to leads
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS appointment_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS treatment_name   VARCHAR(255);

-- 2. Replace reconcile function with stage classification logic
--
-- Classification rules (Spanish clinic templates):
--   VALORATION keywords → stage = 'appointment', set appointment_date
--     'valoración gratuita', 'primera visita', 'valoración rrhh'
--
--   REVISION keyword    → stage = 'closed'
--     'revisión de tratamiento', 'revision de tratamiento'
--
--   Any other template  → stage = 'treatment', set treatment_name
--
-- Stage advancement is one-way (never downgrade) and never auto-sets 'whatsapp'.
-- The 'whatsapp' stage must be moved manually.

CREATE OR REPLACE FUNCTION public.reconcile_doctoralia_matches_to_leads()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.leads l
  SET
    converted_patient_id = p.id,
    verified_revenue     = COALESCE(rev.total_net, 0),

    -- Set appointment_date from earliest valoration settlement (only if not yet set)
    appointment_date = CASE
      WHEN l.appointment_date IS NULL AND sched.appt_date IS NOT NULL
        THEN sched.appt_date
      ELSE l.appointment_date
    END,

    -- Set treatment_name from earliest non-valoration treatment (only if not yet set)
    treatment_name = CASE
      WHEN l.treatment_name IS NULL AND sched.treat_name IS NOT NULL
        THEN sched.treat_name
      ELSE l.treatment_name
    END,

    -- Advance stage: never downgrade, never auto-set 'whatsapp'
    -- Priority: closed > treatment > appointment > current
    stage = CASE
      WHEN l.stage = 'closed'
        THEN 'closed'
      WHEN rev.has_revision
        THEN 'closed'
      WHEN rev.has_treatment AND l.stage <> 'treatment'
        THEN 'treatment'
      WHEN rev.has_valoration AND l.stage IN ('lead', 'whatsapp')
        THEN 'appointment'
      -- Fallback: if revenue > 0 and still in early stages, close it
      WHEN COALESCE(rev.total_net, 0) > 0 AND l.stage IN ('lead', 'whatsapp', 'appointment')
        THEN 'closed'
      ELSE l.stage
    END

  FROM public.doctoralia_patients dp

  LEFT JOIN public.patients p
    ON p.dni = dp.doc_patient_id
   AND p.clinic_id = dp.clinic_id

  -- Revenue + stage classification flags
  LEFT JOIN LATERAL (
    SELECT
      SUM(fs.amount_net) AS total_net,

      BOOL_OR(
        fs.template_name ILIKE '%valoraci_n gratuita%'
        OR fs.template_name ILIKE '%primera visita%'
        OR fs.template_name ILIKE '%valoraci_n rrhh%'
        -- Also match with accent (ó)
        OR fs.template_name ILIKE '%valoración gratuita%'
        OR fs.template_name ILIKE '%valoración rrhh%'
      ) AS has_valoration,

      BOOL_OR(
        fs.template_name ILIKE '%revisión de tratamiento%'
        OR fs.template_name ILIKE '%revision de tratamiento%'
      ) AS has_revision,

      BOOL_OR(
        fs.template_name IS NOT NULL
        AND fs.template_name NOT ILIKE '%valoraci_n gratuita%'
        AND fs.template_name NOT ILIKE '%primera visita%'
        AND fs.template_name NOT ILIKE '%valoraci_n rrhh%'
        AND fs.template_name NOT ILIKE '%valoración gratuita%'
        AND fs.template_name NOT ILIKE '%valoración rrhh%'
        AND fs.template_name NOT ILIKE '%revisión de tratamiento%'
        AND fs.template_name NOT ILIKE '%revision de tratamiento%'
      ) AS has_treatment

    FROM public.financial_settlements fs
    WHERE fs.patient_id = p.id
      AND fs.cancelled_at IS NULL
  ) rev ON TRUE

  -- Earliest appointment date + first treatment name
  LEFT JOIN LATERAL (
    SELECT
      MIN(fs2.settled_at) AS appt_date,
      (
        SELECT fs3.template_name
        FROM public.financial_settlements fs3
        WHERE fs3.patient_id = p.id
          AND fs3.cancelled_at IS NULL
          AND fs3.template_name NOT ILIKE '%valoraci_n gratuita%'
          AND fs3.template_name NOT ILIKE '%primera visita%'
          AND fs3.template_name NOT ILIKE '%valoraci_n rrhh%'
          AND fs3.template_name NOT ILIKE '%valoración gratuita%'
          AND fs3.template_name NOT ILIKE '%valoración rrhh%'
          AND fs3.template_name NOT ILIKE '%revisión de tratamiento%'
          AND fs3.template_name NOT ILIKE '%revision de tratamiento%'
        ORDER BY fs3.settled_at ASC
        LIMIT 1
      ) AS treat_name

    FROM public.financial_settlements fs2
    WHERE fs2.patient_id = p.id
      AND fs2.cancelled_at IS NULL
      AND (
        fs2.template_name ILIKE '%valoraci_n gratuita%'
        OR fs2.template_name ILIKE '%primera visita%'
        OR fs2.template_name ILIKE '%valoraci_n rrhh%'
        OR fs2.template_name ILIKE '%valoración gratuita%'
        OR fs2.template_name ILIKE '%valoración rrhh%'
      )
  ) sched ON TRUE

  WHERE dp.lead_id = l.id
    AND dp.match_confidence >= 0.85;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reconcile_doctoralia_matches_to_leads() TO service_role;
