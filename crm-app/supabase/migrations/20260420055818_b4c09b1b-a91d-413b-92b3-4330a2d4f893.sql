-- Tabelle für frei konfigurierbare Angebote
CREATE TABLE public.offers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#10b981',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own offers" ON public.offers FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own offers" ON public.offers FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own offers" ON public.offers FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own offers" ON public.offers FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_offers_updated_at
BEFORE UPDATE ON public.offers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Spalte für ausgewähltes Angebot am Lead
ALTER TABLE public.leads ADD COLUMN offer_id UUID REFERENCES public.offers(id) ON DELETE SET NULL;

-- Zwei Standard-Angebote für bestehenden User einfügen
INSERT INTO public.offers (user_id, name, color)
SELECT DISTINCT user_id, 'Eigenes Angebot', '#3b82f6' FROM public.leads
ON CONFLICT DO NOTHING;

INSERT INTO public.offers (user_id, name, color)
SELECT DISTINCT user_id, 'Angebotski', '#10b981' FROM public.leads
ON CONFLICT DO NOTHING;