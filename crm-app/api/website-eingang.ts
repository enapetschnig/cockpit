/**
 * Eingang für Anfragen und Bewerbungen von epowergmbh.at.
 * Öffentlich unter https://app.epowergmbh.at/api/website-eingang – abgesichert
 * über das gemeinsame Geheimnis im Header `x-cockpit-secret`.
 *
 * Jede Anfrage wird ein Lead in der Pipeline (Quelle „website"). Meldet sich
 * dieselbe Telefonnummer noch einmal, wird der bestehende Lead hochgezählt
 * und wieder auf „Neu" gesetzt – so wie beim Meta-Abgleich. Bewerbungen
 * landen ebenfalls als Lead, klar als solche beschriftet.
 */
import { createClient } from '@supabase/supabase-js';
import { secretGleich, sendTelegram } from './_apps.js';

interface Req { method?: string; headers: Record<string, string | string[] | undefined>; body?: unknown }
interface Res { status(c: number): Res; json(b: unknown): void }

interface Payload {
  art?: 'anfrage' | 'bewerbung';
  vorname?: string; nachname?: string; unternehmen?: string; telefon?: string; email?: string;
  quelle?: string;              // termin | quiz | kontakt …
  gf?: string | boolean;        // Geschäftsführer?
  mitarbeiter?: string | number;
  nachricht?: string; link?: string; stelle?: string;
}

// Wem die Pipeline gehört – die Website hat keinen eigenen Login.
const OWNER = process.env.CRM_OWNER_USER_ID ?? '83edc9c7-26a7-4f56-8806-cdfe253b9751';
const AKTIV = new Set(['contacted', 'follow_up', 'qualified', 'meeting_scheduled', 'meeting_done', 'won']);

const kopf = (r: Req, name: string): string => {
  const v = r.headers[name];
  return (Array.isArray(v) ? v[0] : v) ?? '';
};
const cut = (v: unknown, n: number): string => (v ?? '').toString().trim().slice(0, n);
const normPhone = (v: string) => v.replace(/\D/g, '').slice(-9);
const ja = (v: unknown) => v === true || /^(ja|yes|true|1)$/i.test((v ?? '').toString().trim());

export default async function handler(req: Req, res: Res): Promise<void> {
  if (req.method !== 'POST') return res.status(405).json({ error: 'nur POST' });

  const secret = process.env.WEBSITE_SHARED_SECRET ?? process.env.FEEDBACK_SHARED_SECRET;
  if (!secret || !secretGleich(kopf(req, 'x-cockpit-secret'), secret)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  let b: Payload = {};
  try { b = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Payload; }
  catch { return res.status(400).json({ error: 'Body ist kein gültiges JSON' }); }

  const art = b.art === 'bewerbung' ? 'bewerbung' : 'anfrage';
  const vorname = cut(b.vorname, 60), nachname = cut(b.nachname, 60);
  const telefon = cut(b.telefon, 40), email = cut(b.email, 120);
  const name = [vorname, nachname].filter(Boolean).join(' ');
  if (!name || (!telefon && !email)) return res.status(400).json({ error: 'Name und Telefon oder E-Mail nötig' });

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return res.status(500).json({ error: 'Supabase-Zugang fehlt' });
  const db = createClient(url, key, { db: { schema: 'crm' }, auth: { persistSession: false } });

  const jetzt = new Date().toISOString();
  const stelle = cut(b.stelle, 80), quelle = cut(b.quelle, 40) || 'website';
  const firma = art === 'bewerbung' ? `Bewerbung: ${stelle || 'ohne Angabe'}` : cut(b.unternehmen, 120) || null;
  const formName = art === 'bewerbung' ? `Bewerbung ${stelle}`.trim() : `Website ${quelle}`;

  // Was der Lead an Kontext bekommt – kurz, in einer Zeile pro Punkt.
  const notizen = [
    art === 'bewerbung' ? `Bewerbung über die Website${stelle ? ` – ${stelle}` : ''}` : `Anfrage über die Website (${quelle})`,
    b.gf !== undefined && b.gf !== '' ? `GF: ${ja(b.gf) ? 'ja' : cut(b.gf, 20)}` : '',
    b.mitarbeiter !== undefined && b.mitarbeiter !== '' ? `Mitarbeiter: ${cut(b.mitarbeiter, 20)}` : '',
    b.link ? `Link: ${cut(b.link, 200)}` : '',
    b.nachricht ? `Text: ${cut(b.nachricht, 1000)}` : '',
  ].filter(Boolean).join('\n');

  // Wiederholer: gleiche Telefonnummer (letzte 9 Ziffern) oder gleiche E-Mail.
  const tel9 = normPhone(telefon);
  let hit: { id: string; stage: string; qualification_notes: string | null; inquiry_count: number | null } | null = null;
  if (tel9 || email) {
    const { data: kandidaten } = await db.from('leads')
      .select('id,phone,email,stage,qualification_notes,inquiry_count,created_at')
      .eq('user_id', OWNER).order('created_at', { ascending: false }).limit(3000);
    for (const k of (kandidaten ?? []) as { id: string; phone: string | null; email: string | null; stage: string; qualification_notes: string | null; inquiry_count: number | null }[]) {
      if ((tel9 && normPhone(k.phone || '') === tel9) || (email && (k.email || '').trim().toLowerCase() === email.toLowerCase())) { hit = k; break; }
    }
  }

  let leadId: string;
  if (hit) {
    const notes = [`${new Date().toLocaleDateString('de-AT')}: erneut gemeldet – ${notizen.split('\n')[0]}`, hit.qualification_notes].filter(Boolean).join('\n');
    const { error } = await db.from('leads').update({
      qualification_notes: notes, last_inquiry_at: jetzt, inquiry_count: (hit.inquiry_count ?? 1) + 1,
      updated_at: jetzt, ...(AKTIV.has(hit.stage) ? {} : { stage: 'new' }),
      ...(email ? { email } : {}), ...(telefon ? { phone: telefon } : {}),
    }).eq('id', hit.id);
    if (error) return res.status(500).json({ error: 'Lead konnte nicht aktualisiert werden' });
    leadId = hit.id;
  } else {
    const { data, error } = await db.from('leads').insert({
      user_id: OWNER, full_name: name, phone: telefon || null, email: email || null, company_name: firma,
      source: 'website', platform: 'website', form_name: formName, stage: 'new',
      is_entrepreneur: ja(b.gf), has_more_than_5_employees: Number(cut(b.mitarbeiter, 6).replace(/\D/g, '')) > 5,
      qualification_notes: notizen, last_inquiry_at: jetzt, inquiry_count: 1,
    }).select('id').single();
    if (error || !data) return res.status(500).json({ error: 'Lead konnte nicht angelegt werden' });
    leadId = data.id as string;
  }

  await sendTelegram(
    (art === 'bewerbung' ? `📄 Neue Bewerbung${stelle ? ` (${stelle})` : ''}` : `🌐 Neue Website-Anfrage (${quelle})`) +
    `${hit ? ' – schon bekannt, wieder auf Neu' : ''}\n${name}${firma && art !== 'bewerbung' ? ` · ${firma}` : ''}\n${telefon ? `Tel: ${telefon}` : ''}${email ? `\nMail: ${email}` : ''}` +
    `\nhttps://app.epowergmbh.at/?lead=${leadId}`,
  );
  return res.status(200).json({ ok: true, lead_id: leadId, wiederholt: !!hit });
}
