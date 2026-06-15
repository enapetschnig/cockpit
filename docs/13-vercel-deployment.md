# Deployment auf Vercel (24/7-Betrieb)

> Teil von **ePower Cockpit** · [‹ Doku-Übersicht](./README.md)

**In einem Satz:** Das Cockpit als Vercel-App betreiben, damit es auch ohne laufenden
Laptop erreichbar ist und im Hintergrund synct.

## Was anders ist als lokal
- **Kein Dauerprozess:** Der lokale Auto-Sync ([instrumentation.ts](../src/instrumentation.ts))
  ist auf Vercel deaktiviert (`process.env.VERCEL`). Stattdessen triggert ein **Cron**
  ([vercel.json](../vercel.json)) regelmäßig `GET /api/gmail/sync`.
- **Build:** `prisma generate` läuft im Build-Step (siehe `build` in [package.json](../package.json)).
- **DB:** Supabase ist bereits Cloud – `DATABASE_URL` nutzt den Pooler (Port 6543), ideal für Serverless.
- **Keys liegen in Supabase** (Tabelle `Setting`, siehe [config.ts](../src/lib/config.ts)) – nicht als
  Env-Var. Verwaltung in der App unter **`/connect → Einstellungen`**.
- **OAuth-Tokens** liegen ebenfalls in der DB – die verbundenen Postfächer bleiben verbunden;
  **kein** erneutes Verbinden nötig.

## Environment Variables (Vercel → Settings → Environment Variables)
Seit die Keys in Supabase liegen, braucht Vercel nur noch **2 (+1)** Variablen:

| Variable | Pflicht | Hinweis |
|---|---|---|
| `DATABASE_URL` | **ja** | Supabase Pooler, Port 6543, `…&schema=cockpit` (Komma im Passwort als `%2C`) |
| `DIRECT_URL` | **ja** | Supabase Pooler, Port 5432, `…?schema=cockpit` |
| `CRON_SECRET` | empfohlen | sichert `GET /api/gmail/sync`; Vercel sendet ihn automatisch an den Cron |

Alles andere (`OPENAI_API_KEY`, `OPENAI_MODEL`, `GOOGLE_CLIENT_ID/SECRET`, `TELEGRAM_BOT_TOKEN/CHAT_ID`)
wird **in der App** unter `/connect → Einstellungen` gepflegt und in Supabase gespeichert.
`GOOGLE_REDIRECT_URI` entfällt – die Redirect-URI wird automatisch aus der aufgerufenen URL abgeleitet.

## Schritte
1. **Vercel** → *Add New… → Project* → GitHub-Repo `enapetschnig/cockpit` importieren.
2. Die **2 (+1)** Env-Vars eintragen (Framework = Next.js wird erkannt) → **Deploy** → du bekommst
   `https://<name>.vercel.app`.
3. App öffnen → **`/connect → Einstellungen`** → OpenAI-, Google- und Telegram-Keys eintragen → speichern.
   *(Tipp: Die Keys sind aus dem lokalen Setup schon in Supabase – auf Vercel sind sie also
   sofort vorhanden; das Formular brauchst du nur zum Ändern.)*
4. **Google Cloud Console** → OAuth-Client → *Authorized redirect URIs* → zusätzlich
   `https://<name>.vercel.app/api/gmail/callback` eintragen (nötig, falls du auf Vercel neu verbinden willst).
5. Fertig: Sync läuft per Cron + beim Öffnen, Push via Telegram.

## Sync-Frequenz & Vercel-Plan
- [vercel.json](../vercel.json) ist auf `*/5 * * * *` (alle 5 Min) gesetzt.
- **Hobby (gratis):** Cron läuft nur ~**1×/Tag**. Für den interaktiven Gebrauch reicht der
  **Sync-beim-Öffnen**. Für häufigen Hintergrund-Push: **Pro** (Cron bis minütlich) oder ein
  **externer Gratis-Cron** (GitHub Actions / cron-job.org), der `https://<url>/api/gmail/sync`
  mit Header `Authorization: Bearer <CRON_SECRET>` aufruft.

## Verwandte Docs
- [Automatik & KI-Funktionen](./12-automatik-und-ki-funktionen.md)
- [Gmail-Anbindung](./09-gmail-anbindung.md)
- [Supabase-Datenbank](./10-supabase-datenbank.md)
