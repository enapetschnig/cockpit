/**
 * Wartungsverträge – je verkaufter Software einer.
 *
 * Die Zeilen kommen aus allen Rechnungen (Datenbank-Sicht): wer eine Software
 * gekauft hat, wann die letzte Rechnung dazu war, und damit wann das
 * inkludierte Jahr endet. Ab da läuft die Wartung: Betrag je Monat festlegen,
 * Jahresrechnung mit einem Klick, ein Jahr später erinnert die Seite wieder.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { AppNav } from '@/components/AppNav';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { naechsteRechnungsnummer, saveDocument, useCompanySettings } from '@/hooks/useBilling';
import { plusMonate, speichereWartung, useWartung, type WartungZeile, type WartungStatus } from '@/hooks/useWartung';
import { supabase } from '@/integrations/supabase/client';
import { eur, fmtDate, round2 } from '@/types/billing';
import { Wrench, Receipt, AlarmClock, EyeOff, Eye, Check } from 'lucide-react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const addDays = (d: string, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const fmtLang = (d: string) => new Date(d).toLocaleDateString('de-AT', { month: 'long', year: 'numeric' });

export default function WartungPage() {
  const { user } = useAuth();
  const { settings } = useCompanySettings();
  const { zeilen, faellig, isLoading, reload, heute } = useWartung();
  const navigate = useNavigate();
  const [zeigeKeine, setZeigeKeine] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // Lokale Eingaben je Zeile, bis gespeichert wird
  const [edit, setEdit] = useState<Record<string, { startAm?: string; monatlich?: number | '' }>>({});

  const wert = (z: WartungZeile) => ({
    startAm: edit[z.key]?.startAm ?? z.startAm,
    monatlich: edit[z.key]?.monatlich === undefined ? z.monatlich : edit[z.key]!.monatlich,
  });

  const speichern = async (z: WartungZeile, status?: WartungStatus) => {
    if (!user) return;
    const w = wert(z);
    setBusy(z.key);
    const id = await speichereWartung({ ...z, startAm: w.startAm, monatlich: Number(w.monatlich) || 0 }, status ? { status } : {}, user.id);
    setBusy(null);
    if (id) { setEdit((e) => ({ ...e, [z.key]: {} })); toast.success('Gespeichert'); reload(); }
  };

  /**
   * Jahresrechnung: 12 Monate Wartung ab dem nächsten offenen Zeitpunkt, mit
   * Empfänger aus der letzten Software-Rechnung. Danach ist ein Jahr abgerechnet.
   */
  const jahresrechnung = async (z: WartungZeile) => {
    if (!user) return;
    const w = wert(z);
    const monatlich = round2(Number(w.monatlich) || 0);
    if (monatlich <= 0) { toast.error('Bitte zuerst den Monatsbetrag eintragen'); return; }
    setBusy(z.key);
    try {
      // Wartungsvertrag zuerst festschreiben – die Rechnung hängt daran.
      const wid = await speichereWartung({ ...z, startAm: w.startAm, monatlich }, { status: 'aktiv' }, user.id);
      if (!wid) return;
      const von = z.abgerechnetBis || w.startAm;
      const bis = plusMonate(von, 12);
      const bisAnzeige = addDays(bis, -1);
      // Empfänger: von der letzten Software-Rechnung, sonst vom Kundenstamm
      let empf: Record<string, string | null> = {};
      if (z.letzteRechnung.id) {
        const { data: d } = await db.from('documents').select('customer_id,recipient_name,recipient_company,recipient_street,recipient_zip,recipient_city,recipient_country,recipient_email,recipient_uid').eq('id', z.letzteRechnung.id).maybeSingle();
        if (d) empf = d;
      } else if (z.vertrag?.customer_id) {
        const { data: c } = await db.from('customers').select('*').eq('id', z.vertrag.customer_id).maybeSingle();
        if (c) empf = {
          customer_id: c.id, recipient_company: c.company_name, recipient_name: [c.first_name, c.last_name].filter(Boolean).join(' ') || null,
          recipient_street: [c.street, c.house_no].filter(Boolean).join(' ') || null, recipient_zip: c.postal_code, recipient_city: c.city,
          recipient_country: c.country, recipient_email: c.email, recipient_uid: c.uid_number,
        };
      }
      const num = await naechsteRechnungsnummer(settings);
      const docId = await saveDocument({
        kind: 'invoice', number: num, status: 'draft', doc_date: heute,
        due_date: addDays(heute, settings?.default_payment_days || 7),
        customer_id: empf.customer_id ?? null,
        recipient_name: empf.recipient_name ?? null, recipient_company: empf.recipient_company ?? z.kunde,
        recipient_street: empf.recipient_street ?? null, recipient_zip: empf.recipient_zip ?? null, recipient_city: empf.recipient_city ?? null,
        recipient_country: empf.recipient_country ?? 'Österreich', recipient_email: empf.recipient_email ?? null, recipient_uid: empf.recipient_uid ?? null,
        title: `Wartungsvertrag ${z.software ? z.software.slice(0, 60) : 'Software'}`,
        intro_text: settings?.invoice_intro || '', outro_text: settings?.invoice_outro || '',
        service_date: von, discount_percent: 0, prices_include_vat: false,
      }, [{
        name: `Wartungsvertrag Software – ${fmtDate(von)} bis ${fmtDate(bisAnzeige)}`,
        description: `Laufende Umsetzung von Änderungen und Wünschen, Support und Hosting Ihrer Software. 12 Monate à ${eur(monatlich)} netto, jährlich im Voraus.`,
        quantity: 12, unit: 'Monat', unit_price: monatlich, vat_rate: settings?.default_vat ?? 20, discount_percent: 0, is_heading: false,
      }], user.id, false);
      if (!docId) return;
      await db.from('wartungsvertraege').update({ abgerechnet_bis: bis, letzte_jahresrechnung_id: docId, updated_at: new Date().toISOString() }).eq('id', wid);
      toast.success(`Jahresrechnung ${num} über ${eur(round2(monatlich * 12))} netto erstellt`);
      navigate(`/beleg/${docId}`);
    } finally { setBusy(null); }
  };

  const sichtbar = zeilen.filter((z) => zeigeKeine || z.status !== 'kein');
  const summeMonat = zeilen.filter((z) => z.status === 'aktiv').reduce((a, z) => a + z.monatlich, 0);

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <main className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Wrench className="w-6 h-6" /> Wartungsverträge</h1>
            <p className="text-sm text-muted-foreground">
              Aus allen Rechnungen zusammengesucht: {zeilen.length} verkaufte Softwares
              {faellig.length > 0 && <> · <span className="text-amber-700 font-medium">{faellig.length} fällig oder bald fällig</span></>}
              {summeMonat > 0 && <> · aktiv {eur(summeMonat)}/Monat</>}
            </p>
          </div>
          <Button size="sm" variant="ghost" className="gap-1 text-xs" onClick={() => setZeigeKeine((v) => !v)}>
            {zeigeKeine ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />} {zeigeKeine ? 'Ausgeblendete verstecken' : 'Ausgeblendete zeigen'}
          </Button>
        </div>

        {isLoading ? <p className="text-muted-foreground">Rechnungen werden durchsucht …</p> : (
          <div className="space-y-2">
            {sichtbar.map((z) => {
              const w = wert(z);
              const istFaellig = z.status !== 'kein' && z.naechsteAb <= plusMonate(heute, 1);
              const geaendert = !!edit[z.key] && (edit[z.key]!.startAm !== undefined || edit[z.key]!.monatlich !== undefined);
              return (
                <Card key={z.key} className={'p-3 ' + (istFaellig ? 'border-amber-300 bg-amber-50/50' : z.status === 'kein' ? 'opacity-60' : '')}>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex-1 min-w-[220px]">
                      <div className="font-semibold flex items-center gap-2 flex-wrap">
                        {z.kunde}
                        {z.status === 'aktiv' && <Badge className="bg-green-100 text-green-800 hover:bg-green-100 text-[10px]">aktiv</Badge>}
                        {z.status === 'kein' && <Badge variant="outline" className="text-[10px]">kein Vertrag</Badge>}
                        {istFaellig && <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 text-[10px] gap-1"><AlarmClock className="w-3 h-3" /> {z.naechsteAb < heute ? 'überfällig' : 'bald'}</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">{z.software || 'Software'}</div>
                      <div className="text-xs text-muted-foreground">
                        letzte Software-Rechnung:{' '}
                        {z.letzteRechnung.id
                          ? <Link className="underline" to={`/beleg/${z.letzteRechnung.id}`}>{z.letzteRechnung.nummer} vom {fmtDate(z.letzteRechnung.datum)}</Link>
                          : '—'}
                        {z.verkauf && z.verkauf.anzahl_rechnungen > 1 && ` (${z.verkauf.anzahl_rechnungen} Rechnungen, ${eur(Number(z.verkauf.summe_netto))} netto)`}
                        {z.abgerechnetBis && <> · Wartung abgerechnet bis {fmtDate(addDays(z.abgerechnetBis, -1))}</>}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-end gap-2">
                      <div>
                        <div className="text-[10px] text-muted-foreground">Wartung ab</div>
                        <Input type="date" className="h-8 w-36" value={w.startAm} disabled={z.status === 'kein'}
                          onChange={(e) => setEdit((x) => ({ ...x, [z.key]: { ...x[z.key], startAm: e.target.value } }))} />
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground">€/Monat netto</div>
                        <Input type="number" step="1" className="h-8 w-24" value={w.monatlich} disabled={z.status === 'kein'}
                          onChange={(e) => setEdit((x) => ({ ...x, [z.key]: { ...x[z.key], monatlich: e.target.value === '' ? '' : Number(e.target.value) } }))} />
                      </div>
                      {geaendert && (
                        <Button size="sm" variant="outline" className="h-8 gap-1" disabled={busy === z.key} onClick={() => speichern(z)}>
                          <Check className="w-3.5 h-3.5" /> Speichern
                        </Button>
                      )}
                      {z.status !== 'kein' ? (
                        <>
                          <Button size="sm" className="h-8 gap-1" disabled={busy === z.key} onClick={() => jahresrechnung(z)}
                            title={`12 × ${eur(Number(w.monatlich) || 0)} ab ${fmtLang(z.abgerechnetBis || w.startAm)}`}>
                            <Receipt className="w-3.5 h-3.5" /> Jahresrechnung {eur(round2((Number(w.monatlich) || 0) * 12))}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground" disabled={busy === z.key} onClick={() => speichern(z, 'kein')}>
                            ausblenden
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="ghost" className="h-8 text-xs" disabled={busy === z.key} onClick={() => speichern(z, 'offen')}>
                          wieder aufnehmen
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
            {sichtbar.length === 0 && <Card className="p-8 text-center text-muted-foreground">Keine Software-Verkäufe in den Rechnungen gefunden.</Card>}
          </div>
        )}
      </main>
    </div>
  );
}
