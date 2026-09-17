import { Link, useNavigate } from 'react-router-dom';
import { AppNav } from '@/components/AppNav';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useContracts } from '@/hooks/useContracts';
import { CONTRACT_STATUS_LABEL } from '@/lib/vertrag';
import { eur, fmtDate } from '@/types/billing';
import { FileSignature, Plus, Clock, Check } from 'lucide-react';

const STIL: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  signed_by_us: 'bg-amber-100 text-amber-800',
  signed: 'bg-green-100 text-green-800',
  cancelled: 'bg-muted text-muted-foreground line-through',
};

export default function VertraegePage() {
  const { contracts, isLoading } = useContracts();
  const navigate = useNavigate();
  const wartend = contracts.filter((c) => c.status === 'signed_by_us');

  return (
    <div className="min-h-screen bg-background">
      <AppNav>
        <Button size="sm" className="gap-1.5" onClick={() => navigate('/vertrag/neu')}><Plus className="w-4 h-4" /> Neuer Vertrag</Button>
      </AppNav>
      <main className="max-w-5xl mx-auto px-4 py-6">
        <div className="mb-5">
          <h1 className="text-2xl font-bold flex items-center gap-2"><FileSignature className="w-6 h-6" /> Verträge</h1>
          <p className="text-sm text-muted-foreground">
            Entwicklungsvertrag mit Verschwiegenheit – du unterschreibst, der Kunde unterschreibt per Link am Handy.
            {wartend.length > 0 && <> · <span className="text-amber-700 font-medium">{wartend.length} warten auf den Kunden</span></>}
          </p>
        </div>

        {isLoading ? <p className="text-muted-foreground">Laden …</p> : contracts.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">
            Noch kein Vertrag. Am schnellsten: ein Angebot öffnen und dort auf „Vertrag erstellen" klicken – Partner, Betrag und Umfang werden übernommen.
          </Card>
        ) : (
          <div className="space-y-2">
            {contracts.map((c) => (
              <Link key={c.id} to={`/vertrag/${c.id}`}>
                <Card className="p-3 hover:border-primary transition-colors flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{c.number || 'ohne Nummer'}</span>
                      {c.offer_number && <Badge variant="outline" className="text-[10px]">aus {c.offer_number}</Badge>}
                    </div>
                    <div className="text-sm text-muted-foreground truncate">
                      {c.party_company || c.party_name || '—'}{c.title ? ` · ${c.title}` : ''}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-semibold">{eur(Number(c.total_net))} <span className="text-[10px] text-muted-foreground font-normal">netto</span></div>
                    <div className="text-xs text-muted-foreground">
                      {c.status === 'signed' && c.customer_signed_at ? <span className="inline-flex items-center gap-1"><Check className="w-3 h-3 text-green-600" /> {fmtDate(c.customer_signed_at)}</span>
                        : c.status === 'signed_by_us' ? <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" /> seit {fmtDate(c.our_signed_at)}</span>
                        : fmtDate(c.created_at)}
                    </div>
                  </div>
                  <span className={`text-[11px] font-semibold px-2 py-1 rounded-md shrink-0 ${STIL[c.status] || ''}`}>
                    {CONTRACT_STATUS_LABEL[c.status] || c.status}
                  </span>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
