# Deployment auf Vercel (24/7-Betrieb)

> Teil von **ePower Cockpit** · [‹ Doku-Übersicht](./README.md)

**In einem Satz:** Das Cockpit als Vercel-App betreiben, damit es auch ohne laufenden
Laptop erreichbar ist und im Hintergrund synct.

## Was anders ist als lokal
- **Kein Dauerprozess:** Der lokale Auto-Sync ([instrumentation.ts](../src/instrumentation.ts))
  ist auf Vercel deaktiviert (`process.env.VERCEL`). Stattdessen triggert ein **Cron**
  ([vercel.json](../vercel.json)) regelmäßig `GET /api/gmail/sync`.
- **Build:** `prisma generate` läuft im Build-Step (siehe `build` in [package.json](../package.json)),
  weil Vercel Dependencies cached.
- **DB:** Supabase ist bereits Cloud – `DATABASE_URL` nutzt den Pooler (Port 6543), ideal für Serverless.
- **OAuth-Tokens** liegen in der DB (Schema `cockpit`) – die verbundenen Postfächer bleiben also
  auch auf Vercel verbunden; **kein** erneutes Verbinden nötig.

## Environment Variables (Vercel → Project → Settings → Environment Variables)
Die **Namen** (Werte aus deiner lokalen `.env` übernehmen – Secrets nie ins Repo!):

| Variable | Quelle / Hinweis |
|---|---|
| `DATABASE_URL` | Supabase Pooler, Port 6543, `…&schema=cockpit` (Komma im Passwort als `%2C`) |
| `DIRECT_URL` | Supabase Pooler, Port 5432, `…?schema=cockpit` |
| `OPENAI_API_KEY` | OpenAI-Key |
| `OPENAI_MODEL` | `gpt-4o-mini` |
| `GOOGLE_CLIENT_ID` | Google OAuth-Client |
| `GOOGLE_CLIENT_SECRET` | Google OAuth-Client |
| `GOOGLE_REDIRECT_URI` | **`https://<DEINE-VERCEL-URL>/api/gmail/callback`** (nach dem ersten Deploy setzen) |
| `TELEGRAM_BOT_TOKEN` | Telegram-Bot |
| `TELEGRAM_CHAT_ID` | deine Chat-ID |
| `CRON_SECRET` | Zufallswert – sichert den Cron-Endpunkt (Vercel sendet ihn automatisch mit) |

`SYNC_INTERVAL_MS` wird auf Vercel **nicht** gebraucht (Cron übernimmt).

## Schritte
1. **Vercel** → *Add New… → Project* → GitHub-Repo `enapetschnig/cockpit` importieren.
2. Framework wird als **Next.js** erkannt. Erst mal **ohne** `GOOGLE_REDIRECT_URI` deployen
   (oder Platzhalter) → du bekommst eine URL `https://<name>.vercel.app`.
3. Alle Env-Vars eintragen, `GOOGLE_REDIRECT_URI` mit der echten URL setzen → **Redeploy**.
4. In der **Google Cloud Console** beim OAuth-Client unter *Authorized redirect URIs*
   zusätzlich `https://<name>.vercel.app/api/gmail/callback` eintragen.
5. Fertig: App unter der Vercel-URL öffnen. Sync läuft per Cron + beim Öffnen.

## Sync-Frequenz & Vercel-Plan
- [vercel.json](../vercel.json) ist auf `*/5 * * * *` (alle 5 Min) gesetzt.
- **Hobby (gratis):** Cron läuft nur ~**1×/Tag**. Für den interaktiven Gebrauch reicht der
  **Sync-beim-Öffnen** (im Cockpit eingebaut). Für häufigen Hintergrund-Push entweder **Pro**
  (Cron bis minütlich) oder ein **externer Gratis-Cron** (GitHub Actions / cron-job.org), der
  `https://<url>/api/gmail/sync` mit Header `Authorization: Bearer <CRON_SECRET>` aufruft.

## Verwandte Docs
- [Automatik & KI-Funktionen](./12-automatik-und-ki-funktionen.md)
- [Gmail-Anbindung](./09-gmail-anbindung.md)
- [Supabase-Datenbank](./10-supabase-datenbank.md)
