/**
 * Laienverständliche Bewertung von Anzeigen-Kennzahlen ("gut / okay / schwach").
 * Die Schwellen (SPECS) sind Richtwerte für Meta-Lead-Ads kleiner lokaler Betriebe
 * und werden über die Benchmark-Recherche verfeinert.
 */
export type RateLevel = "good" | "ok" | "weak" | "na";
export interface Rating {
  level: RateLevel;
  label: string;
  color: string;
}

export const RATE_COLORS: Record<RateLevel, string> = {
  good: "#1f9d63",
  ok: "#d8932a",
  weak: "#c0392b",
  na: "#9a958c",
};

interface Spec {
  higherIsBetter: boolean;
  good: number; // Grenze gut/okay
  ok: number; // Grenze okay/schwach
  goodText: string;
  okText: string;
  weakText: string;
}

// Richtwerte (provisorisch – werden per Recherche aktualisiert)
export const SPECS: Record<string, Spec> = {
  ctr: { higherIsBetter: true, good: 2.0, ok: 1.0, goodText: "starke Klickrate", okText: "solide Klickrate", weakText: "niedrige Klickrate" },
  cpl: { higherIsBetter: false, good: 20, ok: 50, goodText: "günstige Leads", okText: "okayer Lead-Preis", weakText: "teure Leads" },
  cpc: { higherIsBetter: false, good: 0.5, ok: 1.5, goodText: "günstige Klicks", okText: "okayer Klickpreis", weakText: "teure Klicks" },
  cpm: { higherIsBetter: false, good: 8, ok: 20, goodText: "günstige Reichweite", okText: "okaye Reichweite", weakText: "teure Reichweite" },
  frequency: { higherIsBetter: false, good: 2.5, ok: 4, goodText: "frische Auslieferung", okText: "leichte Wiederholung", weakText: "Anzeige ermüdet" },
};

export function rate(metric: string, value: number | null | undefined): Rating {
  const spec = SPECS[metric];
  if (!spec || value == null || !Number.isFinite(value)) return { level: "na", label: "–", color: RATE_COLORS.na };
  let level: RateLevel;
  if (spec.higherIsBetter) level = value >= spec.good ? "good" : value >= spec.ok ? "ok" : "weak";
  else level = value <= spec.good ? "good" : value <= spec.ok ? "ok" : "weak";
  const label = level === "good" ? spec.goodText : level === "ok" ? spec.okText : spec.weakText;
  return { level, label, color: RATE_COLORS[level] };
}

// Gesamtbewertung einer Anzeige aus mehreren Signalen (CTR, Kosten/Lead, Frequenz)
export function overallRating(m: { ctr: number | null; cpl: number | null; frequency: number | null }): Rating {
  const signals = [rate("ctr", m.ctr), rate("cpl", m.cpl), rate("frequency", m.frequency)].filter((r) => r.level !== "na");
  if (!signals.length) return { level: "na", label: "noch keine Daten", color: RATE_COLORS.na };
  const score = signals.reduce((a, r) => a + (r.level === "good" ? 2 : r.level === "ok" ? 1 : 0), 0) / (signals.length * 2);
  const level: RateLevel = score >= 0.66 ? "good" : score >= 0.34 ? "ok" : "weak";
  const label = level === "good" ? "läuft gut" : level === "ok" ? "läuft okay" : "Optimierung sinnvoll";
  return { level, label, color: RATE_COLORS[level] };
}
