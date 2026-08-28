/**
 * Datei-Proxy für Screenshots und Sprachnachrichten.
 *
 * Die Dateien bleiben im privaten Bucket der jeweiligen App. Wir holen bei der
 * App-eigenen Edge Function `wunsch-datei` eine signierte URL (1 h gültig) und
 * leiten dorthin weiter – abgesichert über dasselbe gemeinsame Geheimnis.
 *
 * Zugriff nur mit gültigem Supabase-Login. Das Token kommt als Query-Parameter,
 * weil <img> und <audio> keine eigenen Header mitschicken können.
 */
import { createClient } from '@supabase/supabase-js';
import { appInfo } from './_apps.js';

interface Req { method?: string; headers: Record<string, string | string[] | undefined>; query: Record<string, string | string[] | undefined> }
interface Res { status(c: number): Res; json(b: unknown): void; setHeader(n: string, v: string): void; end(): void }

const eins = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function handler(req: Req, res: Res): Promise<void> {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const secret = process.env.FEEDBACK_SHARED_SECRET;
  if (!url || !anon || !key || !secret) return res.status(500).json({ error: 'Server nicht vollständig konfiguriert' });

  const token = eins(req.query.token) || eins(req.headers.authorization).replace(/^Bearer /, '');
  if (!token) return res.status(401).json({ error: 'nicht angemeldet' });
  const { data: userData } = await createClient(url, anon, { auth: { persistSession: false } }).auth.getUser(token);
  if (!userData?.user) return res.status(401).json({ error: 'nicht angemeldet' });

  const id = eins(req.query.id);
  const art = eins(req.query.art) === 'audio' ? 'audio' : 'bild';
  if (!id) return res.status(400).json({ error: 'id fehlt' });

  const sb = createClient(url, key, { auth: { persistSession: false }, db: { schema: 'crm' } });
  const { data: w } = await sb.from('app_wuensche').select('app_key, bild_pfad, audio_pfad').eq('id', id).maybeSingle();
  if (!w) return res.status(404).json({ error: 'nicht gefunden' });

  const pfad = art === 'audio' ? w.audio_pfad : w.bild_pfad;
  if (!pfad) return res.status(404).json({ error: 'keine Datei hinterlegt' });

  const app = appInfo(w.app_key);
  if (!app) return res.status(400).json({ error: `App "${w.app_key}" ist nicht hinterlegt` });

  try {
    const antwort = await fetch(`https://${app.projectRef}.supabase.co/functions/v1/wunsch-datei`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cockpit-secret': secret },
      body: JSON.stringify({ pfad }),
    });
    if (!antwort.ok) return res.status(502).json({ error: `App antwortet ${antwort.status}` });
    const { url: signiert } = (await antwort.json()) as { url?: string };
    if (!signiert) return res.status(502).json({ error: 'App lieferte keine URL' });
    res.setHeader('Location', signiert);
    res.setHeader('Cache-Control', 'private, max-age=0, no-store');
    res.status(307).end();
  } catch (e) {
    return res.status(502).json({ error: e instanceof Error ? e.message : 'App nicht erreichbar' });
  }
}
