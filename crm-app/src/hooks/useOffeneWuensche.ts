import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/**
 * Anzahl der noch OFFENEN Meldungen aus den Handwerker-Apps.
 *
 * Offen heißt: in der App noch nicht erledigt/abgelehnt UND hier nicht von
 * Hand abgehakt.
 * Bewusst NICHT am eigenen „Gesehen"-Häkchen festgemacht – sonst zählte
 * ein längst umgesetzter Wunsch weiter als offen, nur weil man ihn hier
 * nie angeklickt hat.
 */
export function useOffeneWuensche() {
  const { user } = useAuth();
  const [anzahl, setAnzahl] = useState(0);

  const load = useCallback(async () => {
    if (!user) { setAnzahl(0); return; }
    const { count } = await db.from('app_wuensche')
      .select('id', { count: 'exact', head: true })
      .not('status', 'in', '("umgesetzt","abgelehnt")')
      .is('erledigt_am', null);
    setAnzahl(count ?? 0);
  }, [user]);

  useEffect(() => { load(); }, [load]);
  // Meldungen kommen jederzeit herein – alle 60 s nachsehen.
  useEffect(() => { const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);

  return { anzahl, reload: load };
}
