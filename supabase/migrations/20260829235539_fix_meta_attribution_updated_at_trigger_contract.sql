ALTER TABLE public.meta_attribution
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.meta_attribution
SET updated_at = COALESCE(captured_at, now())
WHERE updated_at IS NULL;
