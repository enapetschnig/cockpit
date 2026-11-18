# Liquidität & Steuern (crm-app `/liquiditaet`, seit 18.11.2026)

Wo: Mehr → Buchhaltung → „Liquidität & Steuern“. Code: `crm-app/src/pages/LiquiditaetPage.tsx`, Rechnung und Parser in
`crm-app/src/lib/liquiditaet.ts`, Tabellen in `crm-app/supabase/migrations/20261118140000_liquiditaet.sql`.

## Was Christoph monatlich tut
Kontoauszug-PDF (Sparkasse) und/oder George-CSV (Girokonto und Kreditkarte) über „Auszug hochladen“ einspielen.
Doppelte Umsätze werden über `schluessel` = konto|datum|betrag|laufende Nr. verworfen (PDF und CSV derselben Zeit
vertragen sich, solange das Datum gleich ist). Nur das PDF bringt einen Kontostand. Nach einem reinen CSV-Upload rechnet die
Seite mit dem letzten Auszugsstand plus den Umsätzen danach.

## Tabellen (Schema crm, nur Inhaber)
- `liq_buchungen`: Umsätze Giro und Kreditkarte.
- `liq_auszuege`: Kontostand je Auszug, der Startpunkt der Vorschau.
- `liq_posten`: geplante Zahlungen.
  - `intervall_monate` 0 bedeutet einmalig.
  - `muster` ersetzt bzw. blendet erkannte Muster aus.
  - `privat` zählt nicht zum Firmenkonto.
- `liq_steuer`: „Zahlung Finanzamt“-Mails von Nora Lindschinger (U/K/E je Fälligkeit).

## Rechenregeln
- **Muster:** gleiche Gegenseite und ähnlicher Betrag (±25 %), in mindestens 3 der letzten 6 Monate, zuletzt vor höchstens 45 Tagen.
- **Finanzamt:** Buchungen mit Finanzamt bleiben aus der Mustererkennung. Dafür gilt:
  - USt von Monat M ist am 15. von M+2 fällig.
  - Geschätzt wird USt aus den eigenen Rechnungen minus Ø Vorsteuer. Die Vorsteuer wird aus den letzten 6 bekannten Zahllasten zurückgerechnet.
  - Die KöSt-Vorauszahlung (2.950 €) ist als Quartalsposten hinterlegt.
- **Eingänge:**
  - offene Rechnungen
  - Restzahlungen: rest_offen ist netto, gerechnet wird ×1,2 und rest_faellig_am + 14 Tage, nur die letzte Rechnung je Projekt
  - Entwürfe
  - erkannte Kunden-Daueraufträge mit stabilem Betrag (ET König, fonio). Schwankende Kundeneingänge wie Ruff sind
    Einzelrechnungen und zählen nicht als Muster. Liegt eine offene Rechnung desselben Kunden innerhalb von ±25 Tagen,
    zählt nur die Rechnung.
  - Rechnungen mit Nummer und Status `draft` gelten als ausgestellt: Im Cockpit bleibt draft stehen, bis bezahlt ist.
  - Wartung: aus `wartungsvertraege` (nicht „kein“) als Jahresrechnung 12 × monatlich + USt ab `abgerechnet_bis`+1
    bzw. `start_am`, bezahlt nach 14 Tagen. Dazu unterschriebene `contracts` mit `maintenance_monthly`, sofern der
    Kunde noch nicht in `wartungsvertraege` steht; Beginn = Unterschrift + `support_months`.
  - Angenommene Angebote ohne jede Rechnung: „gesichert, ohne Termin“, nicht im Kontostand.
- **Abgleich nach dem Auszug:**
  - Finanzamt: irgendeine FA-Abbuchung ±20 Tage. Gutschriften werden gegengerechnet.
  - Muster: gleiche Gegenseite.
  - Kundengeld: gleicher Betrag und Name.
- **Startdaten:** Auszüge 01–11/2026, Kreditkarte 2026, Giro-CSV 1.–18.11.2026 und die Finanzamt-Mails 02–11/2026.
  - Die Steuerberater-Posten stammen aus den Honorarnoten 2025/26.
  - Die privaten Posten stammen aus StNr 71 169/6385.
