-- Create leads table
CREATE TABLE public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  company_name TEXT,
  source TEXT NOT NULL DEFAULT 'other',
  stage TEXT NOT NULL DEFAULT 'new',
  is_entrepreneur BOOLEAN DEFAULT false,
  has_more_than_5_employees BOOLEAN DEFAULT false,
  qualification_notes TEXT,
  meeting_date TIMESTAMPTZ,
  meeting_appeared BOOLEAN,
  sale_amount NUMERIC,
  callback_date TIMESTAMPTZ,
  ad_name TEXT,
  campaign_name TEXT,
  platform TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create contact_logs table
CREATE TABLE public.contact_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  date TIMESTAMPTZ NOT NULL DEFAULT now(),
  type TEXT NOT NULL,
  comment TEXT,
  reached_customer BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for leads
CREATE POLICY "Users can view their own leads"
ON public.leads FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own leads"
ON public.leads FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own leads"
ON public.leads FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own leads"
ON public.leads FOR DELETE
USING (auth.uid() = user_id);

-- RLS Policies for contact_logs (via lead ownership)
CREATE POLICY "Users can view contact logs for their leads"
ON public.contact_logs FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.leads
  WHERE leads.id = contact_logs.lead_id
  AND leads.user_id = auth.uid()
));

CREATE POLICY "Users can create contact logs for their leads"
ON public.contact_logs FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM public.leads
  WHERE leads.id = contact_logs.lead_id
  AND leads.user_id = auth.uid()
));

CREATE POLICY "Users can update contact logs for their leads"
ON public.contact_logs FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM public.leads
  WHERE leads.id = contact_logs.lead_id
  AND leads.user_id = auth.uid()
));

CREATE POLICY "Users can delete contact logs for their leads"
ON public.contact_logs FOR DELETE
USING (EXISTS (
  SELECT 1 FROM public.leads
  WHERE leads.id = contact_logs.lead_id
  AND leads.user_id = auth.uid()
));

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_leads_updated_at
BEFORE UPDATE ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();