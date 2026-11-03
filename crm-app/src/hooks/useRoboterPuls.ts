import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Puls } from '@/lib/sitzungen';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** Lebenszeichen, Pausen und laufende Arbeit des Roboters – alle `ms` neu (nach einem Befehl gleich `laden()`). */
export function useRoboterPuls(ms = 10_000) {
  const [puls, setPuls] = useState<Puls | null>(null);
  const laden = useCallback(async () => {
    const { data } = await db.from('roboter_puls').select('zuletzt,meldung,pausen,laeuft').eq('id', 1).maybeSingle();
    if (data) setPuls({ ...data, pausen: data.pausen || {}, laeuft: data.laeuft || [] });
  }, []);
  useEffect(() => { laden(); const t = setInterval(laden, ms); return () => clearInterval(t); }, [laden, ms]);
  return { puls, laden };
}
