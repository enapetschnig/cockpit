# Melde-Feature („Änderung melden") in eine Handwerker-App einbauen

Diese Anleitung ist für eine Claude-Session, die in einem der Baukasten-Repos
(Vite + React + TS + shadcn + Supabase) arbeitet — z. B. `schrettl` oder
`monti.pro`. Sie bringt das komplette Feedback-System hinein, wie es in
`groismaier` und `cspowermetall` bereits läuft. **Referenz-Quellcode liegt in
`~/Developer/cspowermetall` (Melde-Teil, aktuellster Stand) und
`~/Developer/groismaier` (Neuerungen-Banner).** Von dort kopieren, nicht neu
erfinden.

## Was das Feature kann

1. **Melden:** Knopf „Änderung melden" auf jeder Maske. Ein Klick macht
   ZUERST automatisch ein Bildschirmfoto (html2canvas, sichtbarer DOM) und
   öffnet DANN den Dialog — sonst wäre nur das Meldefenster im Bild. Dort:
   tippen ODER Sprachnachricht, Art wählen (Wunsch/Fehler/Frage), im Bild
   markieren. Sprachnachricht wird hochgeladen und im Hintergrund von der
   Edge Function `sprache-zu-text` (OpenAI Whisper) abgeschrieben.
2. **Admin-Reiter „Änderungswünsche":** Liste aller Meldungen mit Bild/Ton,
   Status (neu/gesehen/umgesetzt/abgelehnt), Antwortfeld, Sammel-Kopieren.
   Plus „Neuerungen melden": veröffentlicht eine Startseiten-Meldung.
3. **Rückmeldung an den Melder** („Dein Wunsch ist erledigt", Startseite):
   zeigt jedem Benutzer seine EIGENEN umgesetzten/abgelehnten Wünsche einmal.
4. **„Das ist neu"-Banner** (Startseite): vom Admin veröffentlichte
   Neuerungen, erscheinen einmal, Gelesen-Vermerk je Benutzer in der DB.
   **WICHTIG (Kundenentscheid 28.08.2026): Dieses Banner sehen NUR
   Administratoren** — `{user && isAdmin && <NeuerungenBanner …/>}`.
   Melden dürfen weiterhin alle; die Melder-Rückmeldung (Punkt 3) sehen alle.

## Schritt 0 — Voraussetzungen im Ziel-Repo prüfen

- [ ] `public.has_role(auth.uid(), 'administrator'::app_role)` — existiert
      die Funktion und heißt die Admin-Rolle wirklich `administrator`?
      (`grep -rn "app_role" supabase/migrations/ | head`) Falls die Rolle
      anders heißt (`admin`?), in ALLEN kopierten Migrationen anpassen.
- [ ] `public.update_updated_at_column()` — Trigger-Funktion vorhanden?
      Sonst aus einer alten Migration des Ziel-Repos übernehmen.
- [ ] Wie heißen Toolbar/Kopfzeile? (`KBToolbar`, `PageHeader`, eigene
      Leiste auf der Startseite?) Der Knopf muss in JEDE Kopfzeilen-Variante.
- [ ] Wie spielt dieses Repo Migrationen ein? (CI-Workflow, supabase CLI,
      eigener Weg) — den etablierten Weg verwenden, nichts Neues erfinden.
- [ ] Gibt es einen `OPENAI_API_KEY` als Edge-Function-Secret im
      Supabase-Projekt? Ohne ihn liefert `sprache-zu-text` einen Fehler
      („Spracherkennung nicht eingerichtet") — Tippen funktioniert trotzdem.

## Schritt 1 — Dateien kopieren

Aus `~/Developer/cspowermetall`:

| Quelle | Ziel |
|---|---|
| `src/components/aenderungswunsch/` (alle 5 Dateien: Knopf, Dialog, BildMarkieren, Liste, ErledigteWuensche) | gleicher Pfad |
| `src/lib/bildschirmfoto.ts` | gleicher Pfad |
| `supabase/functions/sprache-zu-text/index.ts` | gleicher Pfad |
| `supabase/migrations/20260826100000_aenderungswuensche.sql` | neuer Zeitstempel |
| `supabase/migrations/20260827110000_wunsch_gesehen.sql` | neuer Zeitstempel |

Aus `~/Developer/groismaier`:

| Quelle | Ziel |
|---|---|
| `src/components/neuerungen/NeuerungenBanner.tsx` + `NeuerungenPflege.tsx` | gleicher Pfad |
| `supabase/migrations/20260826150000_neuerungen.sql` | neuer Zeitstempel |

Dann: `npm install html2canvas@^1.4.1`

## Schritt 2 — Typen-Falle

Die neuen Tabellen fehlen in den generierten Supabase-Typen
(`src/integrations/supabase/types.ts`). Wenn `tsc` meckert, das im Baukasten
übliche Cast-Muster verwenden (steht so schon im Groismaier-Code):

```ts
const aenderungTable = () => (supabase.from("aenderungswuensche" as never) as any);
```

`supabase.storage.from("aenderungswuensche")` NICHT casten — Storage ist
untypisiert und heißt zufällig gleich wie die Tabelle. Nicht verwechseln.

## Schritt 3 — Knopf einbinden

1. **Zentrale Toolbar** (KBToolbar o. ä.): `<AenderungswunschKnopf
   gestalt="kopf" />` in den rechten Aktionsbereich; das Wurzel-Element der
   Toolbar bekommt `data-seitenkopf`.
2. **AppLayout**: `<AenderungswunschKnopf gestalt="schwebend" />` nach dem
   `<Outlet />` — für Seiten ohne Kopfzeile. Er blendet sich selbst aus,
   sobald ein `[data-seitenkopf]` auf der Seite steht.
3. **Startseiten-Falle (Groismaier-Lehre):** Baut die Startseite ihre
   Kopfzeile SELBST statt über die zentrale Komponente, bekommt sie den
   Knopf nicht mit — dort den Knopf direkt einbauen und die eigene Leiste
   mit `data-seitenkopf` markieren, sonst erscheint er doppelt (schwebend).
4. Knopf und Home-Buttons tragen `data-bildschirmfoto="aus"`, damit sie
   nicht mit aufs Foto kommen.

## Schritt 4 — Admin + Startseite

- Admin-Seite: neuer Reiter „Änderungswünsche" mit `<NeuerungenPflege />`
  (oben) und `<AenderungswuenscheListe />` (darunter).
- Startseite: `<ErledigteWuensche />` für ALLE eingeloggten Benutzer;
  `<NeuerungenBanner userId={user.id} />` NUR bei `isAdmin`.

## Schritt 5 — Ausrollen

1. Migrationen über den in Schritt 0 ermittelten Weg einspielen und das
   Ergebnis VERIFIZIEREN (HTTP 201 je Migration bzw. Tabelle per Abfrage).
2. Edge Function deployen: `supabase functions deploy sprache-zu-text`.
3. App-Gates des Repos fahren (tsc-Baseline, Tests, Build) und pushen.

## Schritt 6 — Livetest (nicht überspringen)

Mit einem normalen Mitarbeiter-Testkonto gegen die echte DB (per curl):

1. `POST /rest/v1/aenderungswuensche` (Text-Wunsch, `erstellt_von` = eigene
   user-id) → **HTTP 201**
2. Bild in den Bucket: `POST /storage/v1/object/aenderungswuensche/<uid>/test.png`
   → **HTTP 200** (RLS: Ordnername = eigene uid!)
3. Beides wieder löschen (DELETE) — keine Testdaten liegen lassen.
4. Gegenprobe: Sieht das Mitarbeiter-Konto FREMDE Wünsche? Muss leer sein
   (nur Admins sehen alle).

## Schritt 7 — Cockpit-Anbindung (Push — das Cockpit hat KEINE App-Schlüssel)

Architektur-Entscheid 28.08.2026: Die App SCHICKT ihre Meldungen selbst ans
epower-cockpit; Bilder holt das Cockpit über eine kleine App-Funktion.
Referenz-Umsetzung liegt fertig in `enapetschnig/groismaier` (GitHub, public —
falls nicht lokal vorhanden: `gh repo clone enapetschnig/groismaier`):

1. **Migration kopieren:**
   `supabase/migrations/20260828170000_wunsch_ans_cockpit.sql`
   (pg_net-Trigger + Tabelle `cockpit_verbindung` ohne Policies; `app_key`-
   Default auf den eigenen App-Namen ändern!). Der Trigger ist inaktiv,
   solange `cockpit_verbindung` leer ist — gefahrlos sofort ausrollbar.
2. **Edge Function kopieren:** `supabase/functions/wunsch-datei/index.ts`
   (signierte URL für Bild/Ton, abgesichert über das gemeinsame Geheimnis)
   und deployen.

   **WICHTIG — sonst kommt kein einziges Bild an:** Für diese Funktion muss
   die JWT-Prüfung des Supabase-Gateways AUS sein. Das CRM schickt nur das
   gemeinsame Geheimnis, keinen JWT; sonst blockt das Gateway, bevor die
   Funktion überhaupt läuft (`UNAUTHORIZED_NO_AUTH_HEADER`). In
   `supabase/config.toml`:
   ```toml
   [functions.wunsch-datei]
   verify_jwt = false
   ```
   oder beim Deployen `--no-verify-jwt`. Die Funktion schützt sich selbst
   über `COCKPIT_SECRET` — der Schutz geht dadurch nicht verloren.

   **Gegenprobe** (muss `Ungültiger Pfad` liefern, NICHT `UNAUTHORIZED_NO_AUTH_HEADER`):
   ```bash
   curl -s -X POST https://<projectRef>.supabase.co/functions/v1/wunsch-datei \
     -H 'Content-Type: application/json' -H 'x-cockpit-secret: <Geheimnis>' \
     -d '{"pfad":"x"}'
   ```
3. **Function-Secret setzen:** `COCKPIT_SECRET` = der Wert von
   `FEEDBACK_SHARED_SECRET` aus `~/Developer/epower-cockpit/.env`
   (`supabase secrets set COCKPIT_SECRET=… --project-ref <ref>` bzw.
   Management-API).
4. **Scharfschalten.** Die Empfangsseite ist seit 31.08.2026 fertig und
   liegt im CRM (`app.epowergmbh.at`), NICHT im Cockpit — cockpit.epowergmbh.at
   hat keinen DNS-Eintrag. Die Eingangs-URL ist fix:
   ```sql
   INSERT INTO public.cockpit_verbindung (url, secret, app_key)
   VALUES ('https://app.epowergmbh.at/api/wuensche-eingang', '<Geheimnis>', '<appKey>')
   ON CONFLICT (einzig) DO UPDATE SET url = EXCLUDED.url, secret = EXCLUDED.secret;
   ```
5. **Test:** Wunsch in der App melden → erscheint im CRM unter „Wünsche"
   (`https://app.epowergmbh.at/wuensche`) samt Bild; Telegram pingt genau
   einmal. Testwunsch löschen.
6. **Kunde zuordnen** (einmalig, sonst steht die Meldung ohne Kundenbezug da):
   ```sql
   UPDATE crm.customers SET app_key = '<appKey>' WHERE company_name ILIKE '%<Firma>%';
   UPDATE crm.app_wuensche SET customer_id =
     (SELECT id FROM crm.customers WHERE app_key = '<appKey>')
     WHERE app_key = '<appKey>' AND customer_id IS NULL;
   ```

## Bekannte Fallen (aus Groismaier gelernt)

- **Reihenfolge Foto→Dialog** nicht umdrehen.
- Die Migration legt Tabelle, Storage-Bucket UND alle RLS-Policies an —
  nichts davon weglassen.
- `sprache-zu-text` läuft asynchron: Der Dialog wartet NICHT auf die
  Abschrift (Feld `abschrift`: offen→laeuft→fertig/fehler).
- Banner-Gelesen-Vermerk liegt in der DB (`neuerungen_gelesen`), nicht in
  localStorage — sonst erscheint die Meldung am zweiten Gerät erneut.
- Beim Abschließen von Wünschen per SQL: die ECHTE id verwenden, nicht über
  Textvergleich raten (Umlaut-Falle „übersiedeln" ≠ „uebersiedeln").
