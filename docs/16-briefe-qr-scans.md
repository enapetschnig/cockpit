# Briefe & QR-Scans (seit 23.11.2026)

Cockpit → Mehr → Verkauf → **Briefe & QR-Scans** (`/briefe`, `crm-app/src/pages/BriefePage.tsx`).

## Ablauf

1. Das Brief-Werkzeug (`~/Developer/brief/<aktion>/erzeuge.mjs`) gibt jedem Brief einen eigenen Code
   (6 Zeichen, fest aus Kampagne + Firma + PLZ) und druckt den QR mit `https://epowergmbh.at/q/<CODE>`.
   Beim Druck entsteht `qr_codes.sql` → einspielen in `crm.brief_qr` (Upsert, mehrfach einspielen schadet nicht).
2. Scan → Website (Repo `websiteepowergmbh`, `api/q.js`, Rewrite `/q/:code` in `vercel.json`) ruft die
   Edge Function `brief-qr` auf (Header `x-webhook-key` = WEBHOOK_API_KEY, wie import-lead) → Zeile in
   `crm.brief_qr_scans` (Gerät aus dem User-Agent, `bot` = Link-Vorschau/Crawler).
   Danach 302 auf die Startseite mit `utm_source=brief&utm_campaign=<kampagne>&utm_content=<CODE>`.
   Wartet höchstens 2,5 s aufs CRM – der Besucher kommt immer an.
3. Füllt der Besucher danach ein Formular aus, kommt der Lead mit Quelle „Brief“ und `ad_name` = Code ins CRM;
   die Seite zeigt ihn bei der Firma als „Anfrage“.

## Seite

Kennzahlen (Briefe, Firmen gescannt, Scans ohne Vorschauen, Anfragen), Scans je Tag, Liste „Wer hat gescannt“
(aufklappbar mit jedem einzelnen Scan, Suche, „Alle Briefe zeigen“), letzte Scans. Mehrere Aktionen → Auswahl oben rechts.
Code `MUSTER` (Kampagne `test`) gehört zum Muster-PDF.

## Tabellen

`crm.brief_qr` (code PK, kampagne, firma, empfaenger, strasse, plz, ort, runde) und `crm.brief_qr_scans`
(code, gescannt_am, geraet, user_agent, bot). RLS nur Inhaber; geschrieben wird nur über die Service-Rolle der Function.
