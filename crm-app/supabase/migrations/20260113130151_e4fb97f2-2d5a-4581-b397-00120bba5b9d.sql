-- Add callback_comment column to leads table
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS callback_comment text;