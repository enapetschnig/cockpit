-- Remove the unique constraint on (user_id, year, month) to allow multiple entries per month
ALTER TABLE public.order_volumes DROP CONSTRAINT IF EXISTS order_volumes_user_id_year_month_key;

-- Add a performance index for common queries (user + year + month)
CREATE INDEX IF NOT EXISTS idx_order_volumes_user_year_month ON public.order_volumes (user_id, year, month);