import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

interface OpenRow { id: string; number: string | null; gross: number; due_date: string | null; status: string;
  recipient_company: string | null; recipient_name: string | null; doc_date: string; kind: string }

/** Offene Rechnungen (unbezahlt) – für Kopfzeile & Startseiten-Übersicht. */
export function useOpenInvoices() {
  const { user } = useAuth();
  const [rows, setRows] = useState<OpenRow[]>([]);
  const [isLoading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) { setRows([]); setLoading(false); return; }
    const { data } = await db.from('documents')
      .select('id,number,gross,due_date,status,recipient_company,recipient_name,doc_date,kind')
      .in('kind', ['invoice', 'partial_invoice', 'final_invoice'])
      .not('status', 'in', '("paid","cancelled")')
      .order('due_date', { ascending: true })
      .limit(300);
    setRows((data as OpenRow[]) || []);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const today = new Date().setHours(0, 0, 0, 0);
  const overdue = rows.filter((r) => r.due_date && new Date(r.due_date).getTime() < today);

  return {
    open: rows,
    overdue,
    openCount: rows.length,
    overdueCount: overdue.length,
    openSum: rows.reduce((a, r) => a + Number(r.gross || 0), 0),
    overdueSum: overdue.reduce((a, r) => a + Number(r.gross || 0), 0),
    isLoading,
    reload: load,
  };
}
