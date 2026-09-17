/**
 * Große Meldung am Dashboard: ein Vertrag wurde vollständig unterschrieben.
 * Bleibt stehen, bis sie weggeklickt wird – das soll man nicht übersehen.
 */
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useContracts } from '@/hooks/useContracts';
import { supabase } from '@/integrations/supabase/client';
import { eur } from '@/types/billing';
import { PartyPopper, Check, ArrowRight } from 'lucide-react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export function VertragMeldung() {
  const { contracts, reload } = useContracts();
  const neu = contracts.filter((c) => c.status === 'signed' && !c.signed_seen_at);
  if (!neu.length) return null;

  const gesehen = async (id: string) => {
    await db.from('contracts').update({ signed_seen_at: new Date().toISOString() }).eq('id', id);
    reload();
  };

  return (
    <div className="space-y-2 mb-4">
      {neu.map((c) => (
        <div key={c.id} className="rounded-2xl border-2 border-green-400 bg-green-50 p-5 flex flex-wrap items-center gap-4 shadow-sm">
          <PartyPopper className="w-10 h-10 text-green-600 shrink-0" />
          <div className="flex-1 min-w-[220px]">
            <div className="text-lg font-bold text-green-900">Vertrag unterschrieben: {c.party_company || c.party_name}</div>
            <div className="text-sm text-green-900/80">
              {c.number} · {eur(Number(c.total_net))} netto · unterschrieben von {c.signers?.map((s) => s.name).filter(Boolean).join(' und ') || c.customer_signed_name}
              {c.customer_signed_at && ` am ${new Date(c.customer_signed_at).toLocaleString('de-AT', { dateStyle: 'medium', timeStyle: 'short' })}`}
            </div>
          </div>
          <div className="flex gap-2">
            <Link to={`/vertrag/${c.id}`}><Button className="gap-1 bg-green-600 hover:bg-green-700">Vertrag öffnen <ArrowRight className="w-4 h-4" /></Button></Link>
            <Button variant="outline" className="gap-1" onClick={() => gesehen(c.id)}><Check className="w-4 h-4" /> Gesehen</Button>
          </div>
        </div>
      ))}
    </div>
  );
}
