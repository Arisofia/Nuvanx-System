-- =============================================================================
-- Remove global patients.dni uniqueness in favor of clinic-scoped identity
--
-- Revenue OS is multi-clinic. A DNI can legitimately appear in more than one
-- clinic, so the global UNIQUE(dni) constraint is too restrictive. Keep the
-- clinic-scoped unique index on (clinic_id, dni) for tenant-safe identity.
-- =============================================================================

DO $$
DECLARE
  dni_attnum SMALLINT;
  duplicate_dni RECORD;
  global_constraint RECORD;
  global_index RECORD;
BEGIN
  IF to_regclass('public.patients') IS NULL THEN
    RAISE NOTICE 'Skipping patients.dni uniqueness hardening: public.patients does not exist';
    RETURN;
  END IF;

  SELECT attnum
    INTO dni_attnum
  FROM pg_attribute
  WHERE attrelid = 'public.patients'::regclass
    AND attname = 'dni'
    AND NOT attisdropped;

  IF dni_attnum IS NULL THEN
    RAISE NOTICE 'Skipping patients.dni uniqueness hardening: public.patients.dni does not exist';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'patients'
      AND column_name = 'clinic_id'
  ) THEN
    SELECT clinic_id, dni, COUNT(*) AS duplicate_count
      INTO duplicate_dni
    FROM public.patients
    WHERE dni IS NOT NULL
    GROUP BY clinic_id, dni
    HAVING COUNT(*) > 1
    LIMIT 1;

    IF duplicate_dni IS NULL THEN
      CREATE UNIQUE INDEX IF NOT EXISTS patients_clinic_dni_uq
        ON public.patients (clinic_id, dni)
        WHERE dni IS NOT NULL;
    ELSE
      RAISE NOTICE 'Skipping patients_clinic_dni_uq: duplicate DNI % exists in clinic % (% rows)',
        duplicate_dni.dni,
        duplicate_dni.clinic_id,
        duplicate_dni.duplicate_count;
    END IF;
  ELSE
    RAISE NOTICE 'Skipping clinic-scoped patients DNI unique index: public.patients.clinic_id does not exist';
  END IF;

  FOR global_constraint IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.patients'::regclass
      AND con.contype = 'u'
      AND con.conkey = ARRAY[dni_attnum]::SMALLINT[]
  LOOP
    EXECUTE format('ALTER TABLE public.patients DROP CONSTRAINT IF EXISTS %I', global_constraint.conname);
    RAISE NOTICE 'Dropped global patients.dni unique constraint: %', global_constraint.conname;
  END LOOP;

  FOR global_index IN
    SELECT idx_cls.relname AS index_name
    FROM pg_index idx
    JOIN pg_class idx_cls ON idx_cls.oid = idx.indexrelid
    JOIN pg_namespace idx_ns ON idx_ns.oid = idx_cls.relnamespace
    WHERE idx.indrelid = 'public.patients'::regclass
      AND idx.indisunique
      AND idx.indpred IS NULL
      AND idx.indnkeyatts = 1
      AND idx.indkey[1] = dni_attnum
      AND NOT EXISTS (
        SELECT 1
        FROM pg_constraint con
        WHERE con.conindid = idx.indexrelid
      )
      AND idx_ns.nspname = 'public'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', global_index.index_name);
    RAISE NOTICE 'Dropped standalone global patients.dni unique index: %', global_index.index_name;
  END LOOP;

  ANALYZE public.patients;
END $$;
