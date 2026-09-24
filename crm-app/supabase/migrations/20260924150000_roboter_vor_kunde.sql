-- Was vor der Antwort an den Kunden noch erledigt sein muss, das der Roboter nicht selbst kann
-- (z. B. eine Einstellung bei Apple/Google, ein Schlüssel, den nur Christoph hat).
-- Christoph, 24.09.2026: „du darfst erst die Änderungen dem Nutzer zeigen, wenn du wirklich alles
-- eingearbeitet hast und es sichtbar ist“ – der Kunde bekommt „umgesetzt“ erst nach seinem OK.
alter table crm.roboter_auftraege add column if not exists vor_kunde text;
-- Christophs OK zu genau dieser Liste („✅ Erledigt – Kunde bekommt Bescheid“ in Telegram/CRM).
-- Ändert der Roboter die Liste, setzt er das OK zurück.
alter table crm.roboter_auftraege add column if not exists vor_kunde_ok_am timestamptz;
-- Schlüssel, bei denen Christoph zweimal bestätigt hat „geht ohne“ (fehlt in Vercel/Supabase, die App läuft trotzdem) –
-- der Roboter fragt dafür bei diesem Kunden nicht mehr nach.
alter table crm.roboter_apps add column if not exists ohne_schluessel text[] not null default '{}';
