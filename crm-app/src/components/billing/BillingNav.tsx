/**
 * Historischer Name – die Buchhaltungsseiten binden „BillingNav" ein.
 * Inhaltlich ist das seit der Vereinheitlichung schlicht DIE App-Navigation
 * (`AppNav`), damit jede Seite denselben Kopf trägt.
 */
import { AppNav } from '@/components/AppNav';

export function BillingNav() {
  return <AppNav />;
}
