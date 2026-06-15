# Architektur & Stack

> Teil von **ePower Cockpit** · [‹ Doku-Übersicht](./README.md)

**In einem Satz:** Das Cockpit ist eine Next.js-15-Anwendung, in der eine Client-Oberfläche über interne API-Routen mit Prisma auf eine isolierte Supabase-Postgres-Datenbank zugreift.

## Was es macht
Das ePower Cockpit ist der Kontrollhub der ePower GmbH; Phase 1 ist das E-Mail-Cockpit mit KI (Zusammenfassung, Labels, Firmenrelevanz, Kunden-Zuordnung, Push). Technisch ist alles eine einzige Web-App: Bedien-Oberfläche, Server-Logik und Datenbankzugriff laufen im selben Next.js-Projekt. Die Daten liegen in einem eigenen, von der bestehenden Demo-/Feldservice-App getrennten Bereich der Datenbank.

## Wie es funktioniert
Der Stack ist in [package.json](../package.json) festgelegt: **Next.js 15** (`^15.3.3`, App Router), **React 19** (`^19.1.0`), **TypeScript** (`^5.8.3`) sowie **Prisma** (`@prisma/client ^6.8.2`) und das **openai**-SDK (`^4.104.0`).

Der Ablauf ist klar getrennt in Client und Server:

1. **UI (Client):** Einstieg ist [page.tsx](../src/app/page.tsx), die nur die Komponente [Cockpit.tsx](../src/components/Cockpit.tsx) rendert. Cockpit.tsx beginnt mit `"use client"`, läuft also im Browser. Den HTML-Rahmen liefert [layout.tsx](../src/app/layout.tsx) (`lang="de"`, Metadaten `title: "ePower Cockpit"`).
2. **fetch:** Cockpit.tsx ruft die internen API-Routen per `fetch` auf, z. B. `fetch("/api/emails")`, `fetch("/api/customers")` sowie POST/PATCH auf `/api/classify`, `/api/assign`, `/api/todos` und `/api/notify`.
3. **API Route Handler (Server):** Die Endpunkte liegen unter [src/app/api/*](../src/app/api). Beispiel [emails/route.ts](../src/app/api/emails/route.ts): `export async function GET()` lädt per Prisma `prisma.email.findMany(...)` und gibt `NextResponse.json(...)` zurück. Lese-Routen setzen `export const dynamic = "force-dynamic"` (in [emails/route.ts](../src/app/api/emails/route.ts) und [customers/route.ts](../src/app/api/customers/route.ts)), damit Next.js sie nicht statisch zwischenspeichert und immer frische DB-Daten liefert.
4. **Prisma-Singleton:** Alle Routen importieren `prisma` aus [db.ts](../src/lib/db.ts). Dort wird der `PrismaClient` einmalig auf `globalThis` abgelegt (`globalForPrisma.prisma ?? new PrismaClient()`), um im Dev-Hot-Reload nicht zu viele DB-Verbindungen zu öffnen.
5. **Datenbank:** Prisma spricht **Supabase PostgreSQL** an. Die Tabellen liegen im isolierten Schema **`cockpit`**, getrennt vom `public`-Schema der bestehenden Demo-/Feldservice-App (Details in [10-supabase-datenbank.md](./10-supabase-datenbank.md)). Das Datenmodell (`Customer`, `Email`, `Todo`) steht in [schema.prisma](../prisma/schema.prisma).

> Hinweis: Der Kopfkommentar in [schema.prisma](../prisma/schema.prisma) nennt noch SQLite als lokalen Start. Maßgeblich für den Betrieb ist Supabase Postgres im Schema `cockpit`.

**Ordnerstruktur (Kurzfassung):**
- `src/app` — UI-Seiten (`page.tsx`, `layout.tsx`) **und** API-Routen (`api/*/route.ts`)
- `src/components` — Client-Komponente [Cockpit.tsx](../src/components/Cockpit.tsx)
- `src/lib` — Logik & Helfer (DB, OpenAI, Telegram, Gmail, Serialisierung)
- `prisma` — Datenmodell ([schema.prisma](../prisma/schema.prisma))

**Pfad-Alias:** `@/*` zeigt auf `./src/*` (siehe [tsconfig.json](../tsconfig.json), `paths`), daher Importe wie `@/lib/db`. **Strict Mode:** React in [next.config.mjs](../next.config.mjs) (`reactStrictMode: true`), TypeScript `strict: true` in [tsconfig.json](../tsconfig.json).

## Beteiligte Dateien
- [package.json](../package.json) — Abhängigkeiten & Scripts (`dev`, `build`, `db:push`, `db:seed`, `setup`)
- [tsconfig.json](../tsconfig.json) — TS-Konfig, `strict`, Pfad-Alias `@/*`
- [next.config.mjs](../next.config.mjs) — Next-Konfig (`reactStrictMode`)
- [src/app/layout.tsx](../src/app/layout.tsx) — Root-Layout, Metadaten, `lang="de"`
- [src/app/page.tsx](../src/app/page.tsx) — Einstiegsseite, rendert Cockpit
- [src/components/Cockpit.tsx](../src/components/Cockpit.tsx) — Client-UI, `fetch` an die API
- [src/app/api/emails/route.ts](../src/app/api/emails/route.ts) — Beispiel-Route (GET, `force-dynamic`)
- [src/lib/db.ts](../src/lib/db.ts) — Prisma-Singleton
- [prisma/schema.prisma](../prisma/schema.prisma) — Datenmodell `Customer` / `Email` / `Todo`

## Datenfluss / API
Client → interne Route Handler → Prisma → Supabase Postgres (Schema `cockpit`):

- `GET /api/emails` — alle E-Mails (sortiert `receivedAt desc`, inkl. `customer`), als DTO via `toEmailDTO`
- `GET|POST /api/customers` — Kunden lesen / anlegen
- `POST /api/classify` — KI-Klassifizierung einer E-Mail (`{ emailId }`)
- `POST /api/assign` — Kunden-Zuordnung (`{ emailId, ... }`)
- `POST|PATCH /api/todos` — Aufgaben anlegen / abhaken (`{ id, done }`)
- `POST /api/notify` — Telegram-Push (`{ text }`)

Antworten werden durchgehend als JSON (`NextResponse.json`) geliefert.

## Erweiterung / Roadmap
- Endgültige Umstellung von `schema.prisma` (Provider `postgresql`, `cockpit`-Schema) als alleinige Quelle der Wahrheit (siehe [10-supabase-datenbank.md](./10-supabase-datenbank.md)).
- Weitere Phasen über das E-Mail-Cockpit hinaus (siehe [11-roadmap.md](./11-roadmap.md)).

## Verwandte Docs
- [Datenmodell](./01-datenmodell.md)
- [Posteingang](./02-posteingang.md)
- [KI-Klassifizierung](./03-ki-klassifizierung.md)
- [Supabase-Datenbank](./10-supabase-datenbank.md)
- [Roadmap](./11-roadmap.md)
