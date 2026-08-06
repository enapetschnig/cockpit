import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useOpenInvoices } from '@/hooks/useOpenInvoices';
import { eur, fmtDate } from '@/types/billing';
import { AlertTriangle, ArrowRight, CheckCircle2, Plus, Wallet } from 'lucide-react';

/** Kompakter Streifen mit offenen/überfälligen Rechnungen – direkt auf der Startseite. */
export function OpenInvoicesStrip() {
  const { open, overdue, openSum, overdueSum, isLoading } = useOpenInvoices();
  if (isLoading) return null;

  const top = [...overdue, ...open.filter((o) => !overdue.includes(o))].slice(0, 4);
  const daysLate = (d?: string | null) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : 0);

  return (
    <Card className={`p-4 mb-4 ${overdue.length ? 'border-red-300 bg-red-50/50' : ''}`}>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="flex items-center gap-2 font-semibold">
          <Wallet className="w-4 h-4" /> Offene Rechnungen
        </div>
        <div className="text-sm">
          <b>{eur(openSum)}</b> <span className="text-muted-foreground">({open.length})</span>
          {overdue.length > 0 && (
            <span className="ml-3 text-red-600 font-semibold inline-flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" /> {eur(overdueSum)} überfällig ({overdue.length})
            </span>
          )}
        </div>
        <div className="ml-auto flex gap-2">
          <Link to="/beleg/neu?kind=invoice">
            <Button size="sm" className="gap-1"><Plus className="w-4 h-4" /> Rechnung</Button>
          </Link>
          <Link to="/buchhaltung">
            <Button size="sm" variant="outline" className="gap-1">Buchhaltung <ArrowRight className="w-3 h-3" /></Button>
          </Link>
        </div>
      </div>

      {open.length === 0 ? (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Alle Rechnungen bezahlt
        </p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {top.map((r) => {
            const late = daysLate(r.due_date) > 0;
            return (
              <Link key={r.id} to={`/beleg/${r.id}`}>
                <div className={`p-2.5 rounded-lg border text-sm hover:border-primary transition-colors ${late ? 'border-red-300 bg-white' : 'bg-card'}`}>
                  <div className="font-medium truncate">{r.recipient_company || r.recipient_name || '—'}</div>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="text-xs text-muted-foreground">
                      {r.number} · {late ? <span className="text-red-600 font-semibold">{daysLate(r.due_date)} T. überfällig</span> : `fällig ${fmtDate(r.due_date)}`}
                    </span>
                    <span className="font-semibold">{eur(Number(r.gross))}</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </Card>
  );
}
