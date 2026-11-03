---
paths: ["crm-app/supabase/**", "scripts/**"]
---
# Supabase-Fehlerprotokoll: bekannt & harmlos

- `extensions.http_post(...) does not exist` (2×/Werktag, 05:00+15:00 UTC): Cron-Jobs 1/2 `whatsapp-morning/evening-reminder` sind Altlast einer früheren hw-core-App im selben Projekt (Erweiterung `http` fehlt, scheitern seit 31.03.2026) – nicht Cockpit; NICHT „reparieren“ (würde WhatsApp-Erinnerungen an Alt-Mitarbeiter auslösen).
- `column … does not exist` mit application_name `mgmt-api`: Ad-hoc-Abfragen von KI-Sitzungen mit geratenen Spalten, nicht die App. Richtig: `roboter_auftraege.erstellt_am` (kein created_at/ergebnis), `app_wuensche.app_key` (kein projekt), `customers.company_name/first_name/last_name` (kein name).
