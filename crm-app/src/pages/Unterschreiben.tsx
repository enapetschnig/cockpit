/**
 * Die Seite, die der Kunde über seinen Link öffnet – ohne Login, am Handy.
 *
 * Erst lesen, dann Name bestätigen, mit dem Finger unterschreiben, fertig.
 * Danach kann er den Vertrag als PDF mit beiden Unterschriften mitnehmen.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SignaturePad } from '@/components/SignaturePad';
import { VertragAnsicht } from '@/components/VertragAnsicht';
import { buildContractPdf, contractFileName } from '@/lib/contractPdf';
import type { Contract, VertragsText } from '@/lib/vertrag';
import { EPOWER_LOGO } from '@/lib/logoData';
import { Check, Download, FileSignature, Loader2 } from 'lucide-react';

type Oeffentlich = Pick<Contract, 'id' | 'number' | 'status' | 'party_company' | 'party_name' | 'party_email'
  | 'text_frozen' | 'text_hash' | 'our_signature' | 'our_signed_name' | 'our_signed_at'
  | 'customer_signature' | 'customer_signed_name' | 'customer_signed_at'>;

export default function Unterschreiben() {
  const { token = '' } = useParams<{ token: string }>();
  const [v, setV] = useState<Oeffentlich | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [png, setPng] = useState<string | null>(null);
  const [gelesen, setGelesen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = 'Vertrag unterschreiben – ePower GmbH';
    (async () => {
      try {
        const r = await fetch(`/api/vertrag?token=${encodeURIComponent(token)}`);
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { setFehler(d.error || 'Dieser Link ist nicht gültig.'); return; }
        setV(d.vertrag);
        // Der Name aus dem Vertrag, ohne Anrede – der Kunde bestätigt oder korrigiert ihn.
        setName((d.vertrag.party_name || '').replace(/^(Herrn|Herr|Frau|Herren)\s+/i, ''));
      } catch { setFehler('Verbindung fehlgeschlagen. Bitte später noch einmal versuchen.'); }
    })();
  }, [token]);

  const unterschreiben = async () => {
    if (!png || !name.trim() || !gelesen) return;
    setBusy(true);
    try {
      const r = await fetch('/api/vertrag', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, name: name.trim(), signature: png }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setFehler(d.error || 'Unterschrift konnte nicht gespeichert werden.'); return; }
      setV((x) => x ? { ...x, status: 'signed', customer_signature: png, customer_signed_name: name.trim(), customer_signed_at: d.signed_at } : x);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch { setFehler('Verbindung fehlgeschlagen. Bitte noch einmal versuchen.'); }
    finally { setBusy(false); }
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

  return (
    <div className="min-h-screen bg-[#f6f5f2] px-3 sm:px-4 py-6 sm:py-8">
      <div className="max-w-2xl mx-auto">
        <Kopf />

        {fertig && (
          <div className="bg-green-50 border border-green-300 rounded-2xl p-5 mb-4">
            <div className="font-bold flex items-center gap-2 text-green-800"><Check className="w-5 h-5" /> Vielen Dank – der Vertrag ist unterschrieben.</div>
            <p className="text-sm text-green-900/80 mt-1">Beide Unterschriften sind gespeichert. Sie können sich den Vertrag jetzt als PDF mitnehmen; wir melden uns wegen der nächsten Schritte.</p>
            <Button className="mt-3 gap-1" onClick={download}><Download className="w-4 h-4" /> Vertrag als PDF</Button>
          </div>
        )}

        <div className="bg-white rounded-2xl p-5 sm:p-8 shadow-sm">
          <VertragAnsicht text={v.text_frozen as VertragsText}
            links={{ png: v.our_signature, name: v.our_signed_name, wann: v.our_signed_at }}
            rechts={{ png: v.customer_signature, name: v.customer_signed_name, wann: v.customer_signed_at }} />
        </div>

        {!fertig && (
          <div className="bg-white rounded-2xl p-5 sm:p-8 shadow-sm mt-4">
            <h2 className="font-bold text-lg flex items-center gap-2 mb-1"><FileSignature className="w-5 h-5" /> Hier unterschreiben</h2>
            <p className="text-sm text-muted-foreground mb-4">Mit dem Finger oder der Maus – wie auf Papier.</p>
            <div className="mb-3">
              <Label className="text-xs text-muted-foreground">Ihr Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Vor- und Nachname" autoComplete="name" />
            </div>
            <SignaturePad onChange={setPng} height={180} />
            <label className="flex items-start gap-2 text-sm mt-3 cursor-pointer select-none">
              <input type="checkbox" className="mt-1" checked={gelesen} onChange={(e) => setGelesen(e.target.checked)} />
              <span>Ich habe den Vertrag gelesen und stimme ihm zu. Meine elektronische Unterschrift gilt wie eine handschriftliche.</span>
            </label>
            {fehler && <p className="text-sm text-red-600 mt-2">{fehler}</p>}
            <Button size="lg" className="w-full mt-4 gap-2" disabled={!png || !name.trim() || !gelesen || busy} onClick={unterschreiben}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Vertrag unterschreiben
            </Button>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground text-center mt-6">
          Vertrag {v.number} · Prüfsumme {v.text_hash?.slice(0, 16)}… · ePower GmbH, Teufenbach-Katsch
        </p>
      </div>
    </div>
  );
}
