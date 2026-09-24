/**
 * Telegram-Meldungen des Änderungswunsch-Roboters (läuft am PC).
 *
 * Der Roboter schickt nur die Auftrags-ID. Text und Empfänger stellt das CRM
 * selbst aus der Datenbank zusammen – so braucht der PC den Telegram-Schlüssel
 * nicht (der liegt als „sensibel“ nur bei Vercel), und niemand kann über diesen
 * Weg beliebige Texte verschicken. Jede Stufe wird genau einmal gemeldet
 * (Spalte `gemeldet`).
 */
import { createClient } from '@supabase/supabase-js';
import { appLabel, sendTelegram } from './_apps.js';

interface Req { method?: string; body?: unknown }
interface Res { status(c: number): Res; json(b: unknown): void }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINK = 'https://app.epowergmbh.at/wuensche#a-';
const kurz = (t: string | null, n: number) => {
  const s = (t || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

export default async function handler(req: Req, res: Res): Promise<void> {
  if (req.method !== 'POST') return res.status(405).json({ error: 'nur POST' });
  let id = '';
  try {
    const b = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as { id?: string };
    id = String(b.id ?? '');
  } catch { /* unten abgelehnt */ }
  if (!UUID.test(id)) return res.status(400).json({ error: 'id fehlt' });

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return res.status(500).json({ error: 'Supabase-Zugang fehlt' });
  const sb = createClient(url, key, { auth: { persistSession: false }, db: { schema: 'crm' } });

  const { data: a } = await sb.from('roboter_auftraege')
    .select('id, app_key, wunsch_ids, status, vorschau_url, fehler, protokoll, gemeldet, aktualisiert').eq('id', id).maybeSingle();
  if (!a) return res.status(404).json({ error: 'unbekannt' });
  // Nur frische Stände, jede Stufe nur einmal
  if (a.gemeldet === a.status) return res.status(200).json({ ok: true, schon: true });
  if (Date.now() - new Date(a.aktualisiert).getTime() > 15 * 60_000) return res.status(200).json({ ok: true, alt: true });

  const wer = appLabel(a.app_key);
  const n = (a.wunsch_ids || []).length;
  const link = LINK + a.id;
  const text: Record<string, string> = {
    vorschlag: `🤖 ${wer}: Vorschlag für ${n === 1 ? '1 Wunsch' : `${n} Wünsche`} ist fertig – bitte ansehen:\n${link}`,
    vorschau: `👀 ${wer}: Umsetzung fertig – bitte ansehen.${a.vorschau_url ? `\nVorschau: ${a.vorschau_url}` : ''}\nLive schalten: ${link}`,
    erledigt: `✅ ${wer}: live. Der Kunde sieht „umgesetzt“ mit deiner Antwort.${a.protokoll ? `\n${kurz(a.protokoll, 300)}` : ''}`,
    wartet: `⏸ ${wer}: Der Roboter wartet auf dich – ${kurz(a.fehler, 140)}\n${link}`,
    fehler: `⚠️ ${wer}: Der Roboter kam nicht weiter – ${kurz(a.fehler, 160)}\n${link}`,
  };
  const nachricht = text[a.status];
  if (!nachricht) return res.status(200).json({ ok: true, nichts: true });

  await sendTelegram(nachricht);
  await sb.from('roboter_auftraege').update({ gemeldet: a.status }).eq('id', a.id);
  return res.status(200).json({ ok: true });
}
