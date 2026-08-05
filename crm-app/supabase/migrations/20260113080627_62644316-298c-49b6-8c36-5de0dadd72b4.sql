-- Create order_volumes table for monthly tracking
CREATE TABLE public.order_volumes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
  amount NUMERIC NOT NULL DEFAULT 0,
  source TEXT,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, year, month)
);

-- Enable RLS
ALTER TABLE public.order_volumes ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own order volumes"
ON public.order_volumes
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own order volumes"
ON public.order_volumes
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own order volumes"
ON public.order_volumes
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own order volumes"
ON public.order_volumes
FOR DELETE
USING (auth.uid() = user_id);

-- Add updated_at trigger
CREATE TRIGGER update_order_volumes_updated_at
BEFORE UPDATE ON public.order_volumes
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();