/**
 * Zahlung zu einer Rechnung erfassen – ganz oder teilweise.
 *
 * Der Dialog ist überall derselbe: im Beleg, in der Rechnungsliste, in der
 * Buchhaltung, auf der Startseite. Er zeigt, was schon eingegangen ist,
 * schlägt den offenen Rest vor und lässt jede Zahlung wieder entfernen,
 * falls sie falsch erfasst wurde.
 */
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { addPayment, loadPayments, removePayment } from '@/hooks/useDocumentActions';
import { PAYMENT_METHODS, eur, fmtDate, openAmount, round2, type BillingDocument, type Payment } from '@/types/billing';
import { Trash2, Wallet } from 'lucide-react';

interface Props {
  doc: BillingDocument | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Wird nach jeder Änderung gerufen – die Seite lädt dann ihre Liste neu. */
  onChanged?: () => void;
}

export function ZahlungDialog({ doc, open, onOpenChange, onChanged }: Props) {
  const [betrag, setBetrag] = useState<string>('');
  const [datum, setDatum] = useState(new Date().toISOString().slice(0, 10));
  const [art, setArt] = useState<string>('Überweisung');
  const [notiz, setNotiz] = useState('');
  const [zahlungen, setZahlungen] = useState<Payment[]>([]);
  const [busy, setBusy] = useState(false);

  const rest = doc ? openAmount(doc) : 0;

  useEffect(() => {
    if (!open || !doc) return;
    setBetrag(rest > 0 ? String(rest) : '');
    setDatum(new Date().toISOString().slice(0, 10));
    setNotiz('');
    loadPayments(doc.id).then(setZahlungen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, doc?.id]);

  if (!doc) return null;

  const speichern = async () => {
    const b = Number(String(betrag).replace(',', '.'));
    if (!b || b <= 0) return;
    setBusy(true);
    const ok = await addPayment(doc, b, datum, art, notiz.trim() || null);
    setBusy(false);
    if (ok) { onChanged?.(); onOpenChange(false); }
  };

  const entfernen = async (p: Payment) => {
    setBusy(true);
    const ok = await removePayment(p);
    setBusy(false);
    if (ok) { setZahlungen(await loadPayments(doc.id)); onChanged?.(); }
  };

  const eingegangen = round2(zahlungen.reduce((a, p) => a + Number(p.amount || 0), 0));
  const betragNum = Number(String(betrag).replace(',', '.')) || 0;
  const bleibt = round2(rest - betragNum);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Wallet className="w-4 h-4" /> Zahlung erfassen</DialogTitle>
          <DialogDescription>
            Rechnung {doc.number || 'ohne Nummer'} · {doc.recipient_company || doc.recipient_name || '—'} · {eur(Number(doc.gross))}
          </DialogDescription>
        </DialogHeader>

        {/* Was schon da ist */}
        {zahlungen.length > 0 && (
          <div className="rounded-md border divide-y text-sm">
            {zahlungen.map((p) => (
              <div key={p.id} className="flex items-center gap-2 px-3 py-1.5">
                <span className="text-muted-foreground w-20 shrink-0">{fmtDate(p.paid_on)}</span>
                <span className="flex-1 truncate">{p.method || 'Zahlung'}{p.note ? ` · ${p.note}` : ''}</span>
                <span className="font-medium tabular-nums">{eur(Number(p.amount))}</span>
                <button type="button" className="text-muted-foreground hover:text-red-600" disabled={busy}
                  onClick={() => entfernen(p)} title="Zahlung entfernen" aria-label="Zahlung entfernen">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <div className="flex justify-between px-3 py-1.5 text-xs bg-muted/40">
              <span>bereits eingegangen {eur(eingegangen)}</span>
              <span className={rest > 0 ? 'text-amber-700 font-semibold' : 'text-green-700 font-semibold'}>
                {rest > 0 ? `offen ${eur(rest)}` : 'vollständig bezahlt'}
              </span>
            </div>
          </div>
        )}

        {rest > 0 ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">Betrag (brutto)</Label>
                <Input type="number" step="0.01" inputMode="decimal" value={betrag} autoFocus
                  onChange={(e) => setBetrag(e.target.value)} />
                <div className="flex gap-1 mt-1">
                  <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setBetrag(String(rest))}>ganzer Rest</Button>
                  <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setBetrag(String(round2(rest / 2)))}>Hälfte</Button>
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Eingegangen am</Label>
                <Input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Zahlungsart</Label>
                <Select value={art} onValueChange={setArt}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Notiz (optional)</Label>
                <Input value={notiz} onChange={(e) => setNotiz(e.target.value)} placeholder="z. B. 1. Rate" />
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              {betragNum > 0 && betragNum < rest && <>Danach noch offen: <b>{eur(bleibt)}</b> – die Rechnung gilt als <b>teilweise bezahlt</b>.</>}
              {betragNum > 0 && Math.abs(betragNum - rest) < 0.01 && <>Damit ist die Rechnung <b>vollständig bezahlt</b>.</>}
              {betragNum > rest + 0.01 && <span className="text-amber-700">Das ist mehr als offen ist ({eur(rest)}).</span>}
              {art === 'Bar' && <> Barzahlungen werden automatisch ins Kassabuch eingetragen.</>}
            </p>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Abbrechen</Button>
              <Button onClick={speichern} disabled={busy || betragNum <= 0}>Zahlung buchen</Button>
            </div>
          </>
        ) : (
          <>
            {zahlungen.length === 0 && (
              <p className="text-sm text-green-700">
                Diese Rechnung ist vollständig bezahlt{doc.paid_at ? ` (am ${fmtDate(doc.paid_at)})` : ''}.
              </p>
            )}
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Schließen</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
