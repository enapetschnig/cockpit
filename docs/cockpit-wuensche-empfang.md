> **ERLEDIGT am 31.08.2026 — diese Anleitung ist Doku, keine Aufgabe mehr.**
>
> Umgesetzt wurde sie NICHT im Cockpit, sondern im **CRM/Buchhaltungssystem**
> auf `app.epowergmbh.at`: `cockpit.epowergmbh.at` hat keinen DNS-Eintrag und
> die `*.vercel.app`-Adresse des Cockpits steckt hinter Vercels SSO — die Apps
> könnten sie also gar nicht erreichen.
>
> - **Eingang (für die Apps):** `https://app.epowergmbh.at/api/wuensche-eingang`
> - **Bereich zum Ansehen:** `https://app.epowergmbh.at/wuensche` (Menüpunkt „Wünsche")
> - **Datei-Proxy:** `/api/wuensche-datei?id=…&art=bild|audio`
> - **Tabellen:** `crm.app_wuensche`, Zuordnung über `crm.customers.app_key`
> - **Code:** `epower-cockpit/crm-app/api/wuensche-*.ts` und
>   `crm-app/src/pages/WuenschePage.tsx`
>
> Zum Anbinden einer weiteren App siehe `melde-feature-einbau.md`, Schritt 7.

# epower-cockpit: Änderungswünsche aller Apps empfangen (eigener Bereich)

Anleitung für die Session (z. B. Antigravity) im Repo
`~/Developer/epower-cockpit` — Next.js 15 App Router + Prisma (eigene DB) +
Supabase-Auth + Telegram-Push (`src/lib/telegram.ts`).

## Architektur (Entscheid 28.08.2026): Die Apps SCHICKEN — das Cockpit
## braucht KEINE Supabase-Schlüssel der Apps

Jede Handwerker-App (groismaier, cspowermetall, schrettl, monti.pro, …) hat
einen Datenbank-Trigger, der jede neue Meldung und jede Statusänderung per
HTTP an das Cockpit postet. Bilder/Sprachnachrichten bleiben im privaten
Bucket der App; das Cockpit holt bei Bedarf eine signierte URL bei der
App-eigenen Edge Function `wunsch-datei` — beides abgesichert über EIN
gemeinsames Geheimnis. In `.env` liegt es bereits: **`FEEDBACK_SHARED_SECRET`**
(auch in die Vercel-Env übernehmen!).

Groismaier ist app-seitig schon fertig (Trigger + `wunsch-datei` deployt,
Secret gesetzt); der Trigger ist inaktiv, bis die Cockpit-URL in der App
eingetragen wird — das passiert am Ende (Schritt „Aktivieren").

## 1. Prisma-Modell (`prisma/schema.prisma`, dann `prisma db push`)

```prisma
model AppWunsch {
  id           String    @id            // UUID aus der Quell-App (stabil)
  appKey       String                   // "groismaier", "cspowermetall", ...
  customerId   String?
  customer     Customer? @relation(fields: [customerId], references: [id])
  art          String                   // wunsch | fehler | frage
  status       String                   // neu | gesehen | umgesetzt | abgelehnt
  text         String
  antwort      String?
  seite        String?
  melder       String?
  bildPfad     String?                  // Pfad im App-Bucket, KEINE Datei
  audioPfad    String?
  erstelltAm   DateTime
  aktualisiert DateTime
  gesehenAm    DateTime?                // "im Cockpit gesehen" (Cockpit-eigen)
  @@index([appKey, status])
}
```

`Customer` erweitern: `appKey String? @unique` und Relation `wuensche
AppWunsch[]`. Die appKeys der Kunden einmalig pflegen (groismaier →
Kunde „Holzbau Groismaier" usw.).

## 2. Eingangs-Endpunkt `src/app/api/wuensche/eingang/route.ts`

- POST, **öffentlich erreichbar, aber**: Header `x-cockpit-secret` muss
  `FEEDBACK_SHARED_SECRET` entsprechen (timing-sicher vergleichen), sonst 401.
  Header `x-app-key` = appKey.
- Body (schickt der App-Trigger): `id, art, status, text, antwort, seite,
  bild_pfad, audio_pfad, melder, erstellt_am, aktualisiert_am`.
- **Upsert per `id`**: Alles aus dem Payload überschreiben (die App ist die
  Wahrheit — auch der nachgetragene Text der Sprach-Abschrift kommt als
  Update), aber `gesehenAm` und `customerId` NIE anfassen; `customerId`
  nur beim ERSTEN Insert über `Customer.appKey` setzen.
- **Telegram-Ping nur beim erstmaligen Insert** mit status `neu`:
  `sendTelegram("🛠 <App>: <Art> — <Textanfang>")` — das ist die
  Push-Benachrichtigung. Bei Updates kein Ping.
- Antwort immer 200 mit `{ok:true}` — der Trigger wertet sie nicht aus.

## 3. Datei-Proxy `src/app/api/wuensche/[id]/datei/route.ts?art=bild|audio`

Wunsch aus der DB laden, dann bei der Quell-App anfragen:

```
POST https://<projectRef>.supabase.co/functions/v1/wunsch-datei
Header: x-cockpit-secret: <FEEDBACK_SHARED_SECRET>
Body:   { "pfad": "<bildPfad bzw. audioPfad>" }
→ { "url": "<signierte URL, 1 h gültig>" }   → per Redirect ausliefern
```

Die projectRef je appKey gehört in eine kleine Konstante/Tabelle:
groismaier `tdehljzmqwmfgfoyyoee`, cspowermetall `jtdkilylwpgwqumzkdne`,
schrettl `pwzfplzwmufvfjaubfcp`, monti.pro `zbxizeirecoipqvxymdx`.
Diese Route hinter den Cockpit-Login legen (wie die anderen internen APIs).

## 4. UI — EIGENER BEREICH „Wünsche" (Kundenentscheid)

Ein eigener Navigationspunkt/eigene Seite (z. B. `/wuensche`), nicht nur ein
Anhängsel der Kundenliste:

- **Arbeitsliste:** alle Wünsche über alle Apps, neueste zuerst; Filter
  nach App/Kunde, Art und Status; „Neu"-Zähler prominent.
- Je Eintrag: App/Kunde, Datum, Art-Badge, Melder, Text, Antwort der App,
  Status-Badge, Screenshot (lazy über den Datei-Proxy), Audio-Player.
- Knopf „Gesehen" setzt `gesehenAm` (nur Cockpit-Vermerk; der eigentliche
  Status „umgesetzt" wird weiterhin in der jeweiligen App gepflegt, weil
  dort die Melder-Rückmeldung dranhängt).
- Zusätzlich in der bestehenden Kundenliste (`src/components/Cockpit.tsx`):
  kleines Badge „X neue Wünsche" je Kunde mit `appKey`, Klick springt in den
  Wünsche-Bereich mit gesetztem Filter.

## 5. Verifikation

1. Endpunkt lokal mit curl testen: mit falschem Secret → 401; mit richtigem
   Secret und Beispiel-Payload → Eintrag in der DB, Telegram-Nachricht
   kommt an; denselben Payload nochmal → Update, KEIN zweiter Ping.
2. Deployen (Vercel), `FEEDBACK_SHARED_SECRET` in der Vercel-Env setzen.
3. **Die öffentliche URL des Eingangs-Endpunkts ausgeben** (z. B.
   `https://<domain>/api/wuensche/eingang`) — sie wird gebraucht, um die
   Apps scharfzuschalten (siehe unten).

## 6. Aktivieren der Apps (macht die jeweilige App-Session)

In jeder App eine Zeile in die Tabelle `cockpit_verbindung` (per SQL über
den app-eigenen Migrations-/CI-Weg):

```sql
INSERT INTO public.cockpit_verbindung (url, secret, app_key)
VALUES ('https://<cockpit-domain>/api/wuensche/eingang', '<FEEDBACK_SHARED_SECRET>', '<appKey>')
ON CONFLICT (einzig) DO UPDATE SET url = EXCLUDED.url, secret = EXCLUDED.secret;
```

Ab dann schickt der Trigger automatisch. Test: in der App einen Wunsch
melden → er erscheint im Cockpit-Bereich samt Bild, Telegram pingt einmal.
Danach Testwunsch in der App löschen.

## Hinweis: verpasste Meldungen

Der Trigger feuert einmalig; war das Cockpit gerade nicht erreichbar, geht
diese eine Meldung im Cockpit verloren (in der App bleibt sie natürlich).
Für den Anfang bewusst akzeptiert — bei Bedarf später einen
„Nachholen"-Abgleich ergänzen.
