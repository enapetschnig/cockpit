/**
 * Laienverständliche Bewertung von Anzeigen-Kennzahlen ("gut / okay / schwach").
 *
 * Die Schwellen sind recherchierte, adversarial geprüfte Richtwerte für Meta-
 * Lead-Ads kleiner lokaler Handwerks-/Dienstleistungsbetriebe im DACH-Raum
 * (Quellen u.a. WordStream/LocaliQ 2024/2025, zweidigital, superads, Ostend
 * Digital, Meta Business Help). Bewusst fair/konservativ gewählt, damit ein
 * Nicht-Experte normale Marktwerte nicht fälschlich als schlecht sieht.
 */
export type RateLevel = "good" | "ok" | "weak" | "na";
export interface Rating {
  level: RateLevel;
  short: string; // kurze Bezeichnung für Punkt/Chip
  text: string; // ausführlicher Klartext (Detailansicht/Tooltip)
  color: string;
}

export const RATE_COLORS: Record<RateLevel, string> = {
  good: "#1f9d63",
  ok: "#d8932a",
  weak: "#c0392b",
  na: "#9a958c",
};

interface Level { short: string; text: string }
interface Spec {
  label: string; // Kennzahl-Name
  explain: string; // was die Kennzahl bedeutet
  higherIsBetter: boolean;
  good: number; // Grenze gut/okay
  ok: number; // Grenze okay/schwach
  goodL: Level;
  okL: Level;
  weakL: Level;
}

export const SPECS: Record<string, Spec> = {
  ctr: {
    label: "CTR gesamt",
    explain: "Klickrate über ALLE Klicks (Bild, Name, Button usw.): Von 100 Menschen, die die Anzeige sehen, klicken so viele irgendwo darauf.",
    higherIsBetter: true,
    good: 2,
    ok: 1,
    goodL: { short: "starke Klickrate", text: "Starke Klickrate – Ihre Anzeige spricht die Leute an." },
    okL: { short: "solide Klickrate", text: "Solide Klickrate im normalen Bereich. Mit einem frischeren Bild oder Text geht oft noch mehr." },
    weakL: { short: "niedrige Klickrate", text: "Schwache Klickrate – viele sehen die Anzeige, kaum jemand reagiert. Bild, Text oder Zielgruppe sollten überarbeitet werden." },
  },
  linkCtr: {
    label: "Link-CTR",
    explain: "Klickrate nur für echte Klicks auf den Link/Button (z.B. zum Formular). Aussagekräftiger als die Gesamt-CTR und liegt naturgemäß niedriger.",
    higherIsBetter: true,
    good: 1,
    ok: 0.5,
    goodL: { short: "starke Link-Klickrate", text: "Viele klicken wirklich auf den Link/Button – die Anzeige führt gut zum Ziel." },
    okL: { short: "solide Link-Klickrate", text: "Im normalen Bereich. Ein klarer Button-Text oder ein stärkeres Angebot kann noch mehr herausholen." },
    weakL: { short: "niedrige Link-Klickrate", text: "Wenige klicken tatsächlich auf den Link. Angebot, Button-Text oder Zielgruppe überprüfen." },
  },
  cpl: {
    label: "Kosten pro Anfrage",
    explain: "So viel kostet Sie im Schnitt eine ausgefüllte Kontaktanfrage über das Formular.",
    higherIsBetter: false,
    good: 20,
    ok: 45,
    goodL: { short: "günstige Anfragen", text: "Günstige Anfragen – Sie holen viele Kontakte für wenig Geld." },
    okL: { short: "normaler Preis", text: "Normaler Preis pro Anfrage für einen lokalen Betrieb – völlig im Rahmen, gerade bei größeren Aufträgen." },
    weakL: { short: "teure Anfragen", text: "Anfragen sind eher teuer. Bei hochpreisigen Aufträgen (z.B. PV, Dach, Heizung) kann sich das trotzdem lohnen – sonst Bild, Text oder Zielgruppe optimieren." },
  },
  cpc: {
    label: "Kosten pro Klick",
    explain: "So viel zahlen Sie im Schnitt, wenn jemand auf Ihre Anzeige klickt.",
    higherIsBetter: false,
    good: 0.5,
    ok: 1.5,
    goodL: { short: "günstige Klicks", text: "Günstige Klicks – Sie zahlen wenig pro Interessent." },
    okL: { short: "normaler Klickpreis", text: "Klickpreis im üblichen Rahmen – völlig normal für eine lokale Zielgruppe." },
    weakL: { short: "hoher Klickpreis", text: "Hoher Klickpreis für eine lokale Anzeige. Meist hilft eine ansprechendere Anzeige oder eine etwas breitere Zielgruppe. Solange die Anfragen unterm Strich günstig sind, ist das aber kein Drama." },
  },
  cpm: {
    label: "Kosten / 1.000 Einbl.",
    explain: "So viel kostet es, Ihre Anzeige 1.000 Mal anzeigen zu lassen.",
    higherIsBetter: false,
    good: 10,
    ok: 20,
    goodL: { short: "günstige Reichweite", text: "Günstige Einblendungen – Ihr Budget erreicht viele Menschen." },
    okL: { short: "normale Reichweite", text: "Normaler Preis für Einblendungen, typisch bei einer kleinen lokalen Zielgruppe in Österreich." },
    weakL: { short: "teure Reichweite", text: "Einblendungen sind teuer. Oft liegt es an einer sehr kleinen Zielgruppe, schwacher Anzeigenrelevanz oder einer teuren Saison (z.B. vor Weihnachten)." },
  },
  frequency: {
    label: "Frequenz",
    explain: "Wie oft im Schnitt eine einzelne Person Ihre Anzeige zu sehen bekommt.",
    higherIsBetter: false,
    good: 2.5,
    ok: 4,
    goodL: { short: "gesunde Häufigkeit", text: "Gesunde Häufigkeit – die Leute sehen die Anzeige oft genug, aber nicht zu oft." },
    okL: { short: "im Rahmen", text: "Noch im Rahmen. Bei einer kleinen Region steigt dieser Wert schneller – ruhig im Auge behalten." },
    weakL: { short: "Werbemüdigkeit", text: "Die gleichen Leute sehen die Anzeige zu oft (Werbemüdigkeit). Zeit für ein neues Bild/Motiv oder eine größere Region." },
  },
};

export function rate(metric: string, value: number | null | undefined): Rating {
  const spec = SPECS[metric];
  if (!spec || value == null || !Number.isFinite(value)) return { level: "na", short: "–", text: "", color: RATE_COLORS.na };
  let level: RateLevel;
  if (spec.higherIsBetter) level = value >= spec.good ? "good" : value >= spec.ok ? "ok" : "weak";
  else level = value <= spec.good ? "good" : value <= spec.ok ? "ok" : "weak";
  const l = level === "good" ? spec.goodL : level === "ok" ? spec.okL : spec.weakL;
  return { level, short: l.short, text: l.text, color: RATE_COLORS[level] };
}

// Gesamtbewertung einer Anzeige aus mehreren Signalen (CTR, Kosten/Lead, Frequenz)
export function overallRating(m: { ctr: number | null; cpl: number | null; frequency: number | null }): Rating {
  const signals = [rate("ctr", m.ctr), rate("cpl", m.cpl), rate("frequency", m.frequency)].filter((r) => r.level !== "na");
  if (!signals.length) return { level: "na", short: "noch keine Daten", text: "Sobald die Anzeige Daten gesammelt hat, erscheint hier eine Bewertung.", color: RATE_COLORS.na };
  const score = signals.reduce((a, r) => a + (r.level === "good" ? 2 : r.level === "ok" ? 1 : 0), 0) / (signals.length * 2);
  const level: RateLevel = score >= 0.66 ? "good" : score >= 0.34 ? "ok" : "weak";
  const short = level === "good" ? "läuft gut" : level === "ok" ? "läuft okay" : "Optimierung sinnvoll";
  return { level, short, text: "", color: RATE_COLORS[level] };
}

// Glossar fürs Dashboard: erklärt jede Kennzahl in einfacher Sprache.
export const GLOSSARY: { term: string; text: string }[] = [
  { term: "Ausgaben", text: "Wie viel Budget im gewählten Zeitraum für die Anzeigen ausgegeben wurde." },
  { term: "Leads (Anfragen)", text: "Wie viele Menschen das Kontaktformular ausgefüllt und abgeschickt haben." },
  { term: "Kosten / Lead", text: SPECS.cpl.explain },
  { term: "CTR gesamt", text: SPECS.ctr.explain },
  { term: "Link-CTR", text: SPECS.linkCtr.explain },
  { term: "Reichweite", text: "Wie viele verschiedene Personen die Anzeige mindestens einmal gesehen haben." },
  { term: "Impressionen", text: "Wie oft die Anzeige insgesamt eingeblendet wurde – eine Person kann mehrfach zählen." },
  { term: "CPC (Kosten / Klick)", text: SPECS.cpc.explain },
  { term: "CPM (Kosten / 1.000 Einbl.)", text: SPECS.cpm.explain },
  { term: "Frequenz", text: SPECS.frequency.explain },
];

// Konkrete Verbesserungs-Tipps: Klartext zu allen schwachen (und auffälligen) Kennzahlen.
export function adTips(m: { ctr: number | null; cpl: number | null; cpc: number | null; cpm: number | null; frequency: number | null }): { label: string; level: RateLevel; text: string }[] {
  const order = ["ctr", "cpl", "frequency", "cpc", "cpm"] as const;
  const out: { label: string; level: RateLevel; text: string }[] = [];
  for (const key of order) {
    const r = rate(key, m[key]);
    if (r.level === "weak") out.push({ label: SPECS[key].label, level: r.level, text: r.text });
  }
  return out;
}
