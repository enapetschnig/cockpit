import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from './useAuth';
import type { Contract } from '@/lib/vertrag';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export function useContracts() {
  const { user } = useAuth();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [isLoading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!user) { setContracts([]); setLoading(false); return; }
    const { data } = await db.from('contracts').select('*').order('created_at', { ascending: false }).limit(500);
    setContracts((data as Contract[]) || []);
    setLoading(false);
  }, [user]);
  useEffect(() => { load(); }, [load]);
  return { contracts, isLoading, reload: load };
}

export function useContract(id?: string) {
  const { user } = useAuth();
  const [contract, setContract] = useState<Contract | null>(null);
  const [isLoading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!user || !id) { setContract(null); setLoading(false); return; }
    const { data } = await db.from('contracts').select('*').eq('id', id).maybeSingle();
    setContract((data as Contract) || null);
    setLoading(false);
  }, [user, id]);
  useEffect(() => { load(); }, [load]);
  return { contract, isLoading, reload: load };
}

/** Anlegen oder ändern – gibt die id zurück. */
export async function saveContract(v: Partial<Contract>, userId: string): Promise<string | null> {
  const payload = { ...v, user_id: userId, updated_at: new Date().toISOString() };
  if (v.id) {
    const { error } = await db.from('contracts').update(payload).eq('id', v.id);
    if (error) { toast.error('Speichern fehlgeschlagen: ' + error.message); return null; }
    return v.id;
  }
  const { data, error } = await db.from('contracts').insert(payload).select('id').single();
  if (error) { toast.error('Anlegen fehlgeschlagen: ' + error.message); return null; }
  return data.id as string;
}

/** Verbindliche Vertragsnummer – erst beim ersten Speichern, nicht für Entwürfe im Kopf. */
export async function reserveContractNumber(): Promise<string | null> {
  const { data, error } = await db.rpc('next_contract_number');
  if (error) { toast.error('Vertragsnummer konnte nicht vergeben werden'); return null; }
  return data as string;
}

export async function deleteContract(id: string): Promise<boolean> {
  const { error } = await db.from('contracts').delete().eq('id', id);
  if (error) { toast.error('Löschen fehlgeschlagen'); return false; }
  return true;
}
