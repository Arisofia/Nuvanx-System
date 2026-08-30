CREATE OR REPLACE FUNCTION public.nvx_normalize_meta_daily_conversions()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_lead integer := 0;
  v_grouped integer := 0;
  v_contact integer := 0;
  v_messaging integer := 0;
BEGIN
  IF new.actions IS NOT NULL THEN
    BEGIN v_lead := COALESCE(NULLIF(new.actions->>'lead','')::integer,0); EXCEPTION WHEN OTHERS THEN v_lead := 0; END;
    BEGIN v_grouped := COALESCE(NULLIF(new.actions->>'onsite_conversion.lead_grouped','')::integer,0); EXCEPTION WHEN OTHERS THEN v_grouped := 0; END;
    BEGIN v_contact := COALESCE(NULLIF(new.actions->>'contact_total','')::integer,0); EXCEPTION WHEN OTHERS THEN v_contact := 0; END;
  END IF;
  v_messaging := COALESCE(new.messaging_conversations,0);
  new.conversions := GREATEST(v_lead,v_grouped,v_contact,v_messaging);
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_nvx_normalize_meta_daily_conversions ON public.meta_daily_insights;
CREATE TRIGGER trg_nvx_normalize_meta_daily_conversions
BEFORE INSERT OR UPDATE OF actions,messaging_conversations,conversions
ON public.meta_daily_insights
FOR EACH ROW EXECUTE FUNCTION public.nvx_normalize_meta_daily_conversions();

UPDATE public.meta_daily_insights
SET conversions = GREATEST(
  CASE WHEN actions->>'lead' ~ '^-?[0-9]+$' THEN (actions->>'lead')::integer ELSE 0 END,
  CASE WHEN actions->>'onsite_conversion.lead_grouped' ~ '^-?[0-9]+$' THEN (actions->>'onsite_conversion.lead_grouped')::integer ELSE 0 END,
  CASE WHEN actions->>'contact_total' ~ '^-?[0-9]+$' THEN (actions->>'contact_total')::integer ELSE 0 END,
  COALESCE(messaging_conversations,0)
);
