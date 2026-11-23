import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from 'sonner';
import { STAGE_LABELS, type BuiltinStage } from '@/types/lead';

const db = supabase as any;

/** Eine Spalte der Lead-Pipeline (crm.lead_phasen). leads.stage zeigt auf schluessel. */
export interface LeadPhase {
  schluessel: string;
  name: string;
  farbe: string;
  reihenfolge: number;
  ausgeblendet: boolean;
  /** Bisherige Spalten – Kennzahlen/Rückrufe rechnen damit, darum nur ausblenden statt löschen. */
  fest: boolean;
}

const STANDARD_FARBEN: Record<BuiltinStage, string> = {
  new: '#3b82f6', contacted: '#f59e0b', follow_up: '#f97316', qualified: '#22c55e', unqualified: '#64748b',
  meeting_scheduled: '#06b6d4', meeting_done: '#14b8a6', no_show: '#ec4899', won: '#059669', lost: '#ef4444',
};

// Falls die Tabelle (noch) nicht lädt: die bisherigen Spalten, damit die Pipeline nie leer ist.
const STANDARD: LeadPhase[] = (Object.keys(STAGE_LABELS) as BuiltinStage[]).map((s, i) => ({
  schluessel: s, name: STAGE_LABELS[s], farbe: STANDARD_FARBEN[s], reihenfolge: (i + 1) * 10,
  ausgeblendet: s === 'unqualified', fest: true,
}));

export const PHASEN_FARBEN = ['#3b82f6', '#06b6d4', '#14b8a6', '#22c55e', '#059669', '#84cc16', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#8b5cf6', '#64748b'];

export function useLeadPhasen() {
  const { user } = useAuth();
  const [phasen, setPhasen] = useState<LeadPhase[]>(STANDARD);

  const laden = useCallback(async () => {
    if (!user) return;
    const { data, error } = await db.from('lead_phasen').select('schluessel,name,farbe,reihenfolge,ausgeblendet,fest').order('reihenfolge');
    if (!error && data?.length) setPhasen(data as LeadPhase[]);
  }, [user]);

  useEffect(() => { laden(); }, [laden]);

  const aendern = useCallback(async (schluessel: string, werte: Partial<Pick<LeadPhase, 'name' | 'farbe' | 'ausgeblendet'>>) => {
    setPhasen((p) => p.map((x) => (x.schluessel === schluessel ? { ...x, ...werte } : x)));
    const { error } = await db.from('lead_phasen').update(werte).eq('schluessel', schluessel);
    if (error) { toast.error('Spalte nicht gespeichert'); laden(); }
  }, [laden]);

  /** Eine Spalte nach oben (-1) oder unten (+1) – tauscht die Reihenfolge mit der Nachbarspalte. */
  const verschieben = useCallback(async (schluessel: string, richtung: -1 | 1) => {
    const i = phasen.findIndex((x) => x.schluessel === schluessel);
    const j = i + richtung;
    if (i < 0 || j < 0 || j >= phasen.length) return;
    const neu = phasen.map((x, k) => ({ ...x, reihenfolge: (k + 1) * 10 }));
    [neu[i].reihenfolge, neu[j].reihenfolge] = [neu[j].reihenfolge, neu[i].reihenfolge];
    neu.sort((a, b) => a.reihenfolge - b.reihenfolge);
    setPhasen(neu);
    const fehler = (await Promise.all(neu.map((x) => db.from('lead_phasen').update({ reihenfolge: x.reihenfolge }).eq('schluessel', x.schluessel))))
      .some((r: any) => r.error);
    if (fehler) { toast.error('Reihenfolge nicht gespeichert'); laden(); }
  }, [phasen, laden]);

  const anlegen = useCallback(async (name: string, farbe: string) => {
    const schluessel = `p_${crypto.randomUUID().slice(0, 8)}`;
    const reihenfolge = Math.max(0, ...phasen.map((x) => x.reihenfolge)) + 10;
    const { error } = await db.from('lead_phasen').insert({ schluessel, name, farbe, reihenfolge });
    if (error) { toast.error('Spalte nicht angelegt'); return; }
    setPhasen((p) => [...p, { schluessel, name, farbe, reihenfolge, ausgeblendet: false, fest: false }]);
  }, [phasen]);

  /** Eigene Spalte löschen – ihre Leads wandern vorher in die gewählte Spalte, es geht kein Lead verloren. */
  const loeschen = useCallback(async (schluessel: string, ziel: string) => {
    const { error: e1 } = await supabase.from('leads').update({ stage: ziel }).eq('stage', schluessel);
    if (e1) { toast.error('Leads nicht verschoben – Spalte bleibt'); return false; }
    const { error } = await db.from('lead_phasen').delete().eq('schluessel', schluessel);
    if (error) { toast.error(error.message || 'Spalte nicht gelöscht'); return false; }
    setPhasen((p) => p.filter((x) => x.schluessel !== schluessel));
    return true;
  }, []);

  return { phasen, aendern, verschieben, anlegen, loeschen };
}
