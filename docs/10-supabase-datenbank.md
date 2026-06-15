# Supabase-Datenbank — isoliertes Schema `cockpit`

> Teil von **ePower Cockpit** · [‹ Doku-Übersicht](./README.md)

**In einem Satz:** Das Cockpit speichert seine Daten in deinem bestehenden Supabase-Projekt `epowergmbh` — aber in einem **eigenen Schema `cockpit`**, völlig getrennt von der bereits laufenden Demo-/Feldservice-App.

## Warum ein eigenes Schema?
In deinem Supabase-Projekt läuft bereits eine App (Tabellen wie `projects`, `employees`,
`time_entries`, `calendar_events` … alle im Standard-Schema **`public`**).
Damit unsere Cockpit-Tabellen da **nichts** stören, legen wir sie in ein separates
PostgreSQL-Schema **`cockpit`**. Beide Apps teilen sich dieselbe Datenbank, sehen sich
aber gegenseitig nicht. Die Demo-App wird **nie angefasst**.

```
Supabase-Projekt "epowergmbh"
├─ public/      ← bestehende Demo-App  (UNANGETASTET)
└─ cockpit/     ← ePower Cockpit        (Customer · Email · Todo)
```

Das Schema `cockpit` wurde bereits angelegt. Prisma erzeugt die Tabellen darin, sobald
du `npm run setup` ausführst (siehe unten).

## Verbindung (zwei URLs)
Konfiguriert über zwei Connection-Strings in `.env` (Vorlage: [.env.example](../.env.example)):

| Variable | Zweck | Host / Port |
|---|---|---|
| `DATABASE_URL` | App-Laufzeit | Pooler · **Port 6543** (Transaction) · `?pgbouncer=true&connection_limit=1` |
| `DIRECT_URL` | Migrationen / `prisma db push` | Pooler · **Port 5432** (Session) |

Beide nutzen den Supabase-Pooler `aws-1-eu-west-2.pooler.supabase.com` mit User
`postgres.xyhgckqxowqnzjtoblfs`. Die Schema-Wahl `?schema=cockpit` hängt an beiden URLs —
dadurch landet **alles** automatisch im Schema `cockpit`. Verdrahtet in
[prisma/schema.prisma](../prisma/schema.prisma) (`url` + `directUrl`).

## Einrichtung (einmalig)

1. **Passwort holen** — Supabase-Dashboard → *Project Settings → Database → Database password*.
   > ⚠️ „Reset" erzeugt ein neues Passwort und ändert es **auch für die Demo-App**. Wenn du
   > das Original nicht mehr hast, danach den Connection-String der Demo-App ebenfalls anpassen.
2. **`.env` anlegen** und in **beiden** URLs `[DEIN-DB-PASSWORT]` ersetzen:
   ```bash
   cp .env.example .env
   # DATABASE_URL und DIRECT_URL: [DEIN-DB-PASSWORT] eintragen
   ```
3. **Tabellen erzeugen + Beispiel-Daten laden:**
   ```bash
   npm run setup     # prisma generate + prisma db push + seed
   ```
   `db push` legt `Customer`, `Email`, `Todo` im Schema `cockpit` an; `seed` füllt 3 Kunden
   und 8 Beispiel-Mails (inkl. der „Privat→Firma"-Mails).
4. **Starten:** `npm run dev` → http://localhost:3000

## Nützliche Befehle
| Befehl | Wirkung |
|---|---|
| `npm run setup` | Client generieren + Tabellen pushen + seeden |
| `npm run db:push` | Schema-Änderungen nach `cockpit` übernehmen |
| `npm run db:reset` | **Nur die `cockpit`-Tabellen** zurücksetzen + neu seeden (Demo bleibt unberührt) |
| `npm run db:seed` | Beispiel-Daten neu laden |

> `db:reset` (`prisma db push --force-reset`) wirkt nur auf das in der URL gewählte Schema
> `cockpit`. Die `public`-Tabellen der Demo-App sind davon nicht betroffen.

## Prüfen, dass die Isolation steht
Im Supabase-SQL-Editor:
```sql
select table_schema, table_name
from information_schema.tables
where table_schema = 'cockpit'
order by 2;          -- erwartet: Customer, Email, Todo
```

## Sicherheit
- `.env` enthält das DB-Passwort und steht in [.gitignore](../.gitignore) — wird **nie** nach
  GitHub gepusht. Eingecheckt wird nur `.env.example` (ohne echte Werte).
- Der Supabase **Access-Token** (Management-API) gehört nicht in die App und nicht ins Repo.

## Verwandte Docs
- [Architektur & Stack](./00-architektur.md)
- [Datenmodell — Customer · Email · Todo](./01-datenmodell.md)
- [Gmail-Anbindung](./09-gmail-anbindung.md)
