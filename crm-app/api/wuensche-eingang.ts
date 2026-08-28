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

interface Payload {
  id?: string; art?: string; status?: string; text?: string;
  antwort?: string | null; seite?: string | null;
  bild_pfad?: string | null; audio_pfad?: string | null; melder?: string | null;
  erstellt_am?: string; aktualisiert_am?: string;
}

const str = (v: unknown): string | null => {
  const s = (v ?? '').toString().trim();
  return s ? s : null;
};
const datum = (v: unknown): string => {
  const d = new Date((v ?? '').toString());
  return (Number.isNaN(d.getTime()) ? new Date() : d).toISOString();
};

const ART_LABEL: Record<string, string> = { wunsch: 'Wunsch', fehler: 'Fehler', frage: 'Frage' };

export default async function handler(req: Request): Promise<Response> {
  const ok = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  if (req.method !== 'POST') return ok({ error: 'nur POST' }, 405);

  const secret = process.env.FEEDBACK_SHARED_SECRET;
  if (!secret || !secretGleich(req.headers.get('x-cockpit-secret') ?? '', secret)) {
    return ok({ error: 'unauthorized' }, 401);
  }
  const appKey = (req.headers.get('x-app-key') ?? '').trim();
  if (!appKey) return ok({ error: 'x-app-key fehlt' }, 400);

  const b = (await req.json().catch(() => ({}))) as Payload;
  const id = str(b.id);
  const text = str(b.text);
  if (!id || !text) return ok({ error: 'id und text nötig' }, 400);

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return ok({ error: 'Supabase-Zugang fehlt' }, 500);
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

  const { data: vorhanden } = await sb.from('app_wuensche').select('id').eq('id', id).maybeSingle();

  if (vorhanden) {
    // Update – customer_id und gesehen_am bleiben, wie sie sind.
    const { error } = await sb.from('app_wuensche').update(felder).eq('id', id);
    if (error) return ok({ error: error.message }, 500);
  } else {
    // Erster Eingang: Kunde einmalig über den app_key zuordnen.
    const { data: kunde } = await sb.from('customers').select('id').eq('app_key', appKey).maybeSingle();
    const { error } = await sb.from('app_wuensche').insert({ id, ...felder, customer_id: kunde?.id ?? null });
    if (error) return ok({ error: error.message }, 500);

    // Push nur beim erstmaligen Eingang mit Status "neu" – Updates pingen nicht.
    if (felder.status === 'neu') {
      const anfang = text.length > 160 ? text.slice(0, 160) + ' …' : text;
      await sendTelegram(`🛠 ${appLabel(appKey)}: ${ART_LABEL[felder.art] ?? felder.art} — ${anfang}`);
    }
  }

  // Der Trigger wertet die Antwort nicht aus – immer 200.
  return ok({ ok: true });
}
