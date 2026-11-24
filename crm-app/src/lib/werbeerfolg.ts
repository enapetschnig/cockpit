/**
 * Werbeerfolg / ROAS (24.11.2026) – Rechenteil der Seite /werbeerfolg (docs/17-werbeerfolg.md).
 *
 * Auftragswert: angenommene Angebote, Rechnungsketten und einzelne Rechnungen (netto) – auch was noch nicht verrechnet ist.
 * Verrechnet: Rechnungen, Teil- und Schlussrechnungen (netto), Gutschriften negativ, ohne Storno.
 * Beides zusammengefasst je Firma (Kunde, sonst Empfänger auf dem Beleg).
 * Herkunft einer Firma: von Hand gesetzt (crm.werbe_herkunft) – sonst die Quelle ihrer Anfrage im CRM.
 * Kosten: Abbuchungen aus dem Kontoauszug (crm.liq_buchungen) nach Text – FACEBK → Facebook/Instagram,
 *         PAGRO und POST → Briefe – plus Ausnahmen und nachgetragene Kosten aus crm.werbekosten.
 * ROAS = Auftragswert (bzw. Verrechnetes) der Kunden aus dem Kanal ÷ Kosten des Kanals im selben Zeitraum.
 */

export type Herkunft = 'facebook' | 'instagram' | 'brief' | 'website' | 'empfehlung' | 'youtube' | 'privat' | 'sonstiges';
export type KostenKanal = 'meta' | 'brief';

export const HERKUNFT: { wert: Herkunft; label: string }[] = [
  { wert: 'facebook', label: 'Facebook' },
  { wert: 'instagram', label: 'Instagram' },
  { wert: 'brief', label: 'Brief' },
  { wert: 'website', label: 'Website' },
  { wert: 'empfehlung', label: 'Empfehlung' },
  { wert: 'youtube', label: 'YouTube' },
  { wert: 'privat', label: 'Privat (selbst akquiriert)' },
  { wert: 'sonstiges', label: 'Sonstiges' },
];
export const KANAL_LABEL: Record<KostenKanal, string> = { meta: 'Facebook & Instagram', brief: 'Briefe' };

export interface Beleg {
  id: string; kind: string; status: string; doc_date: string; net: number; customer_id: string | null; lead_id: string | null;
  recipient_company: string | null; recipient_name: string | null;
  projekt_id: string | null; project_total: number | null; source_document: string | null;
}
export interface Kunde { id: string; company_name: string | null; first_name: string | null; last_name: string | null; lead_id: string | null }
export interface LeadQuelle { id: string; source: string | null }
export interface HerkunftZeile { firma_key: string; firma: string; kanal: Herkunft }
export interface Buchung { id: string; konto: string; datum: string; betrag: number; text: string | null }
export interface KostenZeile { id: string; buchung_id: string | null; kanal: KostenKanal | 'sonstiges' | null; datum: string | null; betrag: number | null; text: string | null }

/** Gleiche Schreibweise wie in der Migration: klein, Leerzeichen zusammengezogen. */
export const firmaKey = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

export function herkunftAusLead(source: string | null | undefined): Herkunft | null {
  switch (source) {
    case 'facebook': case 'instagram': case 'brief': case 'website': return source;
    case 'referral': return 'empfehlung';
    default: return null; // „other“, „phone“ … sagen nichts über die Herkunft
  }
}

/** Welche Abbuchung zählt automatisch zu welchem Kanal (Text aus dem Kontoauszug). */
export function kanalAusBuchung(text: string | null): KostenKanal | null {
  if (!text) return null;
  if (/FACEBK|FACEBOOK|META PLATFORMS/i.test(text)) return 'meta';
  if (/PAGRO|\bPOST\b/i.test(text)) return 'brief';
  return null;
}

export const kostenKanalVon = (h: Herkunft | null): KostenKanal | null =>
  h === 'facebook' || h === 'instagram' ? 'meta' : h === 'brief' ? 'brief' : null;

export interface Posten { datum: string; betrag: number }
export interface Firma {
  key: string; name: string;
  herkunft: Herkunft | null; vonHand: boolean;
  erste: string; // erster Auftrag bzw. erste Rechnung (Datum)
  auftraege: Posten[];   // Auftragswert (angenommene Angebote, Rechnungsketten, einzelne Rechnungen) – auch noch nicht verrechnet
  rechnungen: Posten[];  // tatsächlich verrechnet
}

export interface KostenPosten {
  /** Buchung oder eigener Eintrag */
  id: string; buchungId: string | null; datum: string; betrag: number; text: string;
  kanal: KostenKanal | null; // null = zählt nicht
  auto: KostenKanal | null;  // was die Regel sagen würde
  eigenerEintrag: boolean;
}

const RECHNUNG = ['invoice', 'partial_invoice', 'final_invoice'];

/**
 * Je Firma: Aufträge und Rechnungen.
 * Verrechnet = Rechnungen netto (auch „Entwurf“ – im Cockpit bleibt eine ausgestellte Rechnung bis zur Zahlung so stehen),
 *              Gutschriften negativ, Storno nicht.
 * Auftragswert = angenommenes Angebot (mindestens, was dazu schon verrechnet wurde) · sonst je Rechnungskette (projekt_id)
 *              der Auftragswert der Kette · sonst die einzelne Rechnung. So zählt bei SETEC schon der ganze Auftrag (8.000),
 *              obwohl erst die Anzahlung verrechnet ist.
 */
export function firmenBilden(belege: Beleg[], kunden: Kunde[], leads: LeadQuelle[], herkunft: HerkunftZeile[]): Firma[] {
  const kundeById = new Map(kunden.map((k) => [k.id, k]));
  const quelle = new Map(leads.map((l) => [l.id, l.source]));
  const vonHand = new Map(herkunft.map((h) => [h.firma_key, h.kanal]));
  const gueltig = belege.filter((b) => b.status !== 'cancelled' && (RECHNUNG.includes(b.kind) || b.kind === 'credit_note' || (b.kind === 'offer' && b.status === 'accepted')));
  const byId = new Map(belege.map((b) => [b.id, b]));
  const angebote = new Map(gueltig.filter((b) => b.kind === 'offer').map((b) => [b.id, b]));

  // Kette einer Rechnung: projekt_id, sonst die Rechnung, aus der sie entstand, sonst sie selbst
  const wurzel = (b: Beleg, tiefe = 0): string => {
    if (b.projekt_id) return b.projekt_id;
    const q = b.source_document ? byId.get(b.source_document) : undefined;
    return q && q.kind !== 'offer' && tiefe < 10 ? wurzel(q, tiefe + 1) : b.id;
  };
  const ketten = new Map<string, Beleg[]>();
  for (const b of gueltig) if (RECHNUNG.includes(b.kind)) (ketten.get(wurzel(b)) ?? ketten.set(wurzel(b), []).get(wurzel(b))!).push(b);

  const nameVon = (b: Beleg) => {
    const k = b.customer_id ? kundeById.get(b.customer_id) : undefined;
    return (k ? k.company_name || [k.first_name, k.last_name].filter(Boolean).join(' ') : b.recipient_company || b.recipient_name)?.trim() || null;
  };
  const firmen = new Map<string, Firma & { leadIds: string[] }>();
  const firmaVon = (b: Beleg) => {
    const name = nameVon(b);
    if (!name) return null;
    const key = firmaKey(name);
    let f = firmen.get(key);
    if (!f) { f = { key, name, herkunft: null, vonHand: false, erste: b.doc_date, auftraege: [], rechnungen: [], leadIds: [] }; firmen.set(key, f); }
    const k = b.customer_id ? kundeById.get(b.customer_id) : undefined;
    for (const id of [b.lead_id, k?.lead_id]) if (id && !f.leadIds.includes(id)) f.leadIds.push(id);
    if (b.doc_date < f.erste) f.erste = b.doc_date;
    return f;
  };

  // Verrechnet
  for (const b of gueltig) {
    if (b.kind === 'offer') continue;
    const f = firmaVon(b);
    if (f) f.rechnungen.push({ datum: b.doc_date, betrag: (b.kind === 'credit_note' ? -1 : 1) * (Number(b.net) || 0) });
  }

  // Auftragswert: Ketten an ihr Angebot hängen
  const zumAngebot = new Map<string, number>(); // Angebot → schon verrechnet bzw. Auftragswert der Ketten
  for (const rows of ketten.values()) {
    rows.sort((a, b) => a.doc_date.localeCompare(b.doc_date));
    const summe = rows.reduce((s, r) => s + (Number(r.net) || 0), 0);
    const pt = Number([...rows].reverse().find((r) => Number(r.project_total) > 0)?.project_total || 0);
    const wert = Math.max(summe, pt);
    const angebotId = rows.map((r) => r.source_document).find((id) => id && angebote.has(id));
    if (angebotId) { zumAngebot.set(angebotId, (zumAngebot.get(angebotId) ?? 0) + wert); continue; }
    const f = firmaVon(rows[0]);
    if (f) f.auftraege.push({ datum: rows[0].doc_date, betrag: wert });
  }
  for (const a of angebote.values()) {
    const f = firmaVon(a);
    if (f) f.auftraege.push({ datum: a.doc_date, betrag: Math.max(Number(a.net) || 0, zumAngebot.get(a.id) ?? 0) });
  }
  for (const b of gueltig) if (b.kind === 'credit_note') { const f = firmaVon(b); if (f) f.auftraege.push({ datum: b.doc_date, betrag: -(Number(b.net) || 0) }); }

  return [...firmen.values()].map(({ leadIds, ...f }) => {
    const hand = vonHand.get(f.key);
    const ausLead = leadIds.map((id) => herkunftAusLead(quelle.get(id))).find(Boolean) ?? null;
    return { ...f, herkunft: hand ?? ausLead, vonHand: Boolean(hand) };
  });
}

export function kostenBilden(buchungen: Buchung[], eintraege: KostenZeile[]): KostenPosten[] {
  const ausnahme = new Map(eintraege.filter((e) => e.buchung_id).map((e) => [e.buchung_id as string, e]));
  const out: KostenPosten[] = [];
  for (const b of buchungen) {
    if (Number(b.betrag) >= 0) continue;
    const auto = kanalAusBuchung(b.text);
    const a = ausnahme.get(b.id);
    if (!auto && !a) continue;
    const kanal = a ? (a.kanal === 'meta' || a.kanal === 'brief' ? a.kanal : null) : auto;
    out.push({ id: b.id, buchungId: b.id, datum: b.datum, betrag: -Number(b.betrag), text: (b.text ?? '').replace(/\s+/g, ' ').trim(), kanal, auto, eigenerEintrag: false });
  }
  for (const e of eintraege) {
    if (e.buchung_id || !e.datum || e.betrag == null) continue;
    out.push({ id: e.id, buchungId: null, datum: e.datum, betrag: Number(e.betrag), text: e.text ?? '', kanal: e.kanal === 'meta' || e.kanal === 'brief' ? e.kanal : null, auto: null, eigenerEintrag: true });
  }
  return out.sort((x, y) => y.datum.localeCompare(x.datum));
}

/** Zeitraum: Jahr ('2026') oder 'alle'. */
export const imZeitraum = (datum: string, zeitraum: string) => zeitraum === 'alle' || datum.startsWith(zeitraum);

export const summeIm = (posten: Posten[], zeitraum: string) =>
  posten.filter((p) => imZeitraum(p.datum, zeitraum)).reduce((s, p) => s + p.betrag, 0);

export interface KanalSumme {
  kosten: number; auftrag: number; verrechnet: number; neukunden: number;
  roas: number | null;            // auf den Auftragswert
  roasVerrechnet: number | null;  // nur auf das, was schon verrechnet ist
  auftragInstagram: number;
}

export function kanalSumme(firmen: Firma[], kosten: KostenPosten[], kanaele: KostenKanal[], zeitraum: string): KanalSumme {
  const k = kosten.filter((p) => p.kanal && kanaele.includes(p.kanal) && imZeitraum(p.datum, zeitraum)).reduce((s, p) => s + p.betrag, 0);
  let auftrag = 0, verrechnet = 0, auftragInstagram = 0, neukunden = 0;
  for (const f of firmen) {
    const kk = kostenKanalVon(f.herkunft);
    if (!kk || !kanaele.includes(kk)) continue;
    const a = summeIm(f.auftraege, zeitraum);
    auftrag += a;
    verrechnet += summeIm(f.rechnungen, zeitraum);
    if (f.herkunft === 'instagram') auftragInstagram += a;
    if (imZeitraum(f.erste, zeitraum)) neukunden++;
  }
  return { kosten: k, auftrag, verrechnet, neukunden, roas: k > 0 ? auftrag / k : null, roasVerrechnet: k > 0 ? verrechnet / k : null, auftragInstagram };
}

export interface VerlaufMonat { monat: string; kosten: number; auftrag: number; verrechnet: number; kostenSumme: number; auftragSumme: number; verrechnetSumme: number }

/** Monate des Zeitraums mit Kosten, Auftragswert und Verrechnetem, aufsummiert (für die Linien). */
export function monatsVerlauf(firmen: Firma[], kosten: KostenPosten[], kanaele: KostenKanal[], zeitraum: string): VerlaufMonat[] {
  const proMonat = new Map<string, { kosten: number; auftrag: number; verrechnet: number }>();
  const add = (m: string, feld: 'kosten' | 'auftrag' | 'verrechnet', v: number) => {
    const e = proMonat.get(m) ?? { kosten: 0, auftrag: 0, verrechnet: 0 }; e[feld] += v; proMonat.set(m, e);
  };
  for (const p of kosten) if (p.kanal && kanaele.includes(p.kanal) && imZeitraum(p.datum, zeitraum)) add(p.datum.slice(0, 7), 'kosten', p.betrag);
  for (const f of firmen) {
    const kk = kostenKanalVon(f.herkunft);
    if (!kk || !kanaele.includes(kk)) continue;
    for (const p of f.auftraege) if (imZeitraum(p.datum, zeitraum)) add(p.datum.slice(0, 7), 'auftrag', p.betrag);
    for (const p of f.rechnungen) if (imZeitraum(p.datum, zeitraum)) add(p.datum.slice(0, 7), 'verrechnet', p.betrag);
  }
  const jetzt = new Date();
  const bis = `${jetzt.getFullYear()}-${String(jetzt.getMonth() + 1).padStart(2, '0')}`;
  let von: string, ende: string;
  if (zeitraum === 'alle') {
    const keys = [...proMonat.keys()].sort();
    if (!keys.length) return [];
    von = keys[0]; ende = bis > keys[keys.length - 1] ? bis : keys[keys.length - 1];
  } else {
    von = `${zeitraum}-01`; ende = zeitraum === bis.slice(0, 4) ? bis : `${zeitraum}-12`;
  }
  const out: VerlaufMonat[] = [];
  let ks = 0, as = 0, vs = 0;
  for (let [j, m] = von.split('-').map(Number); ; m++) {
    if (m > 12) { m = 1; j++; }
    const key = `${j}-${String(m).padStart(2, '0')}`;
    if (key > ende) break;
    const e = proMonat.get(key) ?? { kosten: 0, auftrag: 0, verrechnet: 0 };
    ks += e.kosten; as += e.auftrag; vs += e.verrechnet;
    out.push({ monat: key, ...e, kostenSumme: ks, auftragSumme: as, verrechnetSumme: vs });
  }
  return out;
}
