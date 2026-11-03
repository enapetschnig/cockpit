/**
 * Claude-Sitzungen je App am Handy (03.11.2026). Das Cockpit schreibt Nachrichten in crm.cockpit_nachrichten;
 * der Roboter auf der Devbox lässt Claude in seiner Arbeitskopie der App arbeiten und spiegelt den Verlauf zurück.
 * Dieselben Verläufe öffnet Christoph in VS Code (Projektordner → Claude → Verläufe). Ablauf: docs/14-handy-sitzungen.md
 */
import { supabase } from '@/integrations/supabase/client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type Herkunft = 'cockpit' | 'vscode' | 'roboter';
export type SitzungStatus = 'bereit' | 'wartet' | 'laeuft' | 'fehler';

export interface Sitzung {
  id: string;
  app_key: string;
  titel: string;
  herkunft: Herkunft;
  claude_sitzung: string | null;
  status: SitzungStatus;
  hinweis: string | null;
  zuletzt: string;
  erstellt_am: string;
}

export interface Nachricht {
  id: number;
  rolle: 'du' | 'claude' | 'werkzeug' | 'info';
  text: string;
  status: 'neu' | 'in_arbeit' | 'erledigt' | 'fehler' | null;
  erstellt_am: string;
}

/** Lebenszeichen des Roboters samt Pausen und dem, woran er gerade arbeitet (crm.roboter_puls). */
export interface Puls {
  zuletzt: string | null;
  meldung: string | null;
  pausen: Record<string, string>;
  laeuft: { app: string; was: string; cockpit?: boolean }[];
}

export const SITZUNG_FELDER = 'id,app_key,titel,herkunft,claude_sitzung,status,hinweis,zuletzt,erstellt_am';

export const HERKUNFT: Record<Herkunft, { label: string; cls: string }> = {
  cockpit: { label: 'Handy', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  vscode: { label: 'VS Code', cls: 'bg-muted text-muted-foreground border-border' },
  roboter: { label: 'Roboter', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
};

/** „vor 5 Min“, „vor 3 Std“, „gestern“ … */
export function wann(iso: string | null | undefined, jetzt = Date.now()): string {
  if (!iso) return '';
  const d = new Date(iso);
  const s = (jetzt - d.getTime()) / 1000;
  if (s < 60) return 'gerade eben';
  if (s < 3600) return `vor ${Math.floor(s / 60)} Min`;
  if (s < 86400) return `vor ${Math.floor(s / 3600)} Std`;
  if (s < 2 * 86400) return 'gestern';
  if (s < 7 * 86400) return `vor ${Math.floor(s / 86400)} Tg`;
  return d.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit' });
}

/** Bis wann eine App pausiert ist (eigene Pause oder „alle“) – null = läuft. */
export function pausiertBis(pausen: Record<string, string> | null | undefined, key: string, jetzt = Date.now()): string | null {
  const bis = [pausen?.[key], pausen?.alle].filter((x): x is string => !!x && new Date(x).getTime() > jetzt);
  return bis.sort().at(-1) ?? null;
}

export const uhrzeit = (iso: string) => new Date(iso).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' });

/** Titel einer neuen Sitzung aus der ersten Nachricht. */
export function titelAus(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 60 ? `${t.slice(0, 59)}…` : t || 'Neue Sitzung';
}

/** Werkzeugschritte am Stück zu einem Block zusammenfassen – sonst sieht man am Handy vor lauter Schritten die Antwort nicht. */
export type Block =
  | { art: 'nachricht'; n: Nachricht }
  | { art: 'schritte'; key: number; zeilen: Nachricht[] };
export function bloecke(liste: Nachricht[]): Block[] {
  const raus: Block[] = [];
  for (const n of liste) {
    const letzter = raus.at(-1);
    if (n.rolle === 'werkzeug') {
      if (letzter?.art === 'schritte') letzter.zeilen.push(n);
      else raus.push({ art: 'schritte', key: n.id, zeilen: [n] });
    } else raus.push({ art: 'nachricht', n });
  }
  return raus;
}

/** Neue Sitzung mit erster Nachricht – der Roboter holt sie in wenigen Sekunden ab. */
export async function sitzungStarten(appKey: string, text: string): Promise<string> {
  const { data, error } = await db.from('cockpit_sitzungen').insert({ app_key: appKey, titel: titelAus(text) }).select('id').single();
  if (error) throw error;
  await nachrichtSenden(data.id, text);
  return data.id as string;
}

export async function nachrichtSenden(sitzungId: string, text: string) {
  const { error } = await db.from('cockpit_nachrichten').insert({ sitzung_id: sitzungId, rolle: 'du', text, status: 'neu' });
  if (error) throw error;
  await db.from('cockpit_sitzungen').update({ zuletzt: new Date().toISOString() }).eq('id', sitzungId);
}

/** Pause/Weiter an den Roboter (führt er binnen Sekunden aus, wie „node roboter.mjs --pause …“). */
export async function roboterBefehl(befehl: 'pause' | 'weiter', appKey: string, minuten?: number) {
  const { error } = await db.from('roboter_befehle').insert({ befehl, app_key: appKey, minuten: minuten ?? null });
  if (error) throw error;
}
