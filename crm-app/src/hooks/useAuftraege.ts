import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { round2 } from '@/types/billing';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface Zeile {
  id: string; projekt_id: string | null; number: string | null; kind: string; status: string;
  net: number; project_total: number | null; rest_faellig_am: string | null;
  doc_date: string; recipient_company: string | null; recipient_name: string | null;
  customer_id: string | null;
}

/** Ein Auftrag, der in mehreren Rechnungen abgerechnet wird. */
export interface Auftrag {
  projektId: string;
  kunde: string;
  gesamt: number;        // Auftragswert netto
  verrechnet: number;    // bereits in Rechnung gestellt (netto, ohne Stornos)
  offen: number;         // noch nicht verrechnet
  restFaelligAm: string | null;
  rechnungen: { id: string; number: string | null; net: number; doc_date: string; status: string }[];
  /** Die zuletzt geschriebene Rechnung – von ihr erbt die Restrechnung Empfänger und Texte. */
  letzteId: string;
}

/**
 * Aufträge, die noch nicht vollständig verrechnet sind.
 *
 * Ein Auftrag ist die Klammer über mehrere Rechnungen (`projekt_id`). Was noch
 * offen ist, ergibt sich aus dem Auftragswert minus allem, was bereits
 * fakturiert wurde – stornierte Rechnungen zählen dabei nicht mit.
 */
export function useAuftraege() {
  const { user } = useAuth();
  const [zeilen, setZeilen] = useState<Zeile[]>([]);
  const [isLoading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) { setZeilen([]); setLoading(false); return; }
    const { data } = await db.from('documents')
      .select('id,projekt_id,number,kind,status,net,project_total,rest_faellig_am,doc_date,recipient_company,recipient_name,customer_id')
      .not('projekt_id', 'is', null)
      .in('kind', ['invoice', 'partial_invoice', 'final_invoice'])
      .order('doc_date', { ascending: true })
      .limit(2000);
    setZeilen((data as Zeile[]) || []);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const auftraege = useMemo(() => {
    const gruppen = new Map<string, Zeile[]>();
    for (const z of zeilen) {
      const k = z.projekt_id as string;
      (gruppen.get(k) ?? gruppen.set(k, []).get(k)!).push(z);
    }
    const out: Auftrag[] = [];
    for (const [projektId, rows] of gruppen) {
      const aktiv = rows.filter((r) => r.status !== 'cancelled');
      if (!aktiv.length) continue;
      // Der Auftragswert steht auf jeder Rechnung der Kette – der zuletzt
      // gesetzte gilt, falls er unterwegs korrigiert wurde.
      const gesamt = round2(Number([...rows].reverse().find((r) => r.project_total)?.project_total || 0));
      const verrechnet = round2(aktiv.reduce((a, r) => a + Number(r.net || 0), 0));
      const offen = round2(gesamt - verrechnet);
      const letzte = aktiv[aktiv.length - 1];
      out.push({
        projektId, gesamt, verrechnet, offen,
        kunde: letzte.recipient_company || letzte.recipient_name || '—',
        restFaelligAm: [...aktiv].reverse().find((r) => r.rest_faellig_am)?.rest_faellig_am ?? null,
        rechnungen: aktiv.map((r) => ({ id: r.id, number: r.number, net: Number(r.net || 0), doc_date: r.doc_date, status: r.status })),
        letzteId: letzte.id,
      });
    }
    return out.sort((a, b) => (a.restFaelligAm || '9999').localeCompare(b.restFaelligAm || '9999'));
  }, [zeilen]);

  const offeneAuftraege = auftraege.filter((a) => a.offen > 0.01);
  const heute = new Date().toISOString().slice(0, 10);
  /** Restrechnungen, deren geplanter Zeitpunkt erreicht ist. */
  const faellig = offeneAuftraege.filter((a) => a.restFaelligAm && a.restFaelligAm <= heute);

  return {
    auftraege, offeneAuftraege, faellig,
    offenSumme: round2(offeneAuftraege.reduce((a, x) => a + x.offen, 0)),
    isLoading, reload: load,
  };
}

/** Die Auftragskette eines einzelnen Belegs – für den Hinweis im Beleg selbst. */
export function useAuftragVon(projektId?: string | null) {
  const { auftraege, isLoading, reload } = useAuftraege();
  return { auftrag: projektId ? auftraege.find((a) => a.projektId === projektId) ?? null : null, isLoading, reload };
}
