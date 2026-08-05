import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from 'sonner';

export interface Offer {
  id: string;
  name: string;
  color: string;
}

export function useOffers() {
  const { user } = useAuth();
  const [offers, setOffers] = useState<Offer[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchOffers = useCallback(async () => {
    if (!user) {
      setOffers([]);
      setIsLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from('offers')
      .select('id, name, color')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching offers:', error);
      setIsLoading(false);
      return;
    }
    setOffers((data as Offer[]) || []);
    setIsLoading(false);
  }, [user]);

  useEffect(() => {
    fetchOffers();
  }, [fetchOffers]);

  const addOffer = useCallback(async (name: string, color: string) => {
    if (!user) return null;
    const { data, error } = await supabase
      .from('offers')
      .insert({ user_id: user.id, name, color })
      .select('id, name, color')
      .single();
    if (error) {
      toast.error('Fehler beim Anlegen');
      return null;
    }
    setOffers(prev => [...prev, data as Offer]);
    toast.success('Angebot hinzugefügt');
    return data as Offer;
  }, [user]);

  const updateOffer = useCallback(async (id: string, updates: Partial<Pick<Offer, 'name' | 'color'>>) => {
    const { error } = await supabase.from('offers').update(updates).eq('id', id);
    if (error) {
      toast.error('Fehler beim Speichern');
      return;
    }
    setOffers(prev => prev.map(o => (o.id === id ? { ...o, ...updates } : o)));
  }, []);

  const deleteOffer = useCallback(async (id: string) => {
    const { error } = await supabase.from('offers').delete().eq('id', id);
    if (error) {
      toast.error('Fehler beim Löschen');
      return;
    }
    setOffers(prev => prev.filter(o => o.id !== id));
    toast.success('Angebot gelöscht');
  }, []);

  return { offers, isLoading, addOffer, updateOffer, deleteOffer, refetch: fetchOffers };
}
