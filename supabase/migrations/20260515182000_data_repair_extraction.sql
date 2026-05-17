-- =============================================================================
-- DATA REPAIR: Extract phones from JSON notes and Subjects
-- =============================================================================

BEGIN;

-- 1. Extract phone from 'notes' JSON in leads table
-- Some leads have phone in notes but null in phone column
UPDATE public.leads
SET phone = COALESCE(
    notes->>'telefono',
    notes->>'phone_number',
    notes->>'phone',
    phone
)
WHERE (phone IS NULL OR phone = '') AND notes IS NOT NULL;

-- 2. Extract phone from 'template_name' in financial_settlements
-- Format typically: "147. CLINICA D´CADIZ (ANA ALCALA) ALCALA [619056677] ..."
UPDATE public.financial_settlements
SET patient_phone = (REGEXP_MATCH(template_name, '\[(\d{9})\]'))[1]
WHERE (patient_phone IS NULL OR patient_phone = '') 
  AND template_name ~ '\[\d{9}\]';

-- If no brackets, try any sequence of 9 digits in template_name
UPDATE public.financial_settlements
SET patient_phone = (REGEXP_MATCH(template_name, '(\d{9})'))[1]
WHERE (patient_phone IS NULL OR patient_phone = '') 
  AND template_name ~ '\d{9}'
  AND NOT template_name ~ '\[\d{9}\]';

-- 3. Normalize all phones to 9 digits for matching
UPDATE public.leads 
SET phone_normalized = RIGHT(REGEXP_REPLACE(phone, '\D', '', 'g'), 9)
WHERE phone IS NOT NULL AND length(REGEXP_REPLACE(phone, '\D', '', 'g')) >= 9;

UPDATE public.financial_settlements 
SET phone_normalized = RIGHT(REGEXP_REPLACE(patient_phone, '\D', '', 'g'), 9)
WHERE patient_phone IS NOT NULL AND length(REGEXP_REPLACE(patient_phone, '\D', '', 'g')) >= 9;

-- 4. Execute the matching
-- We use a query that doesn't depend on clinic_id to be ultra-broad in this repair phase
UPDATE public.leads l
SET 
  verified_revenue = sub.total_amount,
  status = 'convertido',
  updated_at = NOW()
FROM (
  SELECT 
    l2.id as lead_id,
    SUM(fs.amount_net) as total_amount
  FROM public.leads l2
  JOIN public.financial_settlements fs ON l2.phone_normalized = fs.phone_normalized
  WHERE l2.phone_normalized IS NOT NULL 
    AND fs.phone_normalized IS NOT NULL
    AND fs.cancelled_at IS NULL
  GROUP BY l2.id
) sub
WHERE l.id = sub.lead_id;

COMMIT;
