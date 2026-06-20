-- =============================================================================
-- Doctoralia appointment-level ingestion and customer behavior monthly rules
-- =============================================================================

DROP INDEX IF EXISTS public.doctoralia_appointments_ingestion_doctoralia_id_key;

CREATE OR REPLACE VIEW public.doctoralia_appointments
WITH (security_invoker = true) AS
SELECT
  id,
  NULL::UUID AS clinic_id,
  estado,
  appointment_date AS fecha,
  appointment_time AS hora,
  created_date::TIMESTAMPTZ AS fecha_creacion,
  created_time AS hora_creacion,
  subject AS asunto,
  agenda,
  room AS sala_box,
  confirmed AS confirmada,
  origin AS procedencia,
  amount AS importe,
  phone_normalized,
  COALESCE(patient_phone, phone) AS phone_raw,
  patient_name,
  COALESCE(appointment_type, treatment) AS treatment,
  phone AS phone_primary,
  NULL::TEXT AS phone_secondary,
  inserted_at AS created_at,
  source_key,
  appointment_id,
  doctoralia_id,
  patient_email,
  COALESCE(patient_phone, phone) AS patient_phone,
  phone,
  appointment_date,
  appointment_time,
  created_date,
  created_time,
  subject,
  room,
  confirmed,
  origin,
  amount,
  normalized_date,
  COALESCE(appointment_type, treatment) AS appointment_type,
  status,
  notes,
  clinic,
  sheet_row,
  is_cancelled,
  is_jjrt,
  is_nursing,
  is_control,
  raw_data,
  inserted_at,
  updated_at,
  amount AS revenue
FROM public.doctoralia_appointments_ingestion
WHERE appointment_date < CURRENT_DATE
  AND is_cancelled = FALSE
  AND is_control = FALSE;

CREATE OR REPLACE VIEW public.vw_doctoralia_customer_behavior_monthly
WITH (security_invoker = true) AS
WITH real_appointments AS (
  SELECT
    source_key,
    appointment_id,
    doctoralia_id,
    patient_name,
    phone_normalized,
    patient_phone,
    appointment_date,
    amount,
    COALESCE(
      NULLIF(btrim(doctoralia_id), ''),
      NULLIF(btrim(phone_normalized), ''),
      NULLIF(btrim(patient_phone), ''),
      NULLIF(btrim(upper(patient_name)), '')
    ) AS patient_key
  FROM public.doctoralia_appointments
  WHERE appointment_date IS NOT NULL
), sequenced AS (
  SELECT
    *,
    date_trunc('month', appointment_date)::DATE AS month,
    row_number() OVER (
      PARTITION BY patient_key
      ORDER BY appointment_date, source_key
    ) AS visit_number,
    lead(appointment_date) OVER (
      PARTITION BY patient_key
      ORDER BY appointment_date, source_key
    ) AS next_visit_date
  FROM real_appointments
  WHERE patient_key IS NOT NULL
), patient_month AS (
  SELECT
    month,
    patient_key,
    MAX(appointment_date) AS last_visit_in_month,
    MAX(next_visit_date) FILTER (WHERE appointment_date = month_last_visit.last_visit_date) AS next_visit_after_last_in_month
  FROM (
    SELECT
      sequenced.*,
      MAX(appointment_date) OVER (PARTITION BY month, patient_key) AS last_visit_date
    FROM sequenced
  ) AS month_last_visit
  GROUP BY month, patient_key
), monthly_patients AS (
  SELECT DISTINCT month, patient_key
  FROM sequenced
), previous_month_retention AS (
  SELECT
    previous.month + INTERVAL '1 month' AS month,
    COUNT(*) AS previous_month_patients,
    COUNT(current_month.patient_key) AS retained_from_previous,
    COUNT(*) - COUNT(current_month.patient_key) AS churned_from_previous
  FROM monthly_patients AS previous
  LEFT JOIN monthly_patients AS current_month
    ON current_month.month = previous.month + INTERVAL '1 month'
   AND current_month.patient_key = previous.patient_key
  GROUP BY previous.month + INTERVAL '1 month'
), appointment_rollup AS (
  SELECT
    month,
    COUNT(*) AS appointments,
    COUNT(DISTINCT patient_key) AS unique_patients,
    COUNT(DISTINCT patient_key) FILTER (WHERE visit_number = 1) AS first_visit_patients,
    COUNT(DISTINCT patient_key) FILTER (WHERE visit_number = 2) AS new_patients,
    COUNT(DISTINCT patient_key) FILTER (WHERE visit_number >= 3) AS recurrent_patients,
    COUNT(*) FILTER (WHERE visit_number = 1) AS first_visit_appointments,
    COUNT(*) FILTER (WHERE visit_number = 2) AS new_appointments,
    COUNT(*) FILTER (WHERE visit_number >= 3) AS recurrent_appointments,
    COALESCE(SUM(amount), 0)::NUMERIC(14, 2) AS revenue,
    COALESCE(SUM(amount) FILTER (WHERE visit_number = 1), 0)::NUMERIC(14, 2) AS first_visit_revenue,
    COALESCE(SUM(amount) FILTER (WHERE visit_number = 2), 0)::NUMERIC(14, 2) AS new_revenue,
    COALESCE(SUM(amount) FILTER (WHERE visit_number >= 3), 0)::NUMERIC(14, 2) AS recurrent_revenue
  FROM sequenced
  GROUP BY month
), churn_90d AS (
  SELECT
    month,
    COUNT(*) AS churn_90_eligible_patients,
    COUNT(*) FILTER (WHERE next_visit_after_last_in_month <= last_visit_in_month + INTERVAL '90 days') AS retained_90d_patients,
    COUNT(*) FILTER (WHERE next_visit_after_last_in_month IS NULL OR next_visit_after_last_in_month > last_visit_in_month + INTERVAL '90 days') AS churned_90d_patients
  FROM patient_month
  WHERE last_visit_in_month <= CURRENT_DATE - INTERVAL '90 days'
  GROUP BY month
)
SELECT
  appointment_rollup.month,
  appointment_rollup.appointments,
  appointment_rollup.unique_patients,
  appointment_rollup.first_visit_patients,
  appointment_rollup.new_patients,
  appointment_rollup.recurrent_patients,
  appointment_rollup.first_visit_appointments,
  appointment_rollup.new_appointments,
  appointment_rollup.recurrent_appointments,
  ROUND(appointment_rollup.recurrent_patients::NUMERIC * 100 / NULLIF(appointment_rollup.unique_patients, 0), 2) AS recurrent_patient_rate_pct,
  COALESCE(previous_month_retention.previous_month_patients, 0) AS previous_month_patients,
  COALESCE(previous_month_retention.retained_from_previous, 0) AS retained_from_previous,
  COALESCE(previous_month_retention.churned_from_previous, 0) AS churned_from_previous,
  ROUND(COALESCE(previous_month_retention.churned_from_previous, 0)::NUMERIC * 100 / NULLIF(previous_month_retention.previous_month_patients, 0), 2) AS monthly_churn_pct,
  COALESCE(churn_90d.churn_90_eligible_patients, 0) AS churn_90_eligible_patients,
  COALESCE(churn_90d.retained_90d_patients, 0) AS retained_90d_patients,
  COALESCE(churn_90d.churned_90d_patients, 0) AS churned_90d_patients,
  ROUND(COALESCE(churn_90d.churned_90d_patients, 0)::NUMERIC * 100 / NULLIF(churn_90d.churn_90_eligible_patients, 0), 2) AS churn_90d_pct,
  appointment_rollup.revenue,
  appointment_rollup.first_visit_revenue,
  appointment_rollup.new_revenue,
  appointment_rollup.recurrent_revenue
FROM appointment_rollup
LEFT JOIN previous_month_retention
  ON previous_month_retention.month::DATE = appointment_rollup.month
LEFT JOIN churn_90d
  ON churn_90d.month = appointment_rollup.month;

COMMENT ON VIEW public.doctoralia_appointments IS
  'Canonical operational Doctoralia appointments view: past, non-cancelled, non-control real appointments only.';

COMMENT ON VIEW public.vw_doctoralia_customer_behavior_monthly IS
  'Monthly Doctoralia behavior view using appointment-level history: 1ra cita is visit 1, nuevo is visit 2, recurrente is visit 3+, and churn_90d applies only after a 90-day maturity window.';

GRANT SELECT ON public.doctoralia_appointments TO authenticated, service_role;
GRANT SELECT ON public.vw_doctoralia_customer_behavior_monthly TO authenticated, service_role;
