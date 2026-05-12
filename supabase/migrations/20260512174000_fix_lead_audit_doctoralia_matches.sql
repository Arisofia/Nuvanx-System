-- =============================================================================
-- Fix Lead Audit Doctoralia matching
--
-- Lead Audit reads vw_lead_traceability. The previous view only considered a
-- narrow bracket format like [636575326] and exposed patient phone only from the
-- patients table, so Doctoralia rows with Asunto values such as
-- [657174670 - 657174670] could match neither the audit count nor the status UI.
-- =============================================================================

-- Replace vw_lead_traceability without dropping dependent reporting objects.
CREATE OR REPLACE VIEW public.vw_lead_traceability AS
SELECT
  l.id                    AS lead_id,
  l.name                  AS lead_name,
  l.email_normalized,
  l.phone_normalized,
  l.source,
  l.stage,
  l.campaign_id,
  l.campaign_name,
  l.adset_id,
  l.adset_name,
  l.ad_id,
  l.ad_name,
  l.form_id,
  l.form_name,
  l.created_at            AS lead_created_at,
  l.first_outbound_at,
  l.first_inbound_at,
  l.reply_delay_minutes,
  l.appointment_status,
  l.attended_at,
  l.no_show_flag,
  l.revenue               AS estimated_revenue,
  l.verified_revenue      AS crm_verified_revenue,
  l.lost_reason,
  p.id                    AS patient_id,
  p.total_ltv             AS patient_ltv,
  fs.id                   AS settlement_id,
  fs.template_id          AS doctoralia_template_id,
  fs.template_name        AS doctoralia_template_name,
  fs.amount_net           AS doctoralia_net,
  fs.amount_gross         AS doctoralia_gross,
  fs.settled_at           AS settlement_date,
  fs.intake_at            AS settlement_intake_date,
  fs.source_system        AS settlement_source,
  l.user_id               AS lead_user_id,
  p.name                  AS patient_name,
  p.dni                   AS patient_dni,
  COALESCE(p.phone, fs.patient_phone, fs.phone_normalized)::VARCHAR(64) AS patient_phone,
  p.last_visit            AS patient_last_visit,
  dp.doc_patient_id,
  dp.match_confidence,
  dp.match_class,
  fs_first.settled_at     AS first_settlement_at
FROM public.leads l
LEFT JOIN public.users u ON u.id = l.user_id
LEFT JOIN public.patients p
  ON  (p.dni_hash = l.dni_hash AND l.dni_hash IS NOT NULL)
  OR   p.id = l.converted_patient_id
LEFT JOIN LATERAL (
  SELECT
    sub_dp.doc_patient_id,
    sub_dp.match_confidence,
    (CASE
      WHEN sub_dp.lead_id = l.id THEN sub_dp.match_class
      ELSE 'exact_phone'
    END)::VARCHAR(32) AS match_class
  FROM   public.doctoralia_patients sub_dp
  WHERE  (sub_dp.lead_id = l.id)
    OR   (
           u.clinic_id IS NOT NULL
           AND sub_dp.clinic_id = u.clinic_id
           AND sub_dp.phone_primary IS NOT NULL
           AND l.phone_normalized  IS NOT NULL
           AND RIGHT(regexp_replace(sub_dp.phone_primary,    '[^0-9]', '', 'g'), 9)
             = RIGHT(regexp_replace(l.phone_normalized, '[^0-9]', '', 'g'), 9)
         )
  ORDER  BY sub_dp.match_confidence DESC NULLS LAST
  LIMIT  1
) dp ON TRUE
LEFT JOIN LATERAL (
  SELECT id, template_id, template_name, amount_net, amount_gross,
         settled_at, intake_at, source_system, patient_phone, phone_normalized
  FROM   public.financial_settlements sub_fs
  WHERE  sub_fs.cancelled_at IS NULL
    AND  (
           (p.id IS NOT NULL AND sub_fs.patient_id = p.id)
           OR
           (
             u.clinic_id IS NOT NULL
             AND sub_fs.clinic_id = u.clinic_id
             AND l.phone_normalized IS NOT NULL
             AND l.phone_normalized <> ''
             AND (
               RIGHT(regexp_replace(COALESCE(sub_fs.phone_normalized, ''), '[^0-9]', '', 'g'), 9)
                 = RIGHT(regexp_replace(l.phone_normalized, '[^0-9]', '', 'g'), 9)
               OR RIGHT(regexp_replace(COALESCE(public.normalize_phone(sub_fs.patient_phone), ''), '[^0-9]', '', 'g'), 9)
                 = RIGHT(regexp_replace(l.phone_normalized, '[^0-9]', '', 'g'), 9)
               OR EXISTS (
                 SELECT 1
                 FROM regexp_matches(COALESCE(sub_fs.template_name, ''), '\[([^\]]+)\]', 'g') AS bracket(raw_value)
                 CROSS JOIN regexp_split_to_table(bracket.raw_value[1], '[^0-9+]+') AS token(phone_token)
                 WHERE public.normalize_phone(token.phone_token) IS NOT NULL
                   AND RIGHT(regexp_replace(public.normalize_phone(token.phone_token), '[^0-9]', '', 'g'), 9)
                     = RIGHT(regexp_replace(l.phone_normalized, '[^0-9]', '', 'g'), 9)
               )
             )
           )
         )
  ORDER  BY sub_fs.settled_at DESC
  LIMIT  1
) fs ON TRUE
LEFT JOIN LATERAL (
  SELECT settled_at, patient_phone, phone_normalized, template_name
  FROM   public.financial_settlements sub_fs2
  WHERE  sub_fs2.cancelled_at IS NULL
    AND  (
           (p.id IS NOT NULL AND sub_fs2.patient_id = p.id)
           OR
           (
             u.clinic_id IS NOT NULL
             AND sub_fs2.clinic_id = u.clinic_id
             AND l.phone_normalized IS NOT NULL
             AND l.phone_normalized <> ''
             AND (
               RIGHT(regexp_replace(COALESCE(sub_fs2.phone_normalized, ''), '[^0-9]', '', 'g'), 9)
                 = RIGHT(regexp_replace(l.phone_normalized, '[^0-9]', '', 'g'), 9)
               OR RIGHT(regexp_replace(COALESCE(public.normalize_phone(sub_fs2.patient_phone), ''), '[^0-9]', '', 'g'), 9)
                 = RIGHT(regexp_replace(l.phone_normalized, '[^0-9]', '', 'g'), 9)
               OR EXISTS (
                 SELECT 1
                 FROM regexp_matches(COALESCE(sub_fs2.template_name, ''), '\[([^\]]+)\]', 'g') AS bracket(raw_value)
                 CROSS JOIN regexp_split_to_table(bracket.raw_value[1], '[^0-9+]+') AS token(phone_token)
                 WHERE public.normalize_phone(token.phone_token) IS NOT NULL
                   AND RIGHT(regexp_replace(public.normalize_phone(token.phone_token), '[^0-9]', '', 'g'), 9)
                     = RIGHT(regexp_replace(l.phone_normalized, '[^0-9]', '', 'g'), 9)
               )
             )
           )
         )
  ORDER  BY sub_fs2.settled_at ASC
  LIMIT  1
) fs_first ON TRUE
WHERE l.deleted_at IS NULL
  AND (l.source IS NULL OR lower(btrim(l.source)) <> 'doctoralia');

ALTER VIEW public.vw_lead_traceability SET (security_invoker = true);


