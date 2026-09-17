/**
 * Öffentliche Unterschriftsseite – der Kunde kommt nur über seinen Link.
 *
 *   GET  /api/vertrag?token=…   → Vertragstext, unsere Unterschrift, Unterzeichner
 *   POST /api/vertrag           → { token, slot, name, signature } – ein Unterzeichner unterschreibt
 *
 * Mehrere Unterzeichner (zwei Geschäftsführer …) unterschreiben jeder für
 * sich, auch zu verschiedenen Zeiten. Erst wenn alle unterschrieben haben,
 * gilt der Vertrag als geschlossen – dann geht das PDF per Mail hinaus.
 */
import { createClient } from '@supabase/supabase-js';
import { sendTelegram } from './_apps.js';
import { buildContractPdf, contractFileName } from '../src/lib/contractPdf';
import type { Contract, Signer, VertragsText } from '../src/lib/vertrag';

interface Req { method?: string; headers: Record<string, string | string[] | undefined>; body?: unknown; query?: Record<string, string | string[] | undefined> }
interface Res { status(c: number): Res; json(b: unknown): void; setHeader(k: string, v: string): void }

const kopf = (r: Req, name: string): string => {
  const v = r.headers[name];
  return (Array.isArray(v) ? v[0] : v) ?? '';
};

const TOKEN_RE = /^[0-9a-f]{64}$/;
const OEFFENTLICH = 'id,number,status,party_company,party_name,party_email,text_frozen,text_hash,our_signature,our_signed_name,our_signed_at,signers,token_expires_at';
const COCKPIT = process.env.COCKPIT_URL ?? 'https://cockpit-flax-tau.vercel.app';

/** Nach außen ohne IP/Browser – die gehen den Kunden nichts an. */
const publik = (s: Signer[]) => s.map(({ name, signature, signed_at }) => ({ name, signature, signed_at }));

/**
 * Unterschriebenen Vertrag an den Kunden mailen – über die Gmail-Verbindung
 * im Cockpit. Ohne gemeinsames Geheimnis (MAIL_SHARED_SECRET) passiert nichts;
 * dann steht im Telegram-Ping, dass die Mail noch händisch raus muss.
 */
async function vertragMailen(v: Contract & { text_frozen: VertragsText }): Promise<boolean> {
  const secret = process.env.MAIL_SHARED_SECRET;
  const to = (v.party_email || '').trim();
  if (!secret || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return false;
  try {
    const pdf = buildContractPdf(v, v.text_frozen);
    const base64 = Buffer.from(pdf.output('arraybuffer')).toString('base64');
    const namen = v.signers.map((s) => s.name).filter(Boolean).join(' und ');
    const r = await fetch(`${COCKPIT}/api/mail/send-document`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-mail-secret': secret },
      body: JSON.stringify({
        to,
        subject: `Unterschriebener Vertrag ${v.number || ''} – ePower GmbH`,
        text: `Guten Tag ${namen || ''},\n\nvielen Dank – der Vertrag ${v.number || ''} ist von allen Seiten unterschrieben. Anbei das PDF mit allen Unterschriften.\n\nWir freuen uns auf die Zusammenarbeit!\n\nBeste Grüße\n${v.our_signed_name || 'Christoph Napetschnig'}\nePower GmbH`,
        fileName: contractFileName(v),
        pdfBase64: base64,
      }),
    });
    const d = await r.json().catch(() => ({}));
    return r.ok && d.ok === true;
  } catch (e) {
    console.error('[vertrag] Mail fehlgeschlagen:', e);
    return false;
  }
}

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
    return res.status(200).json({ vertrag: { ...v, signers: publik((v.signers as Signer[]) || []) } });
  }

  if (req.method === 'POST') {
    let b: { token?: string; slot?: number; name?: string; signature?: string } = {};
    try { b = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as typeof b; }
    catch { return res.status(400).json({ error: 'Body ist kein gültiges JSON' }); }

    const token = (b.token ?? '').toString();
    const slot = Number.isInteger(b.slot) ? Number(b.slot) : 0;
    const name = (b.name ?? '').toString().trim().slice(0, 120);
    const sig = (b.signature ?? '').toString();
    if (!TOKEN_RE.test(token)) return res.status(400).json({ error: 'Ungültiger Link' });
    if (!name) return res.status(400).json({ error: 'Bitte Namen angeben' });
    // Ein leeres PNG ist ~90 Zeichen; alles Kleinere als 150 ist sicher keine Unterschrift.
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sig) || sig.length < 150) return res.status(400).json({ error: 'Unterschrift fehlt' });
    if (sig.length > 400_000) return res.status(413).json({ error: 'Unterschrift zu groß' });

    const { data: v } = await db.from('contracts').select('*').eq('token', token).maybeSingle();
    if (!v) return res.status(404).json({ error: 'Dieser Link ist nicht (mehr) gültig.' });
    if (v.status === 'signed') return res.status(409).json({ error: 'Dieser Vertrag ist bereits von allen unterschrieben.' });
    if (v.status !== 'signed_by_us') return res.status(404).json({ error: 'Dieser Link ist nicht (mehr) gültig.' });
    if (v.token_expires_at && new Date(v.token_expires_at) < new Date()) return res.status(410).json({ error: 'Dieser Link ist abgelaufen.' });

    const signers: Signer[] = Array.isArray(v.signers) && v.signers.length ? v.signers : [{ name: '', signature: null, signed_at: null }];
    if (slot < 0 || slot >= signers.length) return res.status(400).json({ error: 'Unbekannter Unterzeichner' });
    if (signers[slot].signature) return res.status(409).json({ error: 'Diese Unterschrift ist bereits geleistet.' });

    const ip = (kopf(req, 'x-forwarded-for').split(',')[0] || kopf(req, 'x-real-ip') || '').trim().slice(0, 64);
    const ua = kopf(req, 'user-agent').slice(0, 300);
    const jetzt = new Date().toISOString();
    signers[slot] = { name, signature: sig, signed_at: jetzt, ip, ua };
    const fertig = signers.every((s) => !!s.signature);

    // Nur ändern, was noch auf Unterschriften wartet – zwei gleichzeitige Klicks
    // können so nie zwei verschiedene Stände ablegen.
    const { data: upd, error } = await db.from('contracts').update({
      signers,
      // Die alten Einzelfelder bleiben als Abbild des ersten Unterzeichners gefüllt.
      customer_signature: signers[0].signature, customer_signed_name: signers.map((s) => s.name).filter(Boolean).join(' und '),
      customer_signed_at: fertig ? jetzt : null, customer_ip: ip, customer_ua: ua,
      status: fertig ? 'signed' : 'signed_by_us', updated_at: jetzt,
    }).eq('id', v.id).eq('status', 'signed_by_us').select('id').maybeSingle();
    if (error || !upd) return res.status(409).json({ error: 'Unterschrift konnte nicht gespeichert werden.' });

    const offen = signers.filter((s) => !s.signature).map((s) => s.name || '?');
    let gemailt = false;
    if (fertig) gemailt = await vertragMailen({ ...(v as Contract), signers, status: 'signed', customer_signed_at: jetzt });

    await sendTelegram(
      fertig
        ? `✍️ Vertrag ${v.number || ''} vollständig unterschrieben: ${v.party_company || v.party_name || ''} (${signers.map((s) => s.name).join(', ')})` +
          (gemailt ? `\n📧 PDF an ${v.party_email} gesendet` : `\n⚠️ PDF noch nicht gemailt – bitte im CRM „Dem Kunden senden"`)
        : `✍️ Vertrag ${v.number || ''}: ${name} hat unterschrieben – es fehlt noch: ${offen.join(', ')}`,
    );
    return res.status(200).json({ ok: true, signed_at: jetzt, fertig, gemailt, signers: publik(signers) });
  }

  return res.status(405).json({ error: 'nur GET oder POST' });
}
