-- Replay bridge for the canonical clinical core before the doctor seed.
-- Clean Preview history reaches the canonical seed without these base tables because
-- their original creation was performed outside the reproducible migration chain.
-- The statements are idempotent in Production and also close tenant access fail-closed.

DO $enum$
BEGIN
  IF to_regtype('public.appointment_status') IS NULL THEN
    CREATE TYPE public.appointment_status AS ENUM (
      'scheduled',
      'confirmed',
      'showed',
      'no_show',
      'cancelled'
    );
  END IF;
END
$enum$;

CREATE TABLE IF NOT EXISTS public.doctors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  name varchar(255) NOT NULL,
  specialty varchar(128),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.treatment_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  name varchar(255) NOT NULL,
  category varchar(64),
  base_price numeric NOT NULL DEFAULT 0,
  estimated_cost numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  doctor_id uuid REFERENCES public.doctors(id) ON DELETE SET NULL,
  treatment_type_id uuid REFERENCES public.treatment_types(id) ON DELETE SET NULL,
  start_time timestamptz NOT NULL,
  end_time timestamptz,
  status public.appointment_status NOT NULL DEFAULT 'scheduled',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  attended_at timestamptz,
  cancelled_at timestamptz,
  no_show_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_doctors_clinic_id
  ON public.doctors (clinic_id);
CREATE INDEX IF NOT EXISTS idx_treatment_types_clinic_id
  ON public.treatment_types (clinic_id);
CREATE INDEX IF NOT EXISTS idx_appointments_clinic_id
  ON public.appointments (clinic_id);
CREATE INDEX IF NOT EXISTS idx_appointments_patient_id
  ON public.appointments (patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_doctor_id
  ON public.appointments (doctor_id);
CREATE INDEX IF NOT EXISTS idx_appointments_treatment_type_id
  ON public.appointments (treatment_type_id);

-- The lead columns are introduced by the earlier clean-replay bridge. Add the same
-- referential contract Production carries once their target tables now exist.
DO $constraints$
BEGIN
  IF to_regclass('public.leads') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.leads'::regclass
        AND conname = 'leads_doctor_id_fkey'
    ) THEN
      ALTER TABLE public.leads
        ADD CONSTRAINT leads_doctor_id_fkey
        FOREIGN KEY (doctor_id) REFERENCES public.doctors(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.leads'::regclass
        AND conname = 'leads_treatment_type_id_fkey'
    ) THEN
      ALTER TABLE public.leads
        ADD CONSTRAINT leads_treatment_type_id_fkey
        FOREIGN KEY (treatment_type_id) REFERENCES public.treatment_types(id) ON DELETE SET NULL;
    END IF;
  END IF;
END
$constraints$;

ALTER TABLE public.doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treatment_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.doctors FROM PUBLIC, anon;
REVOKE ALL PRIVILEGES ON TABLE public.treatment_types FROM PUBLIC, anon;
REVOKE ALL PRIVILEGES ON TABLE public.appointments FROM PUBLIC, anon;

GRANT ALL PRIVILEGES ON TABLE public.doctors TO authenticated, service_role;
GRANT ALL PRIVILEGES ON TABLE public.treatment_types TO authenticated, service_role;
GRANT ALL PRIVILEGES ON TABLE public.appointments TO authenticated, service_role;

-- Remove broad/permissive historical policies before installing one canonical,
-- tenant-scoped contract. PostgreSQL combines permissive policies with OR, so leaving
-- the old deny-anonymous-only policy in place would defeat clinic isolation.
DROP POLICY IF EXISTS deny_anonymous_authenticated ON public.doctors;
DROP POLICY IF EXISTS doctors_select_clinic ON public.doctors;
DROP POLICY IF EXISTS doctors_clinic_isolation ON public.doctors;
CREATE POLICY doctors_clinic_isolation
  ON public.doctors
  FOR ALL
  TO authenticated
  USING (
    coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) IS FALSE
    AND clinic_id = (select public.current_clinic_id())
  )
  WITH CHECK (
    coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) IS FALSE
    AND clinic_id = (select public.current_clinic_id())
  );

DROP POLICY IF EXISTS deny_anonymous_authenticated ON public.treatment_types;
DROP POLICY IF EXISTS treatment_types_select_clinic ON public.treatment_types;
DROP POLICY IF EXISTS treatment_types_clinic_isolation ON public.treatment_types;
CREATE POLICY treatment_types_clinic_isolation
  ON public.treatment_types
  FOR ALL
  TO authenticated
  USING (
    coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) IS FALSE
    AND clinic_id = (select public.current_clinic_id())
  )
  WITH CHECK (
    coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) IS FALSE
    AND clinic_id = (select public.current_clinic_id())
  );

DROP POLICY IF EXISTS deny_anonymous_authenticated ON public.appointments;
DROP POLICY IF EXISTS appointments_select_clinic ON public.appointments;
DROP POLICY IF EXISTS appointments_clinic_isolation ON public.appointments;
CREATE POLICY appointments_clinic_isolation
  ON public.appointments
  FOR ALL
  TO authenticated
  USING (
    coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) IS FALSE
    AND clinic_id = (select public.current_clinic_id())
  )
  WITH CHECK (
    coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) IS FALSE
    AND clinic_id = (select public.current_clinic_id())
  );
