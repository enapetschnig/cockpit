# Aufgaben / To-dos

> Teil von **ePower Cockpit** · [‹ Doku-Übersicht](./README.md)

**In einem Satz:** Aus einer Mail entstehen abhakbare Aufgaben, die immer einem Kunden zugeordnet sind und in der Kunden-Detailansicht erledigt werden.

## Was es macht
Jede Aufgabe (`Todo`) hängt an einem Kunden und meist an der Mail, aus der sie entstanden ist. Beim Zuordnen einer firmenrelevanten Mail zu einem Kunden legt das Cockpit passende Aufgaben gleich automatisch mit an (z. B. „Angebot vorbereiten"). Zusätzlich kann man in der Mail-Detailansicht per „+ Aufgabe erstellen" Aufgaben nachträglich anlegen. Im Kunden-Detail erscheinen alle offenen Aufgaben als Liste, die man per Klick abhaken (und wieder öffnen) kann.

## Wie es funktioniert
Das `Todo`-Modell hat die Felder `text`, `done`, `customerId` und `emailId` (siehe [01-datenmodell.md](./01-datenmodell.md)). Aufgaben werden über drei Wege angelegt bzw. geändert:

**1. Automatisch beim Zuordnen.** In [assign/route.ts](../src/app/api/assign/route.ts) (`POST`) wird, wenn der Body ein `todos: string[]`-Array enthält, für jeden nicht-leeren Eintrag ein `prisma.todo.create({ data: { text, customerId, emailId } })` ausgeführt — die Aufgaben hängen direkt am zugeordneten Kunden und an der Mail.

**2. „+ Aufgabe erstellen" aus der Mail.** In [Cockpit.tsx](../src/components/Cockpit.tsx) ruft der Button (nur sichtbar bei Label `aufgabe`) `makeTask(e)` auf. Die Aufgabentexte kommen aus `suggested[e.id]` (KI-Vorschläge aus der Klassifizierung, siehe [03-ki-klassifizierung.md](./03-ki-klassifizierung.md)) oder als Fallback aus `defaultTodos(e)`. `defaultTodos` mappt Labels auf Texte: `angebot` → „Angebot vorbereiten", `support` → „Problem prüfen & zurückmelden", `termin` → „Termin fixieren". Ist `e.customerId` noch leer, bricht `makeTask` mit einem Hinweis-Toast ab — eine Aufgabe braucht zwingend einen Kunden. Sind keine Texte vorhanden, wird „Follow-up zu: <Betreff>" angelegt. Pro Text geht ein `POST /api/todos` raus.

**3. Abhaken / wieder öffnen.** `toggleTodo(customerId, todoId, done)` schickt ein `PATCH /api/todos`. Die Anzeige wird optimistisch aktualisiert: der lokale `customers`-State setzt `todo.done` und rechnet `openTodos` neu — ohne auf die Server-Antwort zu warten.

**Anzeige.** Im Kunden-Detail (`view === "kunde"`) rendert [Cockpit.tsx](../src/components/Cockpit.tsx) unter „Was noch zu tun ist" `activeCustomer.todos` als `.todo`-Zeilen mit Checkbox; Klick ruft `toggleTodo(...)`. Erledigte bekommen die Klasse `done`.

Serverseitig liegen beide Endpunkte in [todos/route.ts](../src/app/api/todos/route.ts): `POST` validiert `text` (leerer Text → 400) und legt das Todo an; `PATCH` validiert `id` (fehlt → 400) und setzt `done`.

## Beteiligte Dateien
- [src/app/api/todos/route.ts](../src/app/api/todos/route.ts) — `POST` (Aufgabe anlegen) und `PATCH` (abhaken/öffnen)
- [src/app/api/assign/route.ts](../src/app/api/assign/route.ts) — legt beim Zuordnen optional `todos[]` direkt beim Kunden an
- [src/components/Cockpit.tsx](../src/components/Cockpit.tsx) — `makeTask`, `defaultTodos`, `toggleTodo`, Kunden-Detail-Liste
- [prisma/schema.prisma](../prisma/schema.prisma) — `Todo`-Modell (`text`, `done`, `customerId`, `emailId`)

## Datenfluss / API
**POST /api/todos** — Aufgabe anlegen
- Request: `{ text: string, customerId?: string|null, emailId?: string|null }`
- `text` ist Pflicht (getrimmt; leer → `400 { error: "text fehlt" }`)
- Response: das angelegte `Todo`-Objekt

**PATCH /api/todos** — abhaken / wieder öffnen
- Request: `{ id: string, done: boolean }`
- `id` fehlt → `400 { error: "id fehlt" }`
- Response: das aktualisierte `Todo`-Objekt

**POST /api/assign** (Auszug, siehe [05-kunden-zuordnung.md](./05-kunden-zuordnung.md))
- Optionales Feld `todos: string[]` → pro Eintrag ein `Todo` mit `customerId` (der zugeordnete Kunde) und `emailId`

## Erweiterung / Roadmap
- Aufgaben haben bislang kein Fälligkeitsdatum und keine Zuständigkeit — denkbar für eine spätere „Heute"-/Kalender-Ansicht (im UI als „bald" markiert, Phase 2).
- Aufgaben lassen sich derzeit nur anlegen und abhaken, nicht bearbeiten oder löschen.

## Verwandte Docs
- [Datenmodell](./01-datenmodell.md)
- [KI-Klassifizierung](./03-ki-klassifizierung.md)
- [Kunden-Zuordnung](./05-kunden-zuordnung.md)
- [Roadmap](./11-roadmap.md)
