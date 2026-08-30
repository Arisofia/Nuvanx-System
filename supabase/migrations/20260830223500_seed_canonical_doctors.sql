-- Migration: 20260830223500_seed_canonical_doctors.sql
-- Description: Seed canonical NUVANX physicians into doctors table and link doctoralia/settlement leads.

DO $$
DECLARE
    v_chamberi_id uuid := '4207023b-eac1-4249-bf0f-d9b1e36a5d7a';
BEGIN
    -- 1. Insert doctors
    INSERT INTO public.doctors (id, clinic_id, name, specialty, is_active)
    VALUES 
      ('11111111-1111-4111-8111-111111111111', v_chamberi_id, 'Dr. José Javier Rivera Tejeda', 'Dirección Médica & Cirugía Cosmética Láser', true),
      ('22222222-2222-4222-8222-222222222222', v_chamberi_id, 'Dra. Ivon Yamileth Rivera Deras', 'Geriatría, Nutrición Clínica & Well-Aging', true),
      ('33333333-3333-4333-8333-333333333333', v_chamberi_id, 'Dr. Fabio Augusto Quiñónez Bareiro', 'Geriatría & Fisiología del Envejecimiento', true)
    ON CONFLICT (id) DO UPDATE 
    SET name = EXCLUDED.name, specialty = EXCLUDED.specialty, is_active = EXCLUDED.is_active;

    -- 2. Backfill leads.doctor_id from Doctoralia JJRT appointments
    UPDATE public.leads l
    SET doctor_id = '11111111-1111-4111-8111-111111111111'
    WHERE l.doctor_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.doctoralia_appointments da
        WHERE da.agenda ILIKE '%JJRT%'
          AND da.patient_phone IS NOT NULL
          AND normalize_phone(da.patient_phone) = l.phone_normalized
      );

    -- 3. Backfill leads.doctor_id from financial settlements
    UPDATE public.leads l
    SET doctor_id = '11111111-1111-4111-8111-111111111111'
    WHERE l.doctor_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.financial_settlements fs
        WHERE fs.agenda_name ILIKE '%JJRT%'
          AND fs.patient_phone IS NOT NULL
          AND normalize_phone(fs.patient_phone) = l.phone_normalized
      );
END $$;
