/**
 * Wartungsverträge: je verkaufter Software einer.
 *
 * Die Datenbank-Sicht `software_verkaeufe` durchforstet alle Rechnungen und
 * sagt je Kunde, wann die letzte Software-Rechnung war. Ein Jahr danach
 * endet die inkludierte Betreuung – dort beginnt die Wartung. Was der Kunde
 * monatlich zahlt, steht am Wartungsvertrag; abgerechnet wird jährlich.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from './useAuth';
import { round2 } from '@/types/billing';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface SoftwareVerkauf {
  kunde_key: string;
  customer_id: string | null;
  kunde: string;
  software: string | null;
  letzte_rechnung_id: string;
  letzte_rechnung_nummer: string | null;
  letzte_rechnung_datum: string;
  erste_rechnung_datum: string;
  anzahl_rechnungen: number;
  summe_netto: number;
}

export type WartungStatus = 'offen' | 'aktiv' | 'kein';

export interface Wartungsvertrag {
  id: string;
  user_id: string;
  customer_id: string | null;
  kunde: string;
  software: string | null;
  letzte_rechnung_id: string | null;
  letzte_rechnung_nummer: string | null;
  letzte_rechnung_datum: string | null;
  start_am: string;
  monatlich_netto: number;
  status: WartungStatus;
  notizen: string | null;
  letzte_jahresrechnung_id: string | null;
  abgerechnet_bis: string | null;
  /** Eigener Rechnungstext nur für diesen Kunden (sonst gilt die Vorlage). */
  rechnungstext: string | null;
  created_at: string;
}

/** Eine Zeile auf der Wartungsseite: Verkauf + (falls vorhanden) Wartungsvertrag. */
export interface WartungZeile {
  key: string;
  verkauf: SoftwareVerkauf | null;
  vertrag: Wartungsvertrag | null;
  kunde: string;
  software: string | null;
  letzteRechnung: { id: string | null; nummer: string | null; datum: string | null };
  /** Beginn der Wartung – gespeichert oder vorgeschlagen (letzte Rechnung + 1 Jahr). */
  startAm: string;
  monatlich: number;
  status: WartungStatus;
  /** Bis wann schon in Rechnung gestellt. */
  abgerechnetBis: string | null;
  /** Nächste Jahresrechnung wäre ab hier fällig. */
  naechsteAb: string;
}

export const plusMonate = (d: string, n: number) => {
  const x = new Date(d); x.setMonth(x.getMonth() + n); return x.toISOString().slice(0, 10);
};

export function useWartung() {
  const { user } = useAuth();
  const [verkaeufe, setVerkaeufe] = useState<SoftwareVerkauf[]>([]);
  const [vertraege, setVertraege] = useState<Wartungsvertrag[]>([]);
  const [isLoading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) { setVerkaeufe([]); setVertraege([]); setLoading(false); return; }
    const [{ data: v }, { data: w }] = await Promise.all([
      db.from('software_verkaeufe').select('*').order('letzte_rechnung_datum', { ascending: false }),
      db.from('wartungsvertraege').select('*'),
    ]);
    setVerkaeufe((v as SoftwareVerkauf[]) || []);
    setVertraege((w as Wartungsvertrag[]) || []);
    setLoading(false);
  }, [user]);
  useEffect(() => { load(); }, [load]);

  const zeilen = useMemo<WartungZeile[]>(() => {
    const out: WartungZeile[] = [];
    const benutzt = new Set<string>();
    // Ein Wartungsvertrag gehört zu einem Verkauf über customer_id oder – ohne Kunde – über den Namen.
    const findeVertrag = (s: SoftwareVerkauf) => vertraege.find((w) =>
      (s.customer_id && w.customer_id === s.customer_id) || (!s.customer_id && w.kunde.trim().toLowerCase() === s.kunde.trim().toLowerCase()));
    for (const s of verkaeufe) {
      const w = findeVertrag(s) || null;
      if (w) benutzt.add(w.id);
      const startAm = w?.start_am || plusMonate(s.letzte_rechnung_datum, 12);
      out.push({
        key: s.kunde_key, verkauf: s, vertrag: w, kunde: w?.kunde || s.kunde, software: w?.software || s.software,
        letzteRechnung: { id: s.letzte_rechnung_id, nummer: s.letzte_rechnung_nummer, datum: s.letzte_rechnung_datum },
        startAm, monatlich: Number(w?.monatlich_netto ?? 50), status: w?.status || 'offen',
        abgerechnetBis: w?.abgerechnet_bis || null,
        naechsteAb: w?.abgerechnet_bis || startAm,
      });
    }
    // Manuell angelegte Wartungsverträge ohne erkannten Verkauf
    for (const w of vertraege) {
      if (benutzt.has(w.id)) continue;
      out.push({
        key: w.id, verkauf: null, vertrag: w, kunde: w.kunde, software: w.software,
        letzteRechnung: { id: w.letzte_rechnung_id, nummer: w.letzte_rechnung_nummer, datum: w.letzte_rechnung_datum },
        startAm: w.start_am, monatlich: Number(w.monatlich_netto), status: w.status,
        abgerechnetBis: w.abgerechnet_bis, naechsteAb: w.abgerechnet_bis || w.start_am,
      });
    }
    return out.sort((a, b) => a.naechsteAb.localeCompare(b.naechsteAb));
  }, [verkaeufe, vertraege]);

  const heute = new Date().toISOString().slice(0, 10);
  const bald = plusMonate(heute, 1);
  /** Wartung beginnt (oder das abgerechnete Jahr endet) innerhalb eines Monats oder ist schon vorbei. */
  const faellig = zeilen.filter((z) => z.status !== 'kein' && z.naechsteAb <= bald);

  return { zeilen, faellig, isLoading, reload: load, heute };
}

/** Wartungsvertrag anlegen oder ändern – aus einer Zeile heraus. */
export async function speichereWartung(z: WartungZeile, patch: Partial<Wartungsvertrag>, userId: string): Promise<string | null> {
  const basis = {
    user_id: userId,
    customer_id: z.vertrag?.customer_id ?? z.verkauf?.customer_id ?? null,
    kunde: z.kunde, software: z.software,
    letzte_rechnung_id: z.letzteRechnung.id, letzte_rechnung_nummer: z.letzteRechnung.nummer, letzte_rechnung_datum: z.letzteRechnung.datum,
    start_am: z.startAm, monatlich_netto: round2(z.monatlich), status: z.status,
    updated_at: new Date().toISOString(),
    ...patch,
  };
  if (z.vertrag) {
    const { error } = await db.from('wartungsvertraege').update(basis).eq('id', z.vertrag.id);
    if (error) { toast.error('Speichern fehlgeschlagen: ' + error.message); return null; }
    return z.vertrag.id;
  }
  const { data, error } = await db.from('wartungsvertraege').insert(basis).select('id').single();
  if (error) { toast.error('Anlegen fehlgeschlagen: ' + error.message); return null; }
  return data.id as string;
}
