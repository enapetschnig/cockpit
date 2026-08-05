-- Create DMC contacts table for Direct Mailing + Cold Calling
CREATE TABLE public.dmc_contacts (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    company_name TEXT NOT NULL,
    ceo_name TEXT,
    street TEXT,
    postal_code TEXT,
    city TEXT,
    region TEXT,
    phone TEXT,
    email TEXT,
    source_url TEXT,
    stage TEXT NOT NULL DEFAULT 'new',
    letter_sent_date TIMESTAMP WITH TIME ZONE,
    first_contact_date TIMESTAMP WITH TIME ZONE,
    contact_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.dmc_contacts ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for dmc_contacts
CREATE POLICY "Users can view their own dmc contacts" 
ON public.dmc_contacts 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own dmc contacts" 
ON public.dmc_contacts 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own dmc contacts" 
ON public.dmc_contacts 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own dmc contacts" 
ON public.dmc_contacts 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_dmc_contacts_updated_at
BEFORE UPDATE ON public.dmc_contacts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();