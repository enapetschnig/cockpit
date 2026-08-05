# ePower CRM (Lovable-App, 1:1) – im Cockpit-Repo

Eigenständige Vite/React-App. Wird als **separates Vercel-Projekt** deployt
(nicht Teil des Next.js-Cockpit-Builds; per tsconfig `exclude` + `.eslintignore` ausgeklammert).

## Backend
Nutzt das **Cockpit-Supabase** (Projekt „epowergmbh", ref `xyhgckqxowqnzjtoblfs`),
Schema **`crm`** (via `db: { schema: 'crm' }` in `src/integrations/supabase/client.ts`).
Login = gleicher Cockpit-Login. Daten gehören `napetschnig.chris@gmail.com`.

## Vercel-Projekt anlegen
- Repo: `enapetschnig/cockpit`, **Root Directory: `crm-app`**
- Framework: Vite, Build: `npm run build`, Output: `dist`
- Env-Variablen:
  - `VITE_SUPABASE_URL`   = https://xyhgckqxowqnzjtoblfs.supabase.co
  - `VITE_SUPABASE_PUBLISHABLE_KEY` = <anon/publishable key des Cockpit-Supabase>
- Domain: `app.epowergmbh.at`

## Offen (für volle 1:1-Funktion)
- Edge Functions `import-lead`, `transcribe-summarize`, `mcp` müssen ins
  Cockpit-Supabase deployt werden (sonst brechen Auto-Lead-Import + Sprachnotiz).
- Make.com-Webhook auf die neue `import-lead`-URL umstellen.
