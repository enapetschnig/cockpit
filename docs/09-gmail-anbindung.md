# Gmail-Anbindung (echte Mails) — Phase 1b

> Teil von **ePower Cockpit** · [‹ Doku-Übersicht](./README.md)

**In einem Satz:** Statt Beispiel-Daten holt das Cockpit deine **echten** Gmail-Nachrichten aus
zwei Postfächern (Firma + privat), klassifiziert sie mit der KI und legt sie in der Datenbank ab.

> **Status:** Aktuell ist [src/lib/gmail.ts](../src/lib/gmail.ts) noch ein Stub und das Cockpit
> läuft auf Seed-Daten. Dieses Dokument ist die **Anleitung** + der Bauplan. Du kannst die
> Google-Cloud-Schritte (1–5) schon jetzt erledigen, während die Code-Seite gebaut wird.

## So funktioniert es (Architektur)
1. **OAuth 2.0 pro Konto:** Du verbindest Firmen- und Privat-Gmail einmal. Google gibt uns
   ein *Refresh-Token*, das (verschlüsselt) in der DB gespeichert wird — kein Passwort nötig.
2. **Sync:** Auf Knopfdruck (später automatisch) holt das Cockpit neue Mails über die Gmail API,
   wandelt sie in `RawMail` um → [classifyEmail()](../src/lib/openai.ts) → speichert sie als
   `Email` (siehe [Datenmodell](./01-datenmodell.md)).
3. **Push:** Wichtige/firmenrelevante Mails lösen optional einen
   [Telegram-Push](./08-telegram-push.md) aus.
4. **Echtzeit (Roadmap):** `users.watch` + Google Cloud Pub/Sub → Webhook statt Polling.

**Scopes:** `gmail.readonly` (lesen + klassifizieren). Später `gmail.send` für KI-Antworten.

## Anleitung — Google Cloud (einmalig, ~10 Min)

1. **Projekt anlegen:** [console.cloud.google.com](https://console.cloud.google.com) →
   Projekt-Auswahl → *Neues Projekt* → Name z. B. „ePower Cockpit".
2. **Gmail API aktivieren:** *APIs & Services → Library* → „Gmail API" suchen → **Enable**.
3. **OAuth Consent Screen:** *APIs & Services → OAuth consent screen* →
   - User Type: **External**
   - App-Name „ePower Cockpit", Support-E-Mail: `hallo@epowergmbh.at`
   - Scope hinzufügen: `.../auth/gmail.readonly`
   - **Test users:** beide Gmail-Adressen eintragen (Firma + privat).
   > Im Testmodus brauchst du **keine** Google-Verifizierung, solange nur diese Test-User zugreifen.
4. **OAuth-Client erstellen:** *APIs & Services → Credentials → Create Credentials →
   OAuth client ID* →
   - Application type: **Web application**
   - **Authorized redirect URI:** `http://localhost:3000/api/gmail/callback`
     (später zusätzlich die Produktions-URL)
   - → es entstehen **Client ID** und **Client Secret**.
5. **In `.env` eintragen** (Vorlage: [.env.example](../.env.example)):
   ```bash
   GOOGLE_CLIENT_ID="…"
   GOOGLE_CLIENT_SECRET="…"
   GOOGLE_REDIRECT_URI="http://localhost:3000/api/gmail/callback"
   ```

## Verbinden & Synchronisieren (in der App)
Sobald die Code-Seite steht (Phase 1b):

1. App starten (`npm run dev`).
2. Firmen-Postfach verbinden: Aufruf von **`/api/gmail/connect?account=firma`** → bei Google
   mit der **Firmen**-Adresse einloggen → Zugriff erlauben.
3. Privat-Postfach verbinden: **`/api/gmail/connect?account=privat`** → mit der **Privat**-Adresse.
4. **„Sync"** auslösen (`/api/gmail/sync`) → neue Mails werden geladen, klassifiziert und
   erscheinen im [Posteingang](./02-posteingang.md).

## Geplante Code-Bausteine
| Datei / Route | Aufgabe |
|---|---|
| [src/lib/gmail.ts](../src/lib/gmail.ts) | OAuth-Client, `getAuthUrl`, Token-Tausch, `syncMailbox` (via `googleapis`) |
| `GET /api/gmail/connect` | startet den OAuth-Flow (`?account=firma\|privat`) |
| `GET /api/gmail/callback` | tauscht Code → Refresh-Token, speichert es pro Konto |
| `POST /api/gmail/sync` | holt neue Mails → `classifyEmail` → DB → optional Telegram |
| Prisma-Model `GmailAccount` | speichert pro Konto: E-Mail, Refresh-Token, letzte `historyId` |
| `googleapis` (npm) | offizielle Google-/Gmail-Client-Library |

## Sicherheit
- `GOOGLE_CLIENT_SECRET` und Refresh-Tokens stehen **nur** in `.env` / DB, **nie** im Repo.
- Tokens liegen im isolierten Schema `cockpit` (siehe [Supabase-Doku](./10-supabase-datenbank.md)).

## Verwandte Docs
- [KI-Klassifizierung](./03-ki-klassifizierung.md)
- [Firmenrelevanz — auch im Privat-Postfach](./04-firmenrelevanz.md)
- [Telegram-Push](./08-telegram-push.md)
- [Roadmap & Phasen](./11-roadmap.md)
