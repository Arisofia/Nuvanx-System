-- Doctoralia channel reporting views were repaired in production.
-- Fix applied:
-- - v_new_clients_by_channel_detail now resolves client_name from:
--   patient_name, template_patient_name, patient_phone, fallback.
-- - identity_key now uses phone_normalized / patient_phone / DNI / patient name / template patient name.
-- - v_new_clients_by_channel_monthly was recreated preserving user_id and clinic_id.
--
-- No-op migration kept to align local repository history with production state.
select 1;
