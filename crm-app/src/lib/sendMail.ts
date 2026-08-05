import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/** Cockpit-Endpunkt (nutzt die dort verbundene Gmail-Verbindung). */
const COCKPIT = import.meta.env.VITE_COCKPIT_URL || 'https://cockpit.epowergmbh.at';

export interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  fileName: string;
  pdfBase64: string;
}

/**
 * Versendet den Beleg als PDF-Anhang über die im Cockpit hinterlegte Gmail-Verbindung.
 * Authentifizierung über das Supabase-Access-Token des eingeloggten Nutzers.
 */
export async function sendDocumentMail(input: SendMailInput): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) { toast.error('Nicht angemeldet'); return false; }
  try {
    const res = await fetch(`${COCKPIT}/api/mail/send-document`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(input),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.ok) {
      toast.error('Versand fehlgeschlagen: ' + (d.error || res.statusText));
      return false;
    }
    return true;
  } catch (e) {
    toast.error('Cockpit nicht erreichbar: ' + (e as Error).message);
    return false;
  }
}
