/**
 * Eingang für Änderungswünsche aus den Handwerker-Apps.
 * Öffentlich erreichbar unter https://app.epowergmbh.at/api/wuensche-eingang –
 * abgesichert allein über das gemeinsame Geheimnis im Header `x-cockpit-secret`.
 *
 * Die App ist die Wahrheit: jeder Aufruf überschreibt den Datensatz komplett.
 * Nur `gesehen_am` und `customer_id` bleiben unangetastet, das sind eigene Vermerke.
 */
import { createClient } from '@supabase/supabase-js';
import { appLabel, secretGleich, sendTelegram } from './_apps.js';

// Vercels Node-Runtime übergibt Node-Objekte (kein Web-Request).
interface Req { method?: string; headers: Record<string, string | string[] | undefined>; body?: unknown }
interface Res { status(c: number): Res; json(b: unknown): void }

interface Payload {
  id?: string; art?: string; status?: string; text?: string;
  antwort?: string | null; seite?: string | null;
  bild_pfad?: string | null; audio_pfad?: string | null; melder?: string | null;
  erstellt_am?: string; aktualisiert_am?: string;
}

const kopf = (r: Req, name: string): string => {
  const v = r.headers[name];
  return (Array.isArray(v) ? v[0] : v) ?? '';
};
const str = (v: unknown): string | null => {
  const s = (v ?? '').toString().trim();
  return s ? s : null;
};
const datum = (v: unknown): string => {
  const d = new Date((v ?? '').toString());
  return (Number.isNaN(d.getTime()) ? new Date() : d).toISOString();
};

const ART_LABEL: Record<string, string> = { wunsch: 'Wunsch', fehler: 'Fehler', frage: 'Frage' };

export default async function handler(req: Req, res: Res): Promise<void> {
  if (req.method !== 'POST') return res.status(405).json({ error: 'nur POST' });

  const secret = process.env.FEEDBACK_SHARED_SECRET;
  if (!secret || !secretGleich(kopf(req, 'x-cockpit-secret'), secret)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const appKey = kopf(req, 'x-app-key').trim();
  if (!appKey) return res.status(400).json({ error: 'x-app-key fehlt' });

  // Vercel parst JSON-Bodies selbst; als Absicherung auch Strings annehmen.
  let b: Payload = {};
  try {
    b = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Payload;
  } catch { return res.status(400).json({ error: 'Body ist kein gültiges JSON' }); }

  const id = str(b.id);
  const text = str(b.text);
  if (!id || !text) return res.status(400).json({ error: 'id und text nötig' });

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return res.status(500).json({ error: 'Supabase-Zugang fehlt' });
  const sb = createClient(url, key, { auth: { persistSession: false }, db: { schema: 'crm' } });

  const felder = {
    app_key: appKey,
    art: str(b.art) ?? 'wunsch',
    status: str(b.status) ?? 'neu',
    text,
    antwort: str(b.antwort),
    seite: str(b.seite),
    melder: str(b.melder),
    bild_pfad: str(b.bild_pfad),
    audio_pfad: str(b.audio_pfad),
    erstellt_am: datum(b.erstellt_am),
    aktualisiert: datum(b.aktualisiert_am ?? b.erstellt_am),
  };

  const { data: vorhanden } = await sb.from('app_wuensche')
    .select('id, status, antwort').eq('id', id).maybeSingle();

  if (vorhanden) {
    // Update – customer_id bleibt unangetastet.
    //
    // Ausnahme bei `gesehen_am`: Wird die Meldung in der App weiterbearbeitet
    // (Status geändert oder Antwort geschrieben), soll sie hier WIEDER
    // auftauchen – sonst bekäme man nie mit, dass ein Wunsch erledigt wurde.
    // Reine Textnachträge (Sprach-Abschrift) lösen das nicht aus.
    const bearbeitet = felder.status !== vorhanden.status
      || (felder.antwort ?? '') !== (vorhanden.antwort ?? '');
    const { error } = await sb.from('app_wuensche')
      .update(bearbeitet ? { ...felder, gesehen_am: null } : felder).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
  } else {
    // Erster Eingang: Kunde einmalig über den app_key zuordnen.
    const { data: kunde } = await sb.from('customers').select('id').eq('app_key', appKey).maybeSingle();
    const { error } = await sb.from('app_wuensche').insert({ id, ...felder, customer_id: kunde?.id ?? null });
    if (error) return res.status(500).json({ error: error.message });

    // Push nur beim erstmaligen Eingang mit Status "neu" – Updates pingen nicht.
    // `x-kein-ping: 1` unterdrückt ihn zusätzlich: beim Nachtragen der
    // Altmeldungen einer frisch angebundenen App will niemand 20 Telegrams.
    if (felder.status === 'neu' && kopf(req, 'x-kein-ping') !== '1') {
      const anfang = text.length > 160 ? text.slice(0, 160) + ' …' : text;
      await sendTelegram(`🛠 ${appLabel(appKey)}: ${ART_LABEL[felder.art] ?? felder.art} — ${anfang}`);
    }
  }

  // Der Trigger wertet die Antwort nicht aus – immer 200.
  return res.status(200).json({ ok: true });
}
