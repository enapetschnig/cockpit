/**
 * Ein Vertrag: links die wenigen Felder, rechts der fertige Text.
 *
 * Ablauf: Entwurf → ich unterschreibe (Text wird eingefroren, Link entsteht)
 * → Kunde unterschreibt über den Link → beide Unterschriften am PDF.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import QRCode from 'qrcode';
import { AppNav } from '@/components/AppNav';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { UnterschriftFeld } from '@/components/UnterschriftFeld';
import { VertragAnsicht, signerZuUnterschrift } from '@/components/VertragAnsicht';
import { useAuth } from '@/hooks/useAuth';
import { useCompanySettings } from '@/hooks/useBilling';
import { deleteContract, reserveContractNumber, saveContract, useContract } from '@/hooks/useContracts';
import { supabase } from '@/integrations/supabase/client';
import { sendDocumentMail } from '@/lib/sendMail';
import { buildContractPdf, contractFileName } from '@/lib/contractPdf';
import {
  CONTRACT_STATUS_LABEL, DEFAULT_REST_TERMS, neuerToken, signLink, signerAusName, textHash, vertragsText,
  type Contract, type Signer, type VertragsText,
} from '@/lib/vertrag';
import { eur, round2 } from '@/types/billing';
import { ArrowLeft, Check, Copy, Download, FileSignature, Link2, Mail, MessageCircle, RefreshCw, Save, Smartphone, Trash2, Undo2, Plus, X, RotateCcw } from 'lucide-react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const VERTRETER_KEY = 'vertrag-vertreter';

export default function VertragEditor() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === 'neu';
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { settings } = useCompanySettings();
  const { contract: loaded, isLoading, reload } = useContract(isNew ? undefined : id);

  const [v, setV] = useState<Partial<Contract>>({
    status: 'draft', support_months: 12, maintenance_monthly: 50, rest_terms: DEFAULT_REST_TERMS, party_country: 'Österreich', total_net: 0, first_net: 0,
  });
  const [vertreter, setVertreter] = useState(() => {
    try { return localStorage.getItem(VERTRETER_KEY) || 'Christoph Napetschnig'; } catch { return 'Christoph Napetschnig'; }
  });
  const [busy, setBusy] = useState(false);
  const [signDialog, setSignDialog] = useState(false);
  const [sigPng, setSigPng] = useState<string | null>(null);
  const [handyQr, setHandyQr] = useState<string | null>(null);
  const signiertHier = useRef(false);
  const [mailDialog, setMailDialog] = useState(false);
  const [mailTo, setMailTo] = useState('');
  const [kopiert, setKopiert] = useState(false);
  const set = (p: Partial<Contract>) => setV((x) => ({ ...x, ...p }));

  useEffect(() => { if (loaded) { setV(loaded); setMailTo(loaded.party_email || ''); } }, [loaded]);

  // Wartet der Vertrag auf den Kunden: regelmäßig neu laden, damit neue
  // Unterschriften (✓) hier erscheinen. Nicht während der Mail-Eingabe.
  useEffect(() => {
    if (loaded?.status !== 'signed_by_us' || mailDialog) return;
    const t = setInterval(reload, 20000);
    return () => clearInterval(t);
  }, [loaded?.status, mailDialog, reload]);

  // Per QR am Handy geöffnet: gleich das Unterschriftsfeld zeigen.
  useEffect(() => { if (sp.get('unterschreiben') && loaded?.status === 'draft') setSignDialog(true); }, [sp, loaded]);

  // Neu aus einem Angebot: Partner, Betrag und Umfang übernehmen.
  useEffect(() => {
    const angebot = sp.get('angebot');
    if (!isNew || !angebot || !user) return;
    (async () => {
      const { data: d } = await db.from('documents').select('*').eq('id', angebot).maybeSingle();
      if (!d) return;
      const { data: items } = await db.from('document_items').select('name,description,is_heading').eq('document_id', angebot).order('position');
      // Nur die Beschreibungen – die Positionsnamen sind meist „Entwicklung Ihrer …" und sagen nichts über Funktionen.
      const umfang = ((items || []) as { name: string; description: string | null; is_heading: boolean }[])
        .filter((i) => !i.is_heading && i.description)
        .map((i) => i.description!.replace(/^alle gewünschten funktionen:\s*/i, '').trim())
        .join('; ');
      const net = round2(Number(d.net) || 0);
      set({
        document_id: d.id, offer_number: d.number, offer_date: d.doc_date, customer_id: d.customer_id,
        party_company: d.recipient_company, party_name: d.recipient_name, party_street: d.recipient_street,
        party_zip: d.recipient_zip, party_city: d.recipient_city, party_country: d.recipient_country || 'Österreich',
        party_uid: d.recipient_uid, party_email: d.recipient_email,
        title: d.title, scope: umfang, total_net: net, first_net: round2(net / 2),
        signers: signerAusName(d.recipient_name),
      });
      setMailTo(d.recipient_email || '');
    })();
  }, [isNew, sp, user]);

  const anbieter = useMemo(() => ({
    company_name: settings?.company_name || 'ePower GmbH', street: settings?.street, postal_code: settings?.postal_code,
    city: settings?.city, uid_number: settings?.uid_number, firmenbuch: settings?.firmenbuch, vertreter,
  }), [settings, vertreter]);

  // Unterzeichner auf Kundenseite – ohne Angabe aus dem Ansprechpartner abgeleitet.
  const signers: Signer[] = (v.signers && v.signers.length) ? v.signers : signerAusName(v.party_name);
  const setSigners = (s: Signer[]) => set({ signers: s });

  const status = (v.status || 'draft') as Contract['status'];
  const editierbar = status === 'draft';
  // Ab unserer Unterschrift gilt nur noch der eingefrorene Text.
  const text: VertragsText = useMemo(
    () => (!editierbar && v.text_frozen) ? v.text_frozen : vertragsText(v, anbieter),
    [v, anbieter, editierbar],
  );

  const speichern = async (extra: Partial<Contract> = {}): Promise<string | null> => {
    if (!user) return null;
    setBusy(true);
    let nummer = v.number;
    if (!nummer) { nummer = await reserveContractNumber(); if (!nummer) { setBusy(false); return null; } }
    const gespeichert = await saveContract({ ...v, ...extra, number: nummer }, user.id);
    setBusy(false);
    if (!gespeichert) return null;
    if (isNew) navigate(`/vertrag/${gespeichert}`, { replace: true });
    else { set({ ...extra, number: nummer }); reload(); }
    return gespeichert;
  };

  const bereitZumUnterschreiben = !busy && Number(v.total_net) > 0 && !!(v.party_company || v.party_name) && !signers.some((x) => !x.name.trim());

  /** Erst speichern – so unterschreibt auch das Handy (per QR) genau diesen Stand. */
  const signierenOeffnen = async () => { if (await speichern()) setSignDialog(true); };

  const handyLink = v.id ? `${window.location.origin}/vertrag/${v.id}?unterschreiben=1` : '';
  useEffect(() => {
    if (!signDialog || !handyLink) { setHandyQr(null); return; }
    QRCode.toDataURL(handyLink, { errorCorrectionLevel: 'M', margin: 1, width: 220 }).then(setHandyQr).catch(() => setHandyQr(null));
  }, [signDialog, handyLink]);

  // Während der Dialog offen ist: merken, wenn am Handy unterschrieben wurde.
  useEffect(() => {
    if (!signDialog || !v.id || !editierbar) return;
    const t = setInterval(async () => {
      if (signiertHier.current) return;
      const { data } = await db.from('contracts').select('status').eq('id', v.id).maybeSingle();
      if (data && data.status !== 'draft') {
        setSignDialog(false); reload();
        toast.success('Am Handy unterschrieben – der Link für den Kunden ist bereit');
      }
    }, 3000);
    return () => clearInterval(t);
  }, [signDialog, v.id, editierbar, reload]);

  /** Ich unterschreibe: Text einfrieren, Unterschrift ablegen, Link erzeugen. */
  const unterschreiben = async () => {
    if (!sigPng || !user) return;
    signiertHier.current = true;
    try { localStorage.setItem(VERTRETER_KEY, vertreter); } catch { /* egal */ }
    const jetzt = new Date().toISOString();
    const frozen = vertragsText({ ...v, our_signed_at: jetzt }, anbieter);
    const hash = await textHash(frozen);
    const ablauf = new Date(); ablauf.setDate(ablauf.getDate() + 30);
    const id = await speichern({
      status: 'signed_by_us', text_frozen: frozen, text_hash: hash,
      our_signature: sigPng, our_signed_name: vertreter, our_signed_at: jetzt,
      signers: signers.map((x) => ({ name: x.name.trim(), rolle: x.rolle || null, signature: null, signed_at: null })),
      token: neuerToken(), token_expires_at: ablauf.toISOString(),
    });
    signiertHier.current = false;
    if (id) { setSignDialog(false); setSigPng(null); toast.success('Unterschrieben – der Link für den Kunden ist bereit'); }
  };

  /**
   * Nur diese Felder schreiben – nie den ganzen Stand vom Öffnen der Seite.
   * Sonst überschreibt z. B. „Link erneuern" eine Kundenunterschrift, die
   * inzwischen über den Link hereingekommen ist.
   */
  const teilSpeichern = async (felder: Partial<Contract>): Promise<boolean> => {
    if (!user || !v.id) return false;
    setBusy(true);
    const ok = await saveContract({ id: v.id, ...felder }, user.id);
    setBusy(false);
    if (ok) reload();
    return !!ok;
  };

  /** Unsere Unterschrift zurücknehmen – warnt, wenn schon ein Kunde unterschrieben hat. */
  const zurueck = async () => {
    if (status !== 'signed_by_us' || !v.id) return;
    // Frisch aus der Datenbank: der Kunde kann seit dem Öffnen unterschrieben haben.
    const { data } = await db.from('contracts').select('signers').eq('id', v.id).maybeSingle();
    const schon = ((data?.signers || []) as Signer[]).filter((s) => s.signature).map((s) => s.name || 'Ein Unterzeichner');
    if (schon.length && !confirm(`${schon.join(' und ')} ${schon.length > 1 ? 'haben' : 'hat'} schon unterschrieben.\n\nZurück zum Entwurf macht das ungültig – der Kunde muss danach neu unterschreiben. Trotzdem?`)) return;
    const ok = await teilSpeichern({
      status: 'draft', text_frozen: null, text_hash: null, our_signature: null, our_signed_at: null, token: null, token_expires_at: null,
      // Keine alten Unterschriften unter einem Text, der sich jetzt wieder ändern kann.
      signers: signers.map((x) => ({ name: x.name, rolle: x.rolle || null, signature: null, signed_at: null })),
      customer_signature: null, customer_signed_name: null, customer_signed_at: null,
    });
    if (ok) toast.success('Wieder Entwurf – der alte Link ist ungültig');
  };

  /** Unterschriebenen Vertrag wieder öffnen: alle Unterschriften weg, Text wieder änderbar. */
  const wiederOeffnen = async () => {
    if (!confirm('Vertrag wieder öffnen? Alle Unterschriften (auch die des Kunden) werden entfernt, der Link wird ungültig.')) return;
    await speichern({
      status: 'draft', text_frozen: null, text_hash: null, our_signature: null, our_signed_at: null, token: null, token_expires_at: null,
      customer_signature: null, customer_signed_name: null, customer_signed_at: null, signed_seen_at: null,
      signers: signers.map((x) => ({ name: x.name, rolle: x.rolle || null, signature: null, signed_at: null })),
    });
    toast.success('Vertrag ist wieder ein Entwurf');
  };

  const linkErneuern = async () => {
    const ablauf = new Date(); ablauf.setDate(ablauf.getDate() + 30);
    if (await teilSpeichern({ token: neuerToken(), token_expires_at: ablauf.toISOString() })) toast.success('Neuer Link erzeugt – der alte gilt nicht mehr');
  };

  const pdf = () => buildContractPdf({ ...(v as Contract), our_signed_name: v.our_signed_name || vertreter }, text);
  const download = () => pdf().save(contractFileName(v as Contract));

  const link = v.token ? signLink(v.token) : '';
  const kopieren = async () => {
    try { await navigator.clipboard.writeText(link); setKopiert(true); setTimeout(() => setKopiert(false), 2000); }
    catch { toast.error('Kopieren nicht möglich – Link bitte markieren'); }
  };
  const whatsapp = () => {
    const txt = `Guten Tag ${signers.map((x) => x.name).filter(Boolean).join(' und ') || v.party_name || ''},\nhier der Vertrag zur Unterschrift – geht direkt am Handy:\n${link}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`, '_blank');
  };
  const mailSenden = async () => {
    if (!mailTo.trim()) return toast.error('E-Mail-Adresse fehlt');
    setBusy(true);
    const base64 = pdf().output('datauristring').split(',')[1];
    const fertig = status === 'signed';
    const ok = await sendDocumentMail({
      to: mailTo.trim(),
      subject: fertig ? `Unterschriebener Vertrag ${v.number || ''} – ${anbieter.company_name}` : `Vertrag ${v.number || ''} zur Unterschrift – ${anbieter.company_name}`,
      text: fertig
        ? `Guten Tag ${signers.map((x) => x.name).filter(Boolean).join(' und ') || v.party_name || ''},\n\nanbei der von allen Seiten unterschriebene Vertrag ${v.number || ''} als PDF.\n\nWir freuen uns auf die Zusammenarbeit!\n\nBeste Grüße\n${vertreter}\n${anbieter.company_name}`
        : `Guten Tag ${signers.map((x) => x.name).filter(Boolean).join(' und ') || v.party_name || ''},\n\nanbei unser Vertrag ${v.number || ''} als PDF – ich habe bereits unterschrieben.\n\nSie können ihn hier direkt am Handy oder PC unterschreiben${signers.length > 1 ? ' – jeder Unterzeichner für sich, auch zu verschiedenen Zeiten' : ''}:\n${link}\n\nDer Link ist 30 Tage gültig.\n\nBeste Grüße\n${vertreter}\n${anbieter.company_name}`,
      fileName: contractFileName(v as Contract),
      pdfBase64: base64,
    });
    setBusy(false);
    if (ok) { setMailDialog(false); toast.success('Gesendet an ' + mailTo); await saveContract({ id: v.id, party_email: mailTo.trim() }, user!.id); }
  };

  const loeschen = async () => {
    if (!v.id || status === 'signed') return;
    if (!confirm('Vertrag wirklich löschen?')) return;
    if (await deleteContract(v.id)) navigate('/vertraege');
  };

  if (!isNew && isLoading) return (<div className="min-h-screen bg-background"><AppNav /><p className="p-8 text-muted-foreground">Laden …</p></div>);

  const rest = round2((Number(v.total_net) || 0) - (Number(v.first_net) || 0));
  // Bewusst eine Funktion, keine Komponente: eine in der Render-Funktion definierte
  // Komponente würde bei jedem Tastendruck neu montiert und den Fokus verlieren.
  const feld = (label: string, k: keyof Contract, type = 'text', placeholder?: string) => (
    <div key={k}>
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Input type={type} value={(v[k] as string | number | null) ?? ''} placeholder={placeholder} disabled={!editierbar}
        onChange={(e) => set({ [k]: type === 'number' ? Number(e.target.value) : e.target.value } as Partial<Contract>)} />
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <AppNav>
        {/* Am Handy nur Symbole – sonst schiebt die Leiste die Knöpfe aus dem Bild. */}
        {editierbar && (
          <Button size="sm" variant="outline" className="gap-1" disabled={busy} onClick={() => speichern()} aria-label="Speichern">
            <Save className="w-4 h-4" /> <span className="hidden sm:inline">Speichern</span>
          </Button>
        )}
        <Button size="sm" variant="outline" className="gap-1" onClick={download} aria-label="PDF">
          <Download className="w-4 h-4" /> <span className="hidden sm:inline">PDF</span>
        </Button>
        {editierbar && (
          <Button size="sm" className="gap-1 hidden lg:inline-flex" disabled={!bereitZumUnterschreiben} onClick={signierenOeffnen}>
            <FileSignature className="w-4 h-4" /> Jetzt unterschreiben
          </Button>
        )}
      </AppNav>

      <main className="max-w-[1400px] mx-auto px-4 py-5 grid lg:grid-cols-[440px_1fr] gap-5">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Link to="/vertraege"><Button variant="ghost" size="sm" className="gap-1"><ArrowLeft className="w-4 h-4" /> Verträge</Button></Link>
            <span className="font-semibold">{v.number || 'Neuer Vertrag'}</span>
            <Badge variant={status === 'signed' ? 'default' : 'outline'} className={status === 'signed' ? 'bg-green-600' : status === 'signed_by_us' ? 'border-amber-400 text-amber-700' : ''}>
              {CONTRACT_STATUS_LABEL[status]}
            </Badge>
          </div>

          {editierbar && (
            <Button size="lg" className="w-full gap-2 lg:hidden" disabled={!bereitZumUnterschreiben} onClick={signierenOeffnen}>
              <FileSignature className="w-4 h-4" /> Jetzt unterschreiben
            </Button>
          )}

          {/* Link-Kasten: das Herzstück, sobald ich unterschrieben habe */}
          {status === 'signed_by_us' && link && (
            <Card className="p-4 border-amber-300 bg-amber-50/60">
              <div className="font-semibold text-sm flex items-center gap-1.5 mb-1"><Link2 className="w-4 h-4" /> Link für den Kunden</div>
              <p className="text-xs text-muted-foreground mb-2">
                Damit öffnet der Kunde den Vertrag und unterschreibt mit dem Finger – direkt am Handy. Gültig bis {new Date(v.token_expires_at || '').toLocaleDateString('de-AT')}.
                {signers.length > 1 && <> Unterzeichner: {signers.map((x) => `${x.name}${x.signature ? ' ✓' : ''}`).join(', ')} – jeder für sich über denselben Link.</>}
              </p>
              <div className="flex gap-1.5 mb-2">
                <Input readOnly value={link} className="text-xs h-8" onFocus={(e) => e.currentTarget.select()} />
                <Button size="sm" variant="outline" className="h-8 gap-1 shrink-0" onClick={kopieren}>
                  {kopiert ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />} {kopiert ? 'kopiert' : 'kopieren'}
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" className="h-8 gap-1" onClick={() => setMailDialog(true)}><Mail className="w-3.5 h-3.5" /> Per E-Mail senden</Button>
                <Button size="sm" variant="outline" className="h-8 gap-1" onClick={whatsapp}><MessageCircle className="w-3.5 h-3.5" /> WhatsApp</Button>
                <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={linkErneuern} disabled={busy}><RefreshCw className="w-3.5 h-3.5" /> Link erneuern</Button>
                <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={zurueck} disabled={busy}><Undo2 className="w-3.5 h-3.5" /> Zurück zum Entwurf</Button>
              </div>
            </Card>
          )}

          {status === 'signed' && (
            <Card className="p-4 border-green-300 bg-green-50/60">
              <div className="font-semibold text-sm flex items-center gap-1.5 mb-1"><Check className="w-4 h-4 text-green-600" /> Von beiden Seiten unterschrieben</div>
              <p className="text-xs text-muted-foreground mb-2">
                {signers.map((x) => x.name).filter(Boolean).join(' und ')} – zuletzt am {new Date(v.customer_signed_at || '').toLocaleString('de-AT', { dateStyle: 'medium', timeStyle: 'short' })}.
                {/* Geht nicht automatisch hinaus – dem Kunden wurde es aber angekündigt. */}
                {v.party_email && <> Dem Kunden wurde angekündigt, dass das PDF noch an <b>{v.party_email}</b> kommt.</>}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" className="h-8 gap-1" onClick={download}><Download className="w-3.5 h-3.5" /> PDF herunterladen</Button>
                <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => setMailDialog(true)}><Mail className="w-3.5 h-3.5" /> Dem Kunden senden</Button>
                <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={wiederOeffnen} disabled={busy}><RotateCcw className="w-3.5 h-3.5" /> Vertrag wieder öffnen</Button>
              </div>
            </Card>
          )}

          <Card className="p-4 space-y-3">
            <div className="text-sm font-semibold">Vertragspartner</div>
            {v.offer_number && <p className="text-[11px] text-muted-foreground">aus Angebot {v.offer_number}{v.document_id && <> · <Link className="underline" to={`/beleg/${v.document_id}`}>öffnen</Link></>}</p>}
            {feld('Firma', 'party_company')}
            <div className="grid grid-cols-2 gap-2">
              {feld('Ansprechpartner', 'party_name', 'text', 'Herrn Max Muster')}
              {feld('E-Mail', 'party_email', 'email')}
            </div>
            {feld('Straße', 'party_street')}
            <div className="grid grid-cols-[100px_1fr] gap-2">
              {feld('PLZ', 'party_zip')}{feld('Ort', 'party_city')}
            </div>
            {feld('UID', 'party_uid')}
            <div>
              <Label className="text-[11px] text-muted-foreground">Wer unterschreibt für den Auftraggeber?</Label>
              <div className="space-y-1.5 mt-1">
                {signers.map((sg, i) => (
                  <div key={i} className="flex gap-1.5">
                    <Input className="h-8" placeholder="Vor- und Nachname" value={sg.name} disabled={!editierbar}
                      onChange={(e) => setSigners(signers.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
                    <Input className="h-8 w-40" placeholder="z. B. Geschäftsführer" value={sg.rolle || ''} disabled={!editierbar}
                      onChange={(e) => setSigners(signers.map((x, k) => (k === i ? { ...x, rolle: e.target.value } : x)))} />
                    {editierbar && signers.length > 1 && (
                      <Button type="button" size="sm" variant="ghost" className="h-8 px-2" onClick={() => setSigners(signers.filter((_, k) => k !== i))} aria-label="Unterzeichner entfernen"><X className="w-3.5 h-3.5" /></Button>
                    )}
                  </div>
                ))}
                {editierbar && (
                  <Button type="button" size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => setSigners([...signers, { name: '', rolle: null, signature: null, signed_at: null }])}>
                    <Plus className="w-3.5 h-3.5" /> weiteren Unterzeichner
                  </Button>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">Bei zwei Geschäftsführern unterschreibt jeder für sich – auch zu verschiedenen Zeiten über denselben Link.</p>
            </div>
          </Card>

          <Card className="p-4 space-y-3">
            <div className="text-sm font-semibold">Leistung und Preis</div>
            {feld('Bezeichnung der Software', 'title', 'text', 'Handwerkersoftware')}
            <div>
              <Label className="text-[11px] text-muted-foreground">Gewünschte Funktionen (kommt in Punkt 1)</Label>
              <Textarea rows={3} value={v.scope || ''} disabled={!editierbar} onChange={(e) => set({ scope: e.target.value })}
                placeholder="Kalkulation, Angebote, Rechnungen, Zeiterfassung, …" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {feld('Gesamt netto', 'total_net', 'number')}
              <div>
                <Label className="text-[11px] text-muted-foreground">Sofort fällig (netto)</Label>
                <Input type="number" value={v.first_net ?? ''} disabled={!editierbar} onChange={(e) => set({ first_net: Number(e.target.value) })} />
                {editierbar && (
                  <div className="flex gap-1 mt-1">
                    {[50, 100].map((p) => (
                      <Button key={p} type="button" size="sm" variant="ghost" className="h-6 px-2 text-[11px]"
                        onClick={() => set({ first_net: round2((Number(v.total_net) || 0) * p / 100) })}>{p} %</Button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {rest > 0 && (
              <div>
                <Label className="text-[11px] text-muted-foreground">Rest {eur(rest)} netto ist fällig …</Label>
                <Input value={v.rest_terms || ''} disabled={!editierbar} onChange={(e) => set({ rest_terms: e.target.value })}
                  placeholder={DEFAULT_REST_TERMS} />
                {editierbar && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {[DEFAULT_REST_TERMS, 'nach Übergabe der Zugänge', 'zwei Monate nach Vertragsabschluss'].map((t) => (
                      <Button key={t} type="button" size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => set({ rest_terms: t })}>{t}</Button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              {feld('Betreuung inklusive (Monate)', 'support_months', 'number')}
              {feld('Wartung ab 2. Jahr (€/Monat netto)', 'maintenance_monthly', 'number')}
            </div>
            <p className="text-[11px] text-muted-foreground -mt-1">
              Der Wartungsvertrag steht in Punkt 3: Änderungen und Wünsche werden weiter umgesetzt, Hosting übernommen, jährlich abgerechnet. 0 = Absatz weglassen.
            </p>
            <div>
              <Label className="text-[11px] text-muted-foreground">Besondere Vereinbarungen (optional)</Label>
              <Textarea rows={2} value={v.extra_terms || ''} disabled={!editierbar} onChange={(e) => set({ extra_terms: e.target.value })}
                placeholder="z. B. Umzug der Daten aus der bisherigen Software, ein Vor-Ort-Termin …" />
            </div>
          </Card>

          {v.id && status !== 'signed' && (
            <Button variant="ghost" size="sm" className="text-red-600 gap-1" onClick={loeschen}><Trash2 className="w-4 h-4" /> Vertrag löschen</Button>
          )}
        </div>

        <Card className="p-6 lg:p-8 bg-white">
          <VertragAnsicht text={text}
            links={{ png: v.our_signature || null, name: v.our_signed_name || null, wann: v.our_signed_at || null }}
            rechts={signers.map(signerZuUnterschrift)} />
        </Card>
      </main>

      {/* Meine Unterschrift */}
      <Dialog open={signDialog} onOpenChange={setSignDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Vertrag unterschreiben</DialogTitle>
            <DialogDescription>Danach ist der Text festgeschrieben und der Link für den Kunden entsteht.</DialogDescription>
          </DialogHeader>
          <div>
            <Label className="text-[11px] text-muted-foreground">Unterschrieben von</Label>
            <Input value={vertreter} onChange={(e) => setVertreter(e.target.value)} />
          </div>
          <UnterschriftFeld onChange={setSigPng} height={160} titel={`Unterschrift ${vertreter}`} />
          {handyQr && (
            <div className="hidden sm:flex items-center gap-3 rounded-lg border p-3">
              <img src={handyQr} alt="QR-Code: am Handy unterschreiben" className="w-24 h-24 shrink-0" />
              <div className="text-xs text-muted-foreground">
                <div className="font-medium text-foreground flex items-center gap-1 mb-0.5"><Smartphone className="w-3.5 h-3.5" /> Lieber am Handy?</div>
                QR-Code scannen und dort mit dem Finger unterschreiben – dieses Fenster merkt es von selbst.
              </div>
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => setSignDialog(false)}>Abbrechen</Button>
            <Button onClick={unterschreiben} disabled={!sigPng || !vertreter.trim() || busy} className="gap-1">
              <FileSignature className="w-4 h-4" /> Unterschreiben und Link erzeugen
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Per Mail */}
      <Dialog open={mailDialog} onOpenChange={setMailDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{status === 'signed' ? 'Unterschriebenen Vertrag senden' : 'Zur Unterschrift senden'}</DialogTitle>
            <DialogDescription>PDF im Anhang{status !== 'signed' && ', Unterschriftslink im Text'} – über deine Gmail-Verbindung.</DialogDescription>
          </DialogHeader>
          <Input type="email" value={mailTo} onChange={(e) => setMailTo(e.target.value)} placeholder="kunde@firma.at" />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setMailDialog(false)}>Abbrechen</Button>
            <Button onClick={mailSenden} disabled={busy} className="gap-1"><Mail className="w-4 h-4" /> Senden</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
