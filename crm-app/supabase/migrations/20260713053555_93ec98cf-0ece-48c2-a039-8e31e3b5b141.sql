ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS callback_set_at TIMESTAMPTZ;
UPDATE public.leads SET callback_set_at = updated_at WHERE callback_date IS NOT NULL AND callback_set_at IS NULL;