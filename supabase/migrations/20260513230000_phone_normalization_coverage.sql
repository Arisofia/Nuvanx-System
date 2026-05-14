-- =============================================================================
-- Phone normalization coverage diagnostics
--
-- Provides a single safe RPC for the Lead Audit investigation so operators do
-- not need to run ad hoc COUNT(*) queries per table. The function is forward-
-- safe for preview databases where Doctoralia tables/columns may be absent.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_phone_normalization_coverage(p_clinic_id UUID DEFAULT NULL)
RETURNS TABLE (
  source_table TEXT,
  table_exists BOOLEAN,
  phone_column_exists BOOLEAN,
  clinic_scoped BOOLEAN,
  total_records BIGINT,
  records_with_phone BIGINT,
  records_without_phone BIGINT,
  coverage_pct NUMERIC
)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  target RECORD;
  has_table BOOLEAN;
  has_phone_column BOOLEAN;
  has_clinic_column BOOLEAN;
  should_scope_by_clinic BOOLEAN;
  row_total BIGINT := 0;
  row_with_phone BIGINT := 0;
  scope_predicate TEXT := 'TRUE';
BEGIN
  FOR target IN
    SELECT table_name
    FROM (VALUES
      ('leads'),
      ('patients'),
      ('doctoralia_patients')
    ) AS monitored_tables(table_name)
  LOOP
    has_table := to_regclass(format('public.%I', target.table_name)) IS NOT NULL;

    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = target.table_name
        AND c.column_name = 'phone_normalized'
    )
    INTO has_phone_column;

    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = target.table_name
        AND c.column_name = 'clinic_id'
    )
    INTO has_clinic_column;

    should_scope_by_clinic := p_clinic_id IS NOT NULL AND has_clinic_column;
    scope_predicate := CASE
      WHEN should_scope_by_clinic THEN format('clinic_id = %L::uuid', p_clinic_id)
      ELSE 'TRUE'
    END;

    row_total := 0;
    row_with_phone := 0;

    IF has_table AND has_phone_column THEN
      EXECUTE format(
        'SELECT COUNT(*)::bigint,
                COUNT(*) FILTER (WHERE NULLIF(btrim(phone_normalized::text), '''') IS NOT NULL)::bigint
           FROM public.%I
          WHERE %s',
        target.table_name,
        scope_predicate
      )
      INTO row_total, row_with_phone;
    ELSIF has_table THEN
      EXECUTE format(
        'SELECT COUNT(*)::bigint
           FROM public.%I
          WHERE %s',
        target.table_name,
        scope_predicate
      )
      INTO row_total;
    END IF;

    source_table := target.table_name;
    table_exists := has_table;
    phone_column_exists := has_phone_column;
    clinic_scoped := should_scope_by_clinic;
    total_records := COALESCE(row_total, 0);
    records_with_phone := COALESCE(row_with_phone, 0);
    records_without_phone := GREATEST(total_records - records_with_phone, 0);
    coverage_pct := CASE
      WHEN total_records > 0 THEN round((records_with_phone::NUMERIC / total_records::NUMERIC) * 100, 2)
      ELSE 0
    END;

    RETURN NEXT;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.get_phone_normalization_coverage(UUID) IS
  'Returns COUNT(*)-based coverage of usable phone_normalized values for lead matching diagnostics, optionally scoped by clinic_id when the table supports it.';

GRANT EXECUTE ON FUNCTION public.get_phone_normalization_coverage(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_phone_normalization_coverage(UUID) TO service_role;
