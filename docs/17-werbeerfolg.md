# Werbeerfolg / ROAS (seit 24.11.2026)

Cockpit → Mehr → Verkauf → **Werbeerfolg (ROAS)** (`/werbeerfolg`, `crm-app/src/pages/WerbeerfolgPage.tsx`,
Rechnen in `crm-app/src/lib/werbeerfolg.ts`).

## Was gezählt wird

- **Auftragswert** (Hauptzahl, auch was noch nicht verrechnet ist): angenommenes Angebot (mindestens so viel, wie dazu
  schon verrechnet wurde) · sonst je Rechnungskette (`projekt_id`, bzw. `source_document` auf eine Rechnung) der höhere
  Wert aus `project_total` und Summe · sonst die einzelne Rechnung. Gutschriften ziehen ab. Datum = Angebot bzw. erste Rechnung.
  Beispiel SETEC: Angebot 8.000, Anzahlung 4.000 verrechnet → Auftragswert 8.000.
- **Verrechnet**: Rechnungen, Teil- und Schlussrechnungen netto (`documents.net`), Gutschriften negativ, ohne Storno.
  „Entwurf“ zählt mit – im Cockpit bleibt eine ausgestellte Rechnung bis zur Zahlung auf draft (alle haben eine Nummer).
- Beides je Firma (Kundenname, sonst Empfänger auf dem Beleg, klein geschrieben und Leerzeichen zusammengezogen = `firma_key`).
- **Herkunft** einer Firma: von Hand gesetzt (`crm.werbe_herkunft`) – sonst die Quelle ihrer Anfrage
  (`documents.lead_id` bzw. `customers.lead_id` → `leads.source`; referral = Empfehlung, other/phone = unbekannt).
  **Nie** `leads.sale_amount` nehmen – das ist nicht gepflegt.
- **Kosten**: Abbuchungen aus dem Kontoauszug (`crm.liq_buchungen`, Betrag < 0) nach Buchungstext:
  `FACEBK`/`FACEBOOK`/`META PLATFORMS` → Facebook & Instagram, `PAGRO`/`POST` → Briefe (laut Christoph erst ab Juni 2026;
  die PAGRO/POST-Buchungen davor sind in `crm.werbekosten` ausgenommen).
  In `crm.werbekosten`: einzelne Buchung ausnehmen (`buchung_id`, `kanal` null) oder umhängen, und Kosten
  nachtragen, die nicht im Kontoauszug stehen (z. B. 2025 – die Buchungen beginnen erst 2026).
- **ROAS** = Auftragswert der Kunden aus dem Kanal ÷ Kosten des Kanals im selben Zeitraum (Jahr oder Gesamt);
  daneben klein der ROAS nur auf das Verrechnete. „Neue Kunden“ = erster Beleg im Zeitraum.
  Facebook und Instagram teilen sich die Meta-Kosten.
- Das händische **Auftragsvolumen** (`crm.order_volumes`, Seite /auftragsvolumen) fließt nicht ein – Christoph 24.11.2026:
  „nach den Rechnungen und Aufträgen im Buchhaltungssystem, nicht nach dem, was ich manuell eingebe“. Zuordnung seiner
  Einträge: Hölzi = Steron, „Robert Nachbar“ = Composite Solutions, „3dscan im holzbau“ = Netzker, „Sonnenoase Start ab
  Oktober“ = Steinbrecher & Köberl, „Hofer Fenster und Türen“ = HT Montageteam (Thomas Hofer, Facebook-Anfrage).
  Ruff: 5.500 in Rechnungen statt 4.000 – 1417 steht als bezahlt, ohne Zahlung am Konto (wohl Doppel von 1418).

## Seite

Jahr/Gesamt oben, drei Kacheln (Werbung gesamt, Facebook & Instagram, Briefe) mit ROAS, Auftragswert, davon verrechnet,
Kosten, neue Kunden, Kosten je Kunde. Linien „Kosten und Aufträge, aufsummiert“ (Auftragswert durchgezogen, verrechnet
gestrichelt, Kosten orange; auch als Tabelle). Kundenliste (Start: „Alle“) mit Auftragswert und Verrechnetem und
Auswahl der Herkunft je Firma (speichert sofort), Filter „Ohne Herkunft“. Kostenkarte mit allen Buchungen
(ausnehmen/mitzählen) und „Kosten nachtragen“. Gelber Hinweis, wenn ein Kanal Aufträge, aber keine Kosten hat.

## Tabellen

- `crm.werbe_herkunft` (firma_key PK, firma, kanal facebook/instagram/brief/website/empfehlung/youtube/privat/sonstiges).
  Laut Christoph 24.11.2026: SETEC, Monti, Pachlinger, Ruff, Trippl, Dörflinger, HTP Kellner, Steron, Tilger,
  Holzerleben, ATTL (Lederer) = Facebook (die aus der Nähe kamen auch über die Werbung); Sonnenoase, Lengauer-Stockner,
  Netzker, Geißelbacher = Brief; ET-König, Composite Solutions, fonio, Elektriker Österreich = privat (selbst akquiriert);
  Bau4You = YouTube; CS Powermetall = Empfehlung; Steinbrecher & Köberl = Facebook (laut Anfrage, bestätigt).
  Migrationen `20261124160000_werbeerfolg.sql`, `20261124180000_werbe_herkunft_privat_youtube.sql`.
- `crm.werbekosten` (buchung_id unique → liq_buchungen, kanal meta/brief/sonstiges/null, datum, betrag, text).
- RLS nur Inhaber (`crm.ist_inhaber()`).
