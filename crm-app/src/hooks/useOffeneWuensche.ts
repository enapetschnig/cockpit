import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/**
 * Anzahl der noch nicht gesehenen Meldungen aus den Handwerker-Apps.
 * Füttert den Zähler in der Kopfzeile – deshalb bewusst nur ein count,
 * nicht die ganzen Datensätze.
 */
export function useOffeneWuensche() {
  const { user } = useAuth();
  const [anzahl, setAnzahl] = useState(0);

  const load = useCallback(async () => {
    if (!user) { setAnzahl(0); return; }
    const { count } = await db.from('app_wuensche')
      .select('id', { count: 'exact', head: true })
      .is('gesehen_am', null);
    setAnzahl(count ?? 0);
  }, [user]);

  useEffect(() => { load(); }, [load]);
  // Meldungen kommen jederzeit herein – alle 60 s nachsehen.
  useEffect(() => { const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);

  return { anzahl, reload: load };
}
