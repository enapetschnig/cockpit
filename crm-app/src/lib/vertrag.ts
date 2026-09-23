/**
 * Der Vertrag: Entwicklung individueller Software + Verschwiegenheit in einem.
 *
 * Aus wenigen Feldern (Partner, Umfang, Betrag, erste Rate, Rest) entsteht der
 * ganze Text – genau einmal, hier. Vorschau im Editor, PDF und die öffentliche
 * Unterschriftsseite zeigen alle dieselben Absätze. Sobald wir unterschreiben,
 * wird der Text am Vertrag eingefroren (text_frozen); ab dann zählt nur der.
 */
import { round2 } from '@/types/billing';

export type ContractStatus = 'draft' | 'signed_by_us' | 'signed' | 'cancelled';

export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  draft: 'Entwurf',
  signed_by_us: 'Wartet auf Kunde',
  signed: 'Unterschrieben',
  cancelled: 'Storniert',
};

export interface Signer {
  name: string;
  /** z. B. „Geschäftsführer" oder eine zweite Firma, die mit unterschreibt. */
  rolle?: string | null;
  signature: string | null;
  signed_at: string | null;
  ip?: string | null;
  ua?: string | null;
  /** Hat selbst bestätigt: „gelesen und stimme zu" – jeder für sich. */
  zugestimmt?: boolean;
}

/** Aus „Herren Thomas Wilfinger und Roman Kancz" werden zwei Unterzeichner. */
export function signerAusName(partyName?: string | null): Signer[] {
  const roh = (partyName || '').replace(/^(Herrn|Herr|Frau|Herren|Damen|Firma)\s+/i, '').trim();
  const teile = roh.split(/\s+(?:und|&|\/)\s+|,\s*/).map((t) => t.trim()).filter(Boolean);
  return (teile.length ? teile : ['']).map((name) => ({ name, signature: null, signed_at: null }));
}

export const alleUnterschrieben = (s: Signer[] | null | undefined) =>
  !!s && s.length > 0 && s.every((x) => !!x.signature);

export interface Contract {
  id: string;
  user_id: string;
  number: string | null;
  status: ContractStatus;
  customer_id: string | null;
  document_id: string | null;
  offer_number: string | null;
  offer_date: string | null;
  party_company: string | null;
  party_name: string | null;
  party_street: string | null;
  party_zip: string | null;
  party_city: string | null;
  party_country: string | null;
  party_uid: string | null;
  party_email: string | null;
  title: string | null;
  scope: string | null;
  total_net: number;
  first_net: number;
  rest_terms: string | null;
  support_months: number;
  /** Wartungsvertrag ab dem 2. Jahr, netto je Monat. */
  maintenance_monthly: number;
  extra_terms: string | null;
  text_frozen: VertragsText | null;
  text_hash: string | null;
  our_signature: string | null;
  our_signed_name: string | null;
  our_signed_at: string | null;
  customer_signature: string | null;
  customer_signed_name: string | null;
  customer_signed_at: string | null;
  /** Unterzeichner auf Kundenseite – jeder unterschreibt für sich, auch zu verschiedenen Zeiten. */
  signers: Signer[];
  token: string | null;
  token_expires_at: string | null;
  /** Wann die „unterschrieben"-Meldung am Dashboard weggeklickt wurde. */
  signed_seen_at: string | null;
  created_at: string;
}

/** Was von der Firma in den Vertrag einfließt. */
export interface Anbieter {
  company_name: string;
  street?: string | null;
  postal_code?: string | null;
  city?: string | null;
  uid_number?: string | null;
  firmenbuch?: string | null;
  /** Wer für die Firma unterschreibt. */
  vertreter: string;
}

export interface Abschnitt { heading: string; body: string }

export interface VertragsText {
  titel: string;
  nummer: string;
  datum: string;
  anbieter: string[];     // Adressblock Auftragnehmer
  partner: string[];      // Adressblock Auftraggeber
  abschnitte: Abschnitt[];
}

export const eurLang = (n: number) =>
  (Number(n) || 0).toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' EUR';

const datum = (d?: string | null) => {
  if (!d) return '';
  const x = new Date(d);
  const p = (v: number) => String(v).padStart(2, '0');
  return `${p(x.getDate())}.${p(x.getMonth() + 1)}.${x.getFullYear()}`;
};

export const DEFAULT_REST_TERMS = 'einen Monat nach Vertragsabschluss';

/**
 * Den Vertragstext aus den Feldern bauen. Kurz gehalten, in ganzen Sätzen,
 * ohne Juristendeutsch – so, dass ihn ein Handwerker am Handy liest und versteht.
 */
export function vertragsText(v: Partial<Contract>, a: Anbieter): VertragsText {
  const gesamt = round2(Number(v.total_net) || 0);
  const erste = round2(Math.min(Number(v.first_net) || 0, gesamt));
  const rest = round2(gesamt - erste);
  const monate = Number(v.support_months) || 12;
  const wartung = round2(Number(v.maintenance_monthly ?? 50) || 0);
  const partner = (v.party_company || v.party_name || 'dem Auftraggeber').trim();
  const umfang = (v.scope || '').trim();

  const abschnitte: Abschnitt[] = [];

  abschnitte.push({
    heading: '1. Gegenstand',
    body:
      `${a.company_name} entwickelt für ${partner} eine eigene, individuelle Software${v.title ? ` („${v.title.trim()}")` : ''} – ` +
      `kein Baukasten-Produkt, sondern von Grund auf für den Betrieb des Auftraggebers gebaut. ` +
      `Umgesetzt wird alles, was der Auftraggeber sich für seinen Betrieb wünscht – auch Funktionen, die erst während der Entwicklung dazukommen. ` +
      (umfang ? `Dazu gehören jedenfalls: ${umfang.replace(/\.\s*$/, '')}. ` : '') +
      (v.offer_number ? `Das Angebot ${v.offer_number}${v.offer_date ? ` vom ${datum(v.offer_date)}` : ''} ist die Grundlage für den Preis, nicht die Grenze des Umfangs. ` : '') +
      `Die Software läuft auf Handy, Tablet und PC. Jeder Mitarbeiter des Auftraggebers erhält einen eigenen Zugang, ohne Lizenzgebühr je Zugang.`,
  });

  const zahlung = rest > 0.009
    ? `Davon sind ${eurLang(erste)} netto sofort bei Vertragsabschluss fällig. ` +
      `Der Restbetrag von ${eurLang(rest)} netto ist ${(v.rest_terms || DEFAULT_REST_TERMS).trim().replace(/\.\s*$/, '')} fällig.`
    : `Der gesamte Betrag ist sofort bei Vertragsabschluss fällig.`;
  abschnitte.push({
    heading: '2. Vergütung',
    body:
      `Die Entwicklung kostet einmalig ${eurLang(gesamt)} netto zuzüglich 20 % Umsatzsteuer (${eurLang(round2(gesamt * 1.2))} brutto). ` +
      zahlung + ` Zahlungsziel jeweils 7 Tage ab Rechnungsdatum. Laufende Kosten für die Software selbst entstehen nicht.`,
  });

  abschnitte.push({
    heading: `3. Betreuung – ${monate === 12 ? 'ein Jahr' : `${monate} Monate`} inklusive`,
    body:
      `Ab Übergabe der Zugänge sind Weiterentwicklung und Support für ${monate === 12 ? 'ein Jahr' : `${monate} Monate`} im Preis enthalten: ` +
      `neue Funktionen und Anpassungen, wenn sich die Abläufe im Betrieb ändern, sowie persönliche Hilfe bei Fragen – ohne Zusatzkosten. ` +
      (wartung > 0
        ? `\n\nAb dem zweiten Jahr läuft ein Wartungsvertrag um ${eurLang(wartung)} netto im Monat, das sind ${eurLang(round2(wartung * 12))} netto im Jahr, jährlich im Voraus verrechnet. ` +
          `Darin enthalten sind das Hosting und der Betrieb der Software sowie die laufende Umsetzung von Änderungen und neuen Wünschen – die Betreuung geht also einfach weiter. ` +
          `Der Wartungsvertrag verlängert sich jeweils um ein Jahr und kann bis einen Monat vor Ablauf gekündigt werden; die Software bleibt auch danach nutzbar.`
        : `Danach kann die Betreuung auf Wunsch verlängert werden; die Software bleibt auch ohne Verlängerung uneingeschränkt nutzbar.`),
  });

  abschnitte.push({
    heading: '4. Nutzungsrecht',
    body:
      `Der Auftraggeber erhält mit vollständiger Bezahlung das zeitlich unbeschränkte Recht, die für ihn entwickelte Software in seinem Betrieb zu nutzen – ` +
      `mit so vielen Mitarbeitern, wie er möchte. Die von ihm eingegebenen Daten gehören ihm; er kann sie jederzeit exportiert bekommen.`,
  });

  abschnitte.push({
    heading: '5. Verschwiegenheit',
    body:
      `${a.company_name} behandelt alle Daten und Informationen des Auftraggebers – Kunden-, Mitarbeiter-, Projekt- und Geschäftsdaten ebenso wie ` +
      `Kalkulationen und Preise – streng vertraulich. Sie werden in keinem Fall an Dritte weitergegeben, verkauft oder für andere Zwecke verwendet, ` +
      `sondern ausschließlich zur Erbringung der vereinbarten Leistung verarbeitet. Diese Verpflichtung gilt für alle Personen, die auf Seiten von ` +
      `${a.company_name} an der Software arbeiten, und auch über das Ende dieses Vertrags hinaus, zeitlich unbegrenzt. ` +
      `Umgekehrt behandelt der Auftraggeber Preise und Arbeitsweise von ${a.company_name} vertraulich.`,
  });

  if ((v.extra_terms || '').trim()) {
    abschnitte.push({ heading: '6. Besondere Vereinbarungen', body: v.extra_terms!.trim() });
  }

  abschnitte.push({
    heading: `${abschnitte.length + 1}. Schluss`,
    body:
      `Es gilt österreichisches Recht. Änderungen dieses Vertrags brauchen die Zustimmung beider Seiten in Textform. ` +
      `Die elektronische Unterschrift gilt als Unterschrift aller Vertragsparteien; jede Seite erhält den unterschriebenen Vertrag als PDF per E-Mail.`,
  });

  return {
    titel: 'Vertrag über die Entwicklung individueller Software',
    nummer: v.number || '',
    datum: datum(v.our_signed_at || new Date().toISOString()),
    anbieter: [
      a.company_name,
      a.street || '',
      [a.postal_code, a.city].filter(Boolean).join(' '),
      a.uid_number ? `UID ${a.uid_number}` : '',
      a.firmenbuch ? a.firmenbuch : '',
      `vertreten durch ${a.vertreter}`,
    ].filter(Boolean),
    partner: [
      v.party_company || '',
      v.party_name || '',
      v.party_street || '',
      [v.party_zip, v.party_city].filter(Boolean).join(' '),
      v.party_uid ? `UID ${v.party_uid}` : '',
    ].filter(Boolean),
    abschnitte,
  };
}

/** Kurzer Fingerabdruck des Textes – steht am Vertrag, damit klar ist, was unterschrieben wurde. */
export async function textHash(t: VertragsText): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(t));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Zufälliger Link-Schlüssel – 32 Byte, nicht zu erraten. */
export function neuerToken(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export const signLink = (token: string) => `${window.location.origin}/unterschreiben/${token}`;
