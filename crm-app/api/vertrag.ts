/**
 * Öffentliche Unterschriftsseite – der Kunde kommt nur über seinen Link.
 *
 *   GET  /api/vertrag?token=…   → Vertragstext + unsere Unterschrift
 *   POST /api/vertrag           → { token, name, signature } – Kunde unterschreibt
 *
 * Der Link-Schlüssel ist 32 Byte Zufall; wer ihn hat, darf genau diesen einen
 * Vertrag sehen und einmal unterschreiben. Sonst gibt es hier nichts.
 */
import { createClient } from '@supabase/supabase-js';
import { sendTelegram } from './_apps.js';

interface Req { method?: string; headers: Record<string, string | string[] | undefined>; body?: unknown; query?: Record<string, string | string[] | undefined> }
interface Res { status(c: number): Res; json(b: unknown): void; setHeader(k: string, v: string): void }

const kopf = (r: Req, name: string): string => {
  const v = r.headers[name];
  return (Array.isArray(v) ? v[0] : v) ?? '';
};

const TOKEN_RE = /^[0-9a-f]{64}$/;
const OEFFENTLICH = 'id,number,status,party_company,party_name,party_email,text_frozen,text_hash,our_signature,our_signed_name,our_signed_at,customer_signature,customer_signed_name,customer_signed_at,token_expires_at';

export default async function handler(req: Req, res: Res): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return res.status(500).json({ error: 'Supabase-Zugang fehlt' });
  const db = createClient(url, key, { db: { schema: 'crm' }, auth: { persistSession: false } });

  if (req.method === 'GET') {
    const q = req.query?.token;
    const token = (Array.isArray(q) ? q[0] : q) ?? '';
    if (!TOKEN_RE.test(token)) return res.status(400).json({ error: 'Ungültiger Link' });
    const { data: v } = await db.from('contracts').select(OEFFENTLICH).eq('token', token).maybeSingle();
    if (!v || !['signed_by_us', 'signed'].includes(v.status)) return res.status(404).json({ error: 'Dieser Link ist nicht (mehr) gültig.' });
    if (v.status === 'signed_by_us' && v.token_expires_at && new Date(v.token_expires_at) < new Date()) {
      return res.status(410).json({ error: 'Dieser Link ist abgelaufen. Bitte melden Sie sich bei uns, wir senden Ihnen einen neuen.' });
    }
    return res.status(200).json({ vertrag: v });
  }

  if (req.method === 'POST') {
    let b: { token?: string; name?: string; signature?: string } = {};
    try { b = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as typeof b; }
    catch { return res.status(400).json({ error: 'Body ist kein gültiges JSON' }); }

    const token = (b.token ?? '').toString();
    const name = (b.name ?? '').toString().trim().slice(0, 120);
    const sig = (b.signature ?? '').toString();
    if (!TOKEN_RE.test(token)) return res.status(400).json({ error: 'Ungültiger Link' });
    if (!name) return res.status(400).json({ error: 'Bitte Namen angeben' });
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sig) || sig.length < 500) return res.status(400).json({ error: 'Unterschrift fehlt' });
    if (sig.length > 400_000) return res.status(413).json({ error: 'Unterschrift zu groß' });

    const { data: v } = await db.from('contracts').select('id,number,status,party_company,party_name,token_expires_at').eq('token', token).maybeSingle();
    if (!v) return res.status(404).json({ error: 'Dieser Link ist nicht (mehr) gültig.' });
    if (v.status === 'signed') return res.status(409).json({ error: 'Dieser Vertrag ist bereits unterschrieben.' });
    if (v.status !== 'signed_by_us') return res.status(404).json({ error: 'Dieser Link ist nicht (mehr) gültig.' });
    if (v.token_expires_at && new Date(v.token_expires_at) < new Date()) return res.status(410).json({ error: 'Dieser Link ist abgelaufen.' });

    const ip = (kopf(req, 'x-forwarded-for').split(',')[0] || kopf(req, 'x-real-ip') || '').trim().slice(0, 64);
    const ua = kopf(req, 'user-agent').slice(0, 300);
    const jetzt = new Date().toISOString();
    // Nur unterschreiben, was noch auf die Unterschrift wartet – zwei gleichzeitige
    // Klicks können so nie zwei verschiedene Unterschriften ablegen.
    const { data: upd, error } = await db.from('contracts').update({
      customer_signature: sig, customer_signed_name: name, customer_signed_at: jetzt,
      customer_ip: ip, customer_ua: ua, status: 'signed', updated_at: jetzt,
    }).eq('id', v.id).eq('status', 'signed_by_us').select('id').maybeSingle();
    if (error || !upd) return res.status(409).json({ error: 'Unterschrift konnte nicht gespeichert werden.' });

    await sendTelegram(`✍️ Vertrag ${v.number || ''} unterschrieben: ${v.party_company || v.party_name || ''} (${name})`);
    return res.status(200).json({ ok: true, signed_at: jetzt });
  }

  return res.status(405).json({ error: 'nur GET oder POST' });
}
