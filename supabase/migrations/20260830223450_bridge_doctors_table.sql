-- Replay bridge for public.doctors immediately before 20260830223500_seed_canonical_doctors.
-- Clean Preview history never created this table; Production already has it from the
-- baseline schema. CREATE/ADD COLUMN IF NOT EXISTS is a no-op on Production.

CREATE TABLE IF NOT EXISTS public.doctors (
  id uuid PRIMARY KEY,
  clinic_id uuid,
  name text NOT NULL,
  specialty text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.doctors
  ADD COLUMN IF NOT EXISTS clinic_id uuid,
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS specialty text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $doctors_pk$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'public.doctors'::regclass
      AND c.contype = 'p'
  ) THEN
    ALTER TABLE public.doctors
      ADD CONSTRAINT doctors_pkey PRIMARY KEY (id);
  END IF;
END;
$doctors_pk$;
