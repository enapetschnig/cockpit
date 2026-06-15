# Kunden-Zuordnung & Kunden-Akte

> Teil von **ePower Cockpit** · [‹ Doku-Übersicht](./README.md)

**In einem Satz:** Firmenrelevante, noch nicht zugeordnete Mails werden mit einem Klick einem Kunden (oder der Buchhaltung) zugewiesen — jeder Kunde bekommt dabei eine Akte mit offenen To-dos und seinen E-Mails.

## Was es macht
Der Tab **Zuordnen** im Posteingang sammelt alle Mails, die firmenrelevant sind, aber noch keinem Kunden zugeordnet und nicht abgelegt wurden. Pro Mail erscheint eine `AssignCard` mit KI-Vorschlägen: Ablage in der Buchhaltung, Zuordnung zu einem bestehenden Kunden oder Anlage eines neuen Kunden. Beim Zuordnen werden optional vorgeschlagene Aufgaben direkt beim Kunden angelegt. In der **Kundenliste** und der **Kunden-Akte** sieht der Inhaber pro Kunde, was noch zu tun ist und welche Mails zugeordnet sind.

## Wie es funktioniert
Der Zuordnen-Filter in [Cockpit.tsx](../src/components/Cockpit.tsx) (`filtered()`, Tab `zuordnen`) zeigt Mails mit `e.firmenrelevant && !e.customerId && !e.filed`; die Anzahl steckt in `counts.zuordnen`. Jede Mail wird als `AssignCard` gerendert.

Die Buttons der `AssignCard` rufen drei Helfer auf, die alle über `assign(emailId, body)` an **POST `/api/assign`** gehen:
- `fileBuch(e)` → `{ fileBuch: true }`
- `assignCustomer(e, customerId)` → `{ customerId, todos }`
- `assignNew(e)` → fragt per `window.prompt` nach dem Namen → `{ newCustomerName, todos }`

Die mitgeschickten `todos` stammen aus `suggested[e.id]` (KI-Vorschlag aus der Klassifizierung) oder dem Fallback `defaultTodos(e)`, der je nach Label (`angebot`, `support`, `termin`) feste Aufgabentexte erzeugt.

In [assign/route.ts](../src/app/api/assign/route.ts) verzweigt `POST` nach Body:
- `fileBuch` → setzt `email.filed = true`.
- `customerId` gesetzt → ordnet die Mail zu (`email.customerId`).
- nur `newCustomerName` → legt via `prisma.customer.create` einen Kunden an (Default-`color` `#2f6df0`) und ordnet zu.
- `todos: string[]` → legt pro Eintrag ein `prisma.todo.create` mit `customerId` und `emailId` an.

Antwort ist stets das aktualisierte `EmailDTO` (`toEmailDTO`). Im Frontend ersetzt `assign` die Mail in `emails` und lädt mit `loadCustomers()` die Kunden neu.

Die **Kundenliste** (`view === "kunden"`) rendert alle Kunden als `kcard`; bei `c.openTodos > 0` erscheint ein Badge „{n} offen". Das Eingabefeld unten ruft `createCustomer()` → **POST `/api/customers`** mit `{ name }`. Die **Kunden-Akte** (`view === "kunde"`) zeigt drei Karten: Kopf, „**Was noch zu tun ist**" (`activeCustomer.todos`, abhakbar via `toggleTodo`) und „**Zugeordnete E-Mails**" (`emails.filter(e => e.customerId === activeCustomer.id)`).

Daten liefert **GET `/api/customers`** in [customers/route.ts](../src/app/api/customers/route.ts): alle Kunden inkl. `todos` und `emails`, serialisiert über `toCustomerDTO`.

## Beteiligte Dateien
- [src/components/Cockpit.tsx](../src/components/Cockpit.tsx) — Tab „Zuordnen", `AssignCard`, `assign`/`assignCustomer`/`assignNew`/`fileBuch`/`defaultTodos`, Kundenliste & Kunden-Akte, `createCustomer`, `toggleTodo`
- [src/app/api/assign/route.ts](../src/app/api/assign/route.ts) — `POST /api/assign` (Buchhaltung / Kunde / neuer Kunde + optionale To-dos)
- [src/app/api/customers/route.ts](../src/app/api/customers/route.ts) — `GET`/`POST /api/customers`, Serialisierung via `toCustomerDTO`

## Datenfluss / API

**POST `/api/assign`** — Request (Varianten, immer mit `emailId`):
- `{ emailId, fileBuch: true }` → in Buchhaltung ablegen (`filed = true`)
- `{ emailId, customerId }` → bestehendem Kunden zuordnen
- `{ emailId, newCustomerName }` → neuen Kunden anlegen + zuordnen
- optional zusätzlich: `{ todos: string[] }` → Aufgaben beim Kunden anlegen

Response: aktualisiertes `EmailDTO`. Fehler: `400` (`emailId fehlt` / `customerId oder newCustomerName fehlt`), `404` (`Mail nicht gefunden`).

**GET `/api/customers`** — Response: Array von `CustomerDTO` (Felder u. a. `id`, `name`, `meta`, `color`, `todos[]`, `openTodos`), sortiert nach `createdAt asc`, `force-dynamic`.

**POST `/api/customers`** — Request: `{ name, meta?, color? }` (Default-`color` `#2f6df0`). Response: `CustomerDTO`. Fehler: `400` (`name fehlt`).

## Erweiterung / Roadmap
- Die Buchhaltungs-Ablage setzt aktuell nur `filed = true`; die echte BMD-Übergabe ist noch offen (siehe [Buchhaltung & BMD](./07-buchhaltung-bmd.md)).
- Kunden-Anlage über `assignNew` nutzt `window.prompt` — ein richtiger Dialog wäre der nächste Schritt.
- Kunden-Stammdaten (`meta`) werden angezeigt, aber im Frontend noch nicht gepflegt.

## Verwandte Docs
- [Datenmodell](./01-datenmodell.md)
- [Posteingang](./02-posteingang.md)
- [KI-Klassifizierung](./03-ki-klassifizierung.md)
- [Firmenrelevanz](./04-firmenrelevanz.md)
- [Aufgaben](./06-aufgaben.md)
- [Buchhaltung & BMD](./07-buchhaltung-bmd.md)
