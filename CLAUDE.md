# ePower Cockpit – Akte für die KI

Christophs eigenes Werkzeug (ePower GmbH), kein Kundenprojekt. Der „Kunde“ ist Christoph selbst: Wünsche meldet er im
Cockpit über den runden Knopf rechts unten (seit 02.11.2026), der Roboter setzt sie um.

## Zwei Apps in einem Repo (GitHub `cockpit`, Branch main – Push deployt beide)

- **crm-app/** – Vite/React, das tägliche Cockpit: Heute, CRM, Buchhaltung, Angebote/Rechnungen, Wünsche, Export,
  Verträge, Wartung … Vercel-Projekt `epower-crm`, live unter app.epowergmbh.at (epower-crm.vercel.app).
  API-Routen in `crm-app/api/` (Vercel Functions). Fast alle Wünsche betreffen diese App.
- **Wurzel (src/, Next.js)** – Mail-Cockpit, Werbeanzeigen (/werbung), Telegram-Bot (`/api/roboter/melden`).
  Vercel-Projekt `cockpit`, live unter cockpit.epowergmbh.at (cockpit-flax-tau.vercel.app).

## Daten

- Supabase `xyhgckqxowqnzjtoblfs`, Schema `crm` (CRM-App) bzw. `cockpit` (Next). Alle crm-Tabellen nur für den
  Inhaber (`crm.ist_inhaber()`), RLS nie lockern.
- Migrationen in `crm-app/supabase/migrations/`, einspielen über die Supabase-Verbindung (apply_migration).
  Edge Functions in `crm-app/supabase/functions/`.
- Echte Geschäftsdaten (Rechnungen, Kassabuch, Kunden): nichts löschen; Rechnungsnummern fortlaufend, ausgestellte
  Rechnungen nicht verändern.

## Feste Regeln

- Commits immer mit `napetschnig.chris@gmail.com`, sonst baut Vercel nicht.
- `New project/` enthält echte Meta-Tokens – nie committen. Keine Schlüssel in Git oder Client-Variablen.
- Nie selbst Mails/SMS an Kunden verschicken.
- Oberfläche schlank halten: Zusätzliches lieber unter „Mehr“ als neue Knöpfe oben.
- Probefahrt: `testumgebung.mjs` passt hier nicht (supabase/ liegt in crm-app/); stattdessen `cd crm-app && npm run build`
  und Typprüfung (`npx tsc --noEmit -p tsconfig.app.json`).

## Wissen nach Thema

- Doku je Funktion: `docs/`.
- „Änderung melden“ im Cockpit: `crm-app/src/components/aenderungswunsch/`, Dateien im Ablagebereich
  `cockpit-wuensche`, Abschrift per Edge Function `wunsch-abschrift`, Wünsche in `crm.app_wuensche` (app_key `cockpit`).
