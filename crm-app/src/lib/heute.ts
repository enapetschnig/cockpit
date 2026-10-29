/**
 * „Heute" – was nur Christoph selbst tun kann. Hier liegt die reine
 * Aufbereitung (ohne Datenbank), damit die Regeln an einer Stelle stehen:
 * wann ein Roboter-Auftrag auf ihn wartet, welcher Wunsch noch bei keinem
 * Auftrag ist, welches Angebot nachgefasst werden sollte usw.
 */

/** Diese Stände kommen ohne Christoph nicht weiter. */
export const WARTET_AUF_DICH = ['vorschlag', 'wartet', 'fehler', 'db_freigabe', 'vorschau'];
/** Älter als das → der Roboter steht (er meldet sich jede Minute). */
export const PULS_MAX_MIN = 5;
/** Ab so vielen Tagen ohne Antwort ein Angebot nachfassen. */
export const ANGEBOT_NACHFASSEN_TAGE = 7;
/** Besprechungen: offene „Ich:"-Punkte so lange zeigen. */
export const BESPRECHUNG_TAGE = 14;

export interface HeuteAuftrag {
  id: string; app_key: string; wunsch_ids: string[]; status: string;
  fehler: string | null; vorschlag: string | null; geprueft: string | null;
  vor_kunde: string | null; vor_kunde_ok_am: string | null; datenbank: boolean;
  aktualisiert: string;
}
export interface HeuteWunsch {
  id: string; app_key: string; art: string; text: string; melder: string | null; erstellt_am: string;
}
export interface HeuteBesprechung {
  id: string; titel: string | null; beginn: string | null; status: string;
  handlungsschritte: { text: string; erledigt?: boolean }[] | null;
}

/** Datum als YYYY-MM-DD in der Ortszeit des Browsers (nicht UTC). */
export const tagVon = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Ganze Tage zwischen zwei YYYY-MM-DD (b − a). */
export const tageZwischen = (a: string, b: string) =>
  Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400_000);

/** Erster Satz bzw. erste Zeile, gekürzt – für „eine Zeile je Aufgabe". */
export function einSatz(text: string | null | undefined, max = 170): string {
  const t = (text ?? '').replace(/^(?:\s|🧾|❓|⚠️|✅|•|-)+/u, '').trim();
  const zeile = t.split('\n').map((z) => z.trim()).find(Boolean) ?? '';
  // Satzende nur nach mindestens 25 Zeichen – „z. B." o. ä. soll nicht abschneiden.
  const m = zeile.slice(25).match(/[.!?](\s|$)/);
  const satz = m && m.index !== undefined ? zeile.slice(0, 25 + m.index + 1) : zeile;
  return satz.length > max ? satz.slice(0, max - 1).trimEnd() + '…' : satz;
}

/** Was der Roboter von Christoph will – ein Satz. */
export function roboterSatz(a: HeuteAuftrag, wunschText?: string): { was: string; satz: string } {
  switch (a.status) {
    case 'vorschlag':
      return a.geprueft
        ? { was: 'Fertig und geprüft – „Passt“?', satz: einSatz(a.vor_kunde || wunschText || a.vorschlag) }
        : { was: 'Vorschlag freigeben', satz: einSatz(wunschText || a.vorschlag) };
    case 'db_freigabe':
      return { was: 'Datenbank-Änderung braucht dein OK', satz: einSatz(wunschText || a.vorschlag) };
    case 'vorschau':
      return { was: 'Vorschau ansehen und live schalten', satz: einSatz(wunschText || a.vorschlag) };
    case 'fehler':
      return { was: 'Ging schief', satz: einSatz(a.fehler || wunschText) };
    default: // wartet
      if (a.vor_kunde && !a.vor_kunde_ok_am) return { was: 'Vor der Antwort an den Kunden', satz: einSatz(a.vor_kunde) };
      return { was: 'Frage an dich', satz: einSatz(a.fehler || wunschText) };
  }
}

/** Läuft der Roboter? Älter als PULS_MAX_MIN = steht. */
export function roboterPuls(zuletzt: string | null | undefined, jetzt = Date.now()) {
  if (!zuletzt) return { laeuft: false, minuten: null as number | null };
  const minuten = Math.max(0, Math.round((jetzt - new Date(zuletzt).getTime()) / 60_000));
  return { laeuft: minuten <= PULS_MAX_MIN, minuten };
}

/** Offene Wünsche, die noch in keinem (nicht verworfenen/abgelehnten) Roboter-Auftrag stecken. */
export function freieWuensche(wuensche: HeuteWunsch[], auftraege: Pick<HeuteAuftrag, 'wunsch_ids' | 'status'>[]) {
  const vergeben = new Set(auftraege
    .filter((a) => a.status !== 'verworfen' && a.status !== 'abgelehnt')
    .flatMap((a) => a.wunsch_ids));
  return wuensche.filter((w) => !vergeben.has(w.id));
}

/** Offene „Ich:"-Punkte einer Besprechung. */
export const meinePunkte = (b: HeuteBesprechung) =>
  (b.handlungsschritte ?? []).filter((s) => !s.erledigt && /^\s*ich\s*:/i.test(s.text))
    .map((s) => s.text.replace(/^\s*ich\s*:\s*/i, ''));

/** Besprechungen, bei denen Christoph etwas tun muss: zuordnen oder frische eigene Punkte. */
export function besprechungenFuerDich(liste: HeuteBesprechung[], jetzt = Date.now()) {
  const grenze = jetzt - BESPRECHUNG_TAGE * 86400_000;
  return liste.filter((b) => b.status !== 'ignoriert' && (
    b.status === 'unklar' ||
    (!!b.beginn && new Date(b.beginn).getTime() >= grenze && meinePunkte(b).length > 0)));
}

/** „10-22 Besprechung: Verrechnung …" → „Verrechnung …" (Datum steht ohnehin daneben). */
export const besprechungTitel = (t: string | null) =>
  (t ?? 'Besprechung').replace(/^\d{2}-\d{2}\s+/, '').replace(/^(Besprechung|Meeting|Gespräch|Notiz)[^:]*:\s*/i, '') || 'Besprechung';
