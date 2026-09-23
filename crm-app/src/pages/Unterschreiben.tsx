/**
 * Die Seite, die der Kunde über seinen Link öffnet – ohne Login, am Handy.
 *
 * Erst lesen, dann unterschreiben: bei mehreren Unterzeichnern (zwei
 * Geschäftsführer …) hat jeder sein eigenes Feld und unterschreibt für sich,
 * auch zu verschiedenen Zeiten über denselben Link. Sind alle durch, ist der
 * Vertrag geschlossen; die Seite kündigt das PDF an die Adresse des Kunden an –
 * verschickt wird es von Hand aus dem CRM.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { UnterschriftFeld } from '@/components/UnterschriftFeld';
import { VertragAnsicht, signerZuUnterschrift } from '@/components/VertragAnsicht';
import { buildContractPdf, contractFileName } from '@/lib/contractPdf';
import type { Contract, Signer, VertragsText } from '@/lib/vertrag';
import { EPOWER_LOGO } from '@/lib/logoData';
import { ArrowDown, Check, Download, FileSignature, Loader2 } from 'lucide-react';

type Oeffentlich = Pick<Contract, 'id' | 'number' | 'status' | 'party_company' | 'party_name' | 'party_email'
  | 'text_frozen' | 'text_hash' | 'our_signature' | 'our_signed_name' | 'our_signed_at' | 'signers'>;

export default function Unterschreiben() {
  const { token = '' } = useParams<{ token: string }>();
  const [v, setV] = useState<Oeffentlich | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  // Eingaben je Unterzeichner
  const [namen, setNamen] = useState<string[]>([]);
  const [pngs, setPngs] = useState<(string | null)[]>([]);
  // Jeder Unterzeichner bestätigt für sich – der Link geht an alle.
  const [gelesen, setGelesen] = useState<boolean[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  // Knopf unten „Zum Unterschreiben" – verschwindet, sobald das Feld im Bild ist.
  const [signBox, setSignBox] = useState<HTMLDivElement | null>(null);
  const [feldSichtbar, setFeldSichtbar] = useState(false);

  useEffect(() => {
    if (!signBox) { setFeldSichtbar(false); return; }
    const io = new IntersectionObserver(([e]) => setFeldSichtbar(e.isIntersecting), { rootMargin: '0px 0px -25% 0px' });
    io.observe(signBox);
    return () => io.disconnect();
  }, [signBox]);

  useEffect(() => {
    document.title = 'Vertrag unterschreiben – ePower GmbH';
    (async () => {
      try {
        const r = await fetch(`/api/vertrag?token=${encodeURIComponent(token)}`);
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { setFehler(d.error || 'Dieser Link ist nicht gültig.'); return; }
        const s: Signer[] = d.vertrag.signers?.length ? d.vertrag.signers : [{ name: (d.vertrag.party_name || '').replace(/^(Herrn|Herr|Frau|Herren)\s+/i, ''), signature: null, signed_at: null }];
        setV({ ...d.vertrag, signers: s });
        setNamen(s.map((x) => x.name));
        setPngs(s.map(() => null));
        setGelesen(s.map(() => false));
      } catch { setFehler('Verbindung fehlgeschlagen. Bitte später noch einmal versuchen.'); }
    })();
  }, [token]);

  const unterschreiben = async (slot: number) => {
    if (!v || !pngs[slot] || !namen[slot]?.trim() || !gelesen[slot]) return;
    setBusy(slot); setFehler(null);
    try {
      const r = await fetch('/api/vertrag', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, slot, name: namen[slot].trim(), signature: pngs[slot], zustimmung: true }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setFehler(d.error || 'Unterschrift konnte nicht gespeichert werden.'); return; }
      setV((x) => x ? { ...x, status: d.fertig ? 'signed' : x.status, signers: d.signers } : x);
      if (d.fertig) window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch { setFehler('Verbindung fehlgeschlagen. Bitte noch einmal versuchen.'); }
    finally { setBusy(null); }
  };

  const download = () => {
    if (!v?.text_frozen) return;
    buildContractPdf(v as Contract, v.text_frozen as VertragsText).save(contractFileName(v as Contract));
  };

  const Kopf = () => (
    <header className="flex items-center gap-3 mb-6">
      <img src={EPOWER_LOGO} alt="ePower" className="w-12 h-12 rounded-xl" />
      <div>
        <div className="font-bold">ePower GmbH</div>
        <div className="text-xs text-muted-foreground">Vertrag zur Unterschrift</div>
      </div>
    </header>
  );

  if (fehler && !v) {
    return (
      <div className="min-h-screen bg-[#f6f5f2] px-4 py-8">
        <div className="max-w-xl mx-auto"><Kopf />
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h1 className="font-bold text-lg mb-2">Das hat nicht geklappt</h1>
            <p className="text-sm text-muted-foreground">{fehler}</p>
          </div>
        </div>
      </div>
    );
  }
  if (!v?.text_frozen) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Vertrag wird geladen …</div>;
  }

  const fertig = v.status === 'signed';
  const offen = v.signers.map((s, i) => ({ s, i })).filter(({ s }) => !s.signature);
  const erledigt = v.signers.filter((s) => !!s.signature).length;

  return (
    <div className={'min-h-screen bg-[#f6f5f2] px-3 sm:px-4 pt-6 sm:pt-8 ' + (fertig ? 'pb-8' : 'pb-28')}>
      <div className="max-w-2xl mx-auto">
        <Kopf />

        {fertig && (
          <div className="bg-green-50 border border-green-300 rounded-2xl p-5 mb-4">
            <div className="font-bold flex items-center gap-2 text-green-800"><Check className="w-5 h-5" /> Der Vertrag ist von allen Seiten unterschrieben.</div>
            <p className="text-sm text-green-900/80 mt-1">
              {/* Nur Hinweis – verschickt wird von Hand aus dem CRM, nie automatisch. */}
              Der Vertrag mit allen Unterschriften wird Ihnen noch per E-Mail{v.party_email ? <> an <b>{v.party_email}</b></> : null} zugeschickt.
              {' '}Hier können Sie ihn auch gleich herunterladen.
            </p>
            <Button className="mt-3 gap-1" onClick={download}><Download className="w-4 h-4" /> Vertrag als PDF</Button>
          </div>
        )}

        {!fertig && erledigt > 0 && (
          <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 mb-4 text-sm">
            <b>{erledigt} von {v.signers.length}</b> Unterschriften sind da – es fehlt noch: {offen.map(({ s }) => s.name || 'ein Unterzeichner').join(', ')}.
            {' '}Sobald alle unterschrieben haben, wird der Vertrag{v.party_email ? <> an <b>{v.party_email}</b></> : null} geschickt.
          </div>
        )}

        <div className="bg-white rounded-2xl p-5 sm:p-8 shadow-sm">
          <VertragAnsicht text={v.text_frozen as VertragsText}
            links={{ png: v.our_signature, name: v.our_signed_name, wann: v.our_signed_at }}
            rechts={v.signers.map(signerZuUnterschrift)} />
        </div>

        {!fertig && (
          <div ref={setSignBox} className="bg-white rounded-2xl p-5 sm:p-8 shadow-sm mt-4 scroll-mt-4">
            <h2 className="font-bold text-lg flex items-center gap-2 mb-1"><FileSignature className="w-5 h-5" /> Hier unterschreiben</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Mit dem Finger oder der Maus – wie auf Papier.
              {v.signers.length > 1 && ' Jeder Unterzeichner hat sein eigenes Feld und kann auch später über denselben Link unterschreiben.'}
            </p>
            {offen.map(({ s, i }) => (
              <div key={i} className={'rounded-xl border p-4 ' + (offen.length > 1 ? 'mb-4' : '')}>
                {v.signers.length > 1 && <div className="text-xs font-semibold text-muted-foreground mb-2">Unterzeichner {i + 1}{s.rolle ? ` · ${s.rolle}` : ''}</div>}
                <div className="mb-3">
                  <Label className="text-xs text-muted-foreground">Name</Label>
                  <Input value={namen[i] ?? ''} onChange={(e) => setNamen((n) => n.map((x, k) => (k === i ? e.target.value : x)))} placeholder="Vor- und Nachname" autoComplete="name" />
                </div>
                <UnterschriftFeld onChange={(png) => setPngs((p) => p.map((x, k) => (k === i ? png : x)))} height={170}
                  titel={namen[i]?.trim() ? `Unterschrift ${namen[i].trim()}` : 'Hier unterschreiben'} />
                <label className="flex items-start gap-2.5 text-sm mt-3 cursor-pointer select-none">
                  <input type="checkbox" className="mt-0.5 w-5 h-5 shrink-0 accent-primary" checked={!!gelesen[i]}
                    onChange={(e) => setGelesen((g) => g.map((x, k) => (k === i ? e.target.checked : x)))} />
                  <span>
                    Ich{namen[i]?.trim() ? <>, <b>{namen[i].trim()}</b>,</> : ''} habe den Vertrag gelesen und stimme ihm zu.
                    Meine elektronische Unterschrift gilt wie eine handschriftliche.
                  </span>
                </label>
                <Button size="lg" className="w-full mt-3 gap-2" disabled={!pngs[i] || !namen[i]?.trim() || !gelesen[i] || busy !== null} onClick={() => unterschreiben(i)}>
                  {busy === i ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {v.signers.length > 1 ? `Als ${namen[i]?.trim() || 'Unterzeichner ' + (i + 1)} unterschreiben` : 'Vertrag unterschreiben'}
                </Button>
              </div>
            ))}
            {fehler && <p className="text-sm text-red-600 mt-3">{fehler}</p>}
          </div>
        )}

        <p className="text-[11px] text-muted-foreground text-center mt-6">
          Vertrag {v.number} · Prüfsumme {v.text_hash?.slice(0, 16)}… · ePower GmbH, Teufenbach-Katsch
        </p>
      </div>

      {!fertig && !feldSichtbar && (
        <div className="fixed inset-x-0 bottom-0 z-20 px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] bg-gradient-to-t from-[#f6f5f2] via-[#f6f5f2]/95 to-transparent">
          <div className="max-w-2xl mx-auto">
            <Button size="lg" className="w-full gap-2 shadow-lg" onClick={() => signBox?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
              <ArrowDown className="w-4 h-4" /> Zum Unterschreiben
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
