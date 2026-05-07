-- Migration: Fix Doctoralia CRM classification for meta_leadgen leads
-- Resets leads misclassified by Meta ad/campaign keywords and updates
-- the reconcile function to use the latest Doctoralia settlement template_name.

-- 1) Reset stage on meta_leadgen leads that were incorrectly advanced by
--    the old ad_name/form_name classifier.
UPDATE public.leads
SET
  stage            = 'lead',
  appointment_date = NULL,
  treatment_name   = NULL,
  updated_at       = now()
WHERE source = 'meta_leadgen'
  AND stage IN ('treatment', 'appointment', 'closed');

-- 2) Remove the obsolete SQL classifier helper.
DROP FUNCTION IF EXISTS public.classify_meta_lead_stage(jsonb, text, text, text);

-- 3) Replace reconcile_doctoralia_matches_to_leads() with last-contact logic.
CREATE OR REPLACE FUNCTION public.reconcile_doctoralia_matches_to_leads()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.leads l
  SET
    appointment_date = CASE
      WHEN l.appointment_date IS NULL
           AND last_fs.classified_stage = 'appointment'
           AND l.stage IN ('lead', 'whatsapp')
        THEN last_fs.settled_at
      ELSE l.appointment_date
    END,
    treatment_name = CASE
      WHEN l.treatment_name IS NULL
           AND last_fs.classified_stage = 'treatment'
        THEN last_fs.treatment
      ELSE l.treatment_name
    END,
    stage = CASE
      WHEN l.stage = 'closed' THEN 'closed'
      WHEN last_fs.classified_stage = 'closed' THEN 'closed'
      WHEN last_fs.classified_stage = 'treatment'
           AND l.stage <> 'closed' THEN 'treatment'
      WHEN last_fs.classified_stage = 'appointment'
           AND l.stage IN ('lead', 'whatsapp') THEN 'appointment'
      ELSE l.stage
    END,
    updated_at = now()
  FROM (
    SELECT DISTINCT ON (l2.id)
      l2.id AS lead_id,
      fs.settled_at,
      TRIM(REGEXP_REPLACE(
        COALESCE(SUBSTRING(fs.template_name FROM '\]\s*\((.+)\)\s*$'), ''),
        '\s+', ' ', 'g'
      )) AS treatment,
      CASE
        WHEN COALESCE(SUBSTRING(fs.template_name FROM '\]\s*\((.+)\)\s*$'), '')
             ~* 'valoraci[oó]n|primera\s+visita'
          THEN 'appointment'
        WHEN COALESCE(SUBSTRING(fs.template_name FROM '\]\s*\((.+)\)\s*$'), '')
             ~* 'revisi[oó]n|revision|post|seguimiento'
          THEN 'closed'
        ELSE 'treatment'
      END AS classified_stage
    FROM public.leads l2
    JOIN public.financial_settlements fs
      ON RIGHT(regexp_replace(COALESCE(l2.phone, ''), '[^0-9]', '', 'g'), 9)
         = (regexp_match(
              regexp_replace(
                COALESCE((regexp_match(fs.template_name, '\[([^\]]+)\]'))[1], ''),
                '[^0-9]', '', 'g'
              ),
              '(\d{9})\d*$'
            ))[1]
    WHERE l2.source = 'meta_leadgen'
      AND fs.cancelled_at IS NULL
      AND fs.template_name IS NOT NULL
    ORDER BY l2.id, fs.settled_at DESC
  ) last_fs
  WHERE l.id = last_fs.lead_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reconcile_doctoralia_matches_to_leads() TO service_role;
