/**
 * Erinnerung an Aufträge, die erst teilweise verrechnet sind.
 *
 * Wer einen Auftrag in zwei Rechnungen aufteilt, verliert die zweite leicht aus
 * den Augen – deshalb steht sie hier: fällige Restrechnungen oben und farbig,
 * die noch wartenden darunter, samt Summe dessen, was noch nicht verrechnet ist.
 */
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuftraege } from '@/hooks/useAuftraege';
import { eur, fmtDate } from '@/types/billing';
import { AlarmClock, Receipt, Link2 } from 'lucide-react';

export function OffeneAuftraege({ kompakt = false }: { kompakt?: boolean }) {
  const { offeneAuftraege, faellig, offenSumme, isLoading } = useAuftraege();
  if (isLoading || !offeneAuftraege.length) return null;

  const wartend = offeneAuftraege.filter((a) => !faellig.includes(a));

  return (
    <Card className={'p-4 ' + (faellig.length ? 'border-amber-400 bg-amber-50/60' : '')}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h3 className="font-semibold text-sm flex items-center gap-1.5">
          {faellig.length
            ? <><AlarmClock className="w-4 h-4 text-amber-600" /> {faellig.length} Restrechnung{faellig.length > 1 ? 'en' : ''} fällig</>
            : <><Link2 className="w-4 h-4 text-muted-foreground" /> Aufträge in Teilrechnung</>}
        </h3>
        <span className="text-xs text-muted-foreground">
          noch nicht verrechnet: <span className="font-semibold text-foreground tabular-nums">{eur(offenSumme)}</span> netto
        </span>
      </div>

      <div className="space-y-1.5">
        {[...faellig, ...wartend].slice(0, kompakt ? 3 : 12).map((a) => {
          const istFaellig = faellig.includes(a);
          return (
            <div key={a.projektId} className="flex flex-wrap items-center justify-between gap-2 text-sm border-t pt-1.5 first:border-t-0 first:pt-0">
              <div className="min-w-0">
                <div className="font-medium truncate">{a.kunde}</div>
                <div className="text-[11px] text-muted-foreground">
                  Auftrag {eur(a.gesamt)} · verrechnet {eur(a.verrechnet)} ({a.rechnungen.length} Rechnung{a.rechnungen.length > 1 ? 'en' : ''},
                  zuletzt {fmtDate(a.rechnungen[a.rechnungen.length - 1].doc_date)})
                  {a.restFaelligAm && ` · Rest ab ${fmtDate(a.restFaelligAm)}`}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={'tabular-nums font-semibold ' + (istFaellig ? 'text-amber-700' : 'text-muted-foreground')}>
                  {eur(a.offen)}
                </span>
                <Link to={`/beleg/${a.letzteId}`}>
                  <Button size="sm" variant={istFaellig ? 'default' : 'outline'} className="gap-1 h-7 text-xs">
                    <Receipt className="w-3.5 h-3.5" /> Restrechnung
                  </Button>
                </Link>
              </div>
            </div>
          );
        })}
      </div>

      {offeneAuftraege.length > (kompakt ? 3 : 12) && (
        <p className="text-[11px] text-muted-foreground mt-2">
          … und {offeneAuftraege.length - (kompakt ? 3 : 12)} weitere.
        </p>
      )}
    </Card>
  );
}
