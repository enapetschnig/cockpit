/**
 * Datei-Proxy für Screenshots und Sprachnachrichten.
 *
 * Die Dateien bleiben im privaten Bucket der jeweiligen App. Wir holen bei der
 * App-eigenen Edge Function `wunsch-datei` eine signierte URL (1 h gültig) und
 * leiten dorthin weiter – abgesichert über dasselbe gemeinsame Geheimnis.
 *
 * Zugriff nur mit gültigem Supabase-Login (Bearer-Token der CRM-Sitzung).
 */
import { createClient } from '@supabase/supabase-js';
import { appInfo } from './_apps.js';

export default async function handler(req: Request): Promise<Response> {
  const fehler = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const secret = process.env.FEEDBACK_SHARED_SECRET;
  if (!url || !key || !secret) return fehler({ error: 'Server nicht vollständig konfiguriert' }, 500);

  // Anmeldung prüfen: Token kommt als ?token= (damit auch <img> und <audio> es mitschicken können)
  const u = new URL(req.url);
  const token = u.searchParams.get('token') ?? (req.headers.get('authorization') ?? '').replace(/^Bearer /, '');
  if (!token || !anon) return fehler({ error: 'nicht angemeldet' }, 401);
  const { data: userData } = await createClient(url, anon, { auth: { persistSession: false } }).auth.getUser(token);
  if (!userData?.user) return fehler({ error: 'nicht angemeldet' }, 401);

  const id = u.searchParams.get('id');
  const art = u.searchParams.get('art') === 'audio' ? 'audio' : 'bild';
  if (!id) return fehler({ error: 'id fehlt' }, 400);

  const sb = createClient(url, key, { auth: { persistSession: false }, db: { schema: 'crm' } });
  const { data: w } = await sb.from('app_wuensche').select('app_key, bild_pfad, audio_pfad').eq('id', id).maybeSingle();
  if (!w) return fehler({ error: 'nicht gefunden' }, 404);

  const pfad = art === 'audio' ? w.audio_pfad : w.bild_pfad;
  if (!pfad) return fehler({ error: 'keine Datei hinterlegt' }, 404);

  const app = appInfo(w.app_key);
  if (!app) return fehler({ error: `App "${w.app_key}" ist nicht hinterlegt` }, 400);

  try {
    const res = await fetch(`https://${app.projectRef}.supabase.co/functions/v1/wunsch-datei`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cockpit-secret': secret },
      body: JSON.stringify({ pfad }),
    });
    if (!res.ok) return fehler({ error: `App antwortet ${res.status}` }, 502);
    const { url: signiert } = (await res.json()) as { url?: string };
    if (!signiert) return fehler({ error: 'App lieferte keine URL' }, 502);
    return Response.redirect(signiert, 307);
  } catch (e) {
    return fehler({ error: e instanceof Error ? e.message : 'App nicht erreichbar' }, 502);
  }
}
