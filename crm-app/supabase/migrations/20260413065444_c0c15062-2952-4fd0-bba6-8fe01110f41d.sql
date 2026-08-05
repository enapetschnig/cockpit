
CREATE TABLE public.daily_activity (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  date DATE NOT NULL,
  contact_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, date)
);

ALTER TABLE public.daily_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own daily activity"
ON public.daily_activity FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own daily activity"
ON public.daily_activity FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own daily activity"
ON public.daily_activity FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own daily activity"
ON public.daily_activity FOR DELETE
USING (auth.uid() = user_id);

CREATE TRIGGER update_daily_activity_updated_at
BEFORE UPDATE ON public.daily_activity
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
