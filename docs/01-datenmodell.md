# Datenmodell — Customer · Email · Todo

> Teil von **ePower Cockpit** · [‹ Doku-Übersicht](./README.md)

**In einem Satz:** Drei Prisma-Modelle (`Customer`, `Email`, `Todo`) bilden die gesamte Datenbasis des E-Mail-Cockpits ab und werden über DTO-Mapper sauber an die Oberfläche geliefert.

## Was es macht
Jede eingehende Mail wird als `Email`-Datensatz gespeichert — mit Quell-Postfach, KI-Feldern (Zusammenfassung, Labels, Firmenrelevanz, Priorität) und Workflow-Status. Mails lassen sich einem `Customer` (Kunde) zuordnen, und aus Mails entstehende Aufgaben werden als `Todo` festgehalten. Die Tabellen liegen im isolierten Supabase-Schema **`cockpit`**, getrennt von der bestehenden App im `public`-Schema.

## Wie es funktioniert
Das Schema steht in [schema.prisma](../prisma/schema.prisma). Drei Modelle:

**`Customer`** — `id`, `name`, `meta` (kurze Beschreibung), `color` (Avatar-Akzentfarbe), `createdAt`. Relationen: `emails` (1:n) und `todos` (1:n).

**`Email`** — Kernmodell. Stammfelder: `id`, `account` (`"firma" | "privat"`), `fromAddr`, `fromName`, `subject`, `body`, `receivedAt`. KI-befüllt: `summary`, `labelsJson` (Default `"[]"`), `firmenrelevant` (Default `false`, wird auch für Privat-Mails gesetzt), `priority` (`"hi" | "mid" | "lo"`, Default `"mid"`), `classifiedAt`. Workflow: `filed` (in Buchhaltung abgelegt, Default `false`), `customerId` + Relation `customer`, sowie `todos` (1:n).

**`Todo`** — `id`, `text`, `done` (Default `false`), `createdAt`, optionale Relationen `customerId`/`customer` und `emailId`/`email`. Ein Todo kann also an einen Kunden und/oder an eine Mail hängen.

**`labelsJson` ↔ `string[]`:** In der DB sind Labels ein JSON-String-Array (z. B. `["buchhaltung","aufgabe"]`). Beim Mapping wandelt die Hilfsfunktion `safeLabels` in [serialize.ts](../src/lib/serialize.ts) diesen String per `JSON.parse` in ein `string[]` um — bei kaputtem JSON oder Nicht-Array liefert sie `[]` zurück (try/catch + `Array.isArray`-Prüfung). So kann ein fehlerhafter Wert die Oberfläche nie crashen.

**DTO-Mapping:** Die API gibt nie rohe Prisma-Objekte aus, sondern DTOs (definiert in [types.ts](../src/lib/types.ts)).
- `toEmailDTO(e)` in [serialize.ts](../src/lib/serialize.ts) erzeugt ein `EmailDTO`: `receivedAt` wird via `toISOString()` zum String, `labelsJson` wird über `safeLabels` zu `labels: string[]`, und `customer` wird (falls vorhanden) auf `{ id, name, meta, color }` reduziert, sonst `null`.
- `toCustomerDTO(c)` erzeugt ein `CustomerDTO`: `openTodos` = Anzahl der Todos mit `done === false` (`todos.filter((t) => !t.done).length`), `todos` als schlanke Liste `{ id, text, done }`, und `emailCount` = Länge von `c.emails` (sonst `0`).

`ClassifyResult` in [types.ts](../src/lib/types.ts) ist das Ausgabeformat der KI-Klassifizierung (`summary`, `labels`, `firmenrelevant`, `priority`, `suggestedTodos`) und speist die KI-Felder von `Email`.

## Beteiligte Dateien
- [prisma/schema.prisma](../prisma/schema.prisma) — Definition der Modelle `Customer`, `Email`, `Todo` und ihrer Relationen
- [src/lib/types.ts](../src/lib/types.ts) — TypeScript-Typen `EmailDTO`, `CustomerDTO`, `ClassifyResult`, `Priority`
- [src/lib/serialize.ts](../src/lib/serialize.ts) — `safeLabels`, `toEmailDTO`, `toCustomerDTO`

## Erweiterung / Roadmap
- **Datenbank-Provider:** Die `datasource db` in [schema.prisma](../prisma/schema.prisma) nutzt `provider = "postgresql"`; das Modell läuft auf der Supabase-PostgreSQL im Schema `cockpit`. Verbindung über `url = env("DATABASE_URL")` (Pooler, Port 6543 – App-Laufzeit) und `directUrl = env("DIRECT_URL")` (Port 5432 – Migrationen / db push). Details siehe [Supabase-Datenbank](./10-supabase-datenbank.md).
- Weitere geplante Felder/Modelle sind aus dem aktuellen Code nicht ersichtlich; siehe [Roadmap](./11-roadmap.md).

## Verwandte Docs
- [Architektur](./00-architektur.md)
- [Posteingang](./02-posteingang.md)
- [KI-Klassifizierung](./03-ki-klassifizierung.md)
- [Firmenrelevanz](./04-firmenrelevanz.md)
- [Kunden-Zuordnung](./05-kunden-zuordnung.md)
- [Aufgaben](./06-aufgaben.md)
- [Supabase-Datenbank](./10-supabase-datenbank.md)
