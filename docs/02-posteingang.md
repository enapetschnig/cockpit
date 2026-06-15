# Posteingang — zwei Konten, Tabs, Mail-Karten

> Teil von **ePower Cockpit** · [‹ Doku-Übersicht](./README.md)

**In einem Satz:** Der Posteingang zeigt die E-Mails beider Konten (Firma + Privat) in einer Liste, lässt sich per Konto-Umschalter und fünf Tabs filtern und stellt jede Mail als Karte mit Avatar, KI-Zusammenfassung und Labels dar.

## Was es macht
Der Posteingang ist die Startansicht des Cockpits. Du wählst oben, ob du **beide Konten**, nur **Firma** oder nur **Privat** siehst. Darunter filtern fünf Tabs die Liste — z. B. nur Firmenrelevantes, nur Wichtiges oder nur noch zuzuordnende Mails. Jeder Tab zeigt einen Live-Zähler, der sich nach dem gewählten Konto richtet. Eine Mail tippst du an, um die Detailansicht mit vollem Text, KI-Analyse und Zuordnungs-Buttons zu öffnen.

## Wie es funktioniert
Beim Laden holt [Cockpit.tsx](../src/components/Cockpit.tsx) die Mails über `loadEmails()` von `GET /api/emails` und legt sie im State `emails` ab; parallel laufen `loadCustomers()` und das Lade-Flag `loading`.

**Konto-Umschalter:** Der State `acc` (Typ `Acc = "alle" | "firma" | "privat"`) wird über die drei Buttons im `.accts`-Block gesetzt. Die Helferfunktion `inAcc(e)` (true bei `acc === "alle"` oder `e.account === acc`) erzeugt die Vorauswahl `visible = emails.filter(inAcc)`.

**Live-Zähler:** Das Objekt `counts` wird aus `visible` berechnet — `firmenrelevant` (`e.firmenrelevant`), `wichtig` (`e.priority === "hi"`), `buchhaltung` (`!e.filed && e.labels.includes("buchhaltung")`), `zuordnen` (`e.firmenrelevant && !e.customerId && !e.filed`) und `alle` (`visible.length`). Die Zahl steht im Tab-Button (`counts[t.id]`); `counts.wichtig` füllt zusätzlich das Glocken-Badge oben rechts.

**Tabs & Filterlogik:** Der State `tab` (Typ `Tab`) steuert `filtered()`. Die Funktion startet bei `visible` und schränkt je Tab weiter ein — `firmenrelevant`, `wichtig`, `buchhaltung` (`e.labels.includes("buchhaltung")`) und `zuordnen`; der Tab `alle` lässt `visible` unverändert. Achtung: Der Tab-Filter `buchhaltung` prüft (anders als `counts.buchhaltung`) nicht `filed`.

**MailCard:** Die Komponente `MailCard` rendert pro Mail eine Karte. `colorFor(e)` liefert die Avatar-Farbe (Kundenfarbe `e.customer.color` oder ein aus `e.fromName` gehashter Wert aus `PALETTE`), `initials(e.fromName)` die zwei Großbuchstaben. `timeAgo(e.receivedAt)` formatiert relativ ("Min" / "Std" / "Tg", sonst Datum `de-AT`). `e.summary` erscheint mit "KI"-Badge; `LabelPills` zeigt Konto-Pill, Cross-Hinweis (`↳ Firmenrelevant` bei Privat-Mail mit `firmenrelevant`), die Labels aus [labels.ts](../src/lib/labels.ts) (`LABELS`) sowie Kunden-/Buchhaltungs-/„offen"-Status. Der Punkt `.reldot` nutzt `e.priority`.

**Sonderfall Tab „Zuordnen":** Statt `MailCard` rendert die Liste `AssignCard` mit KI-Vorschlags-Buttons (Buchhaltung, erste zwei Kunden, neuer Kunde) — Details siehe [05-kunden-zuordnung.md](./05-kunden-zuordnung.md).

**Detailansicht:** `openEmail(id)` setzt `activeEmailId` und `view = "email"`. Die Overlay-`div.view.open` zeigt Absender, vollen `body`, eine KI-Karte (`summary` + Labels + Button „Mit KI neu klassifizieren" → `classifyNow`) und die Zuordnungs-/Aktions-Buttons.

## Beteiligte Dateien
- [src/components/Cockpit.tsx](../src/components/Cockpit.tsx) — gesamte UI: State `acc`/`tab`/`view`, `counts`, `filtered()`, `MailCard`, `LabelPills`, Detailansicht
- [src/app/api/emails/route.ts](../src/app/api/emails/route.ts) — `GET /api/emails`, liefert `EmailDTO[]` sortiert nach `receivedAt desc`
- [src/lib/labels.ts](../src/lib/labels.ts) — zentrales `LABELS`-Mapping (Key → Text + CSS-Klasse) für die Label-Pills
- [src/lib/serialize.ts](../src/lib/serialize.ts) — `toEmailDTO()`, wandelt Prisma-`Email` in das `EmailDTO`-Format (u. a. `labelsJson` → `labels[]`)
- [src/lib/types.ts](../src/lib/types.ts) — Typdefinition `EmailDTO`, `Priority`

## Datenfluss / API
**GET `/api/emails`** — `force-dynamic`, ohne Parameter. Liest alle Mails via Prisma (`orderBy receivedAt desc`, `include: customer`) und gibt `EmailDTO[]` zurück.

Felder je `EmailDTO`: `id`, `account` (`"firma"` | `"privat"`), `fromAddr`, `fromName`, `subject`, `body`, `receivedAt` (ISO-String), `summary` (`string | null`), `labels` (`string[]`), `firmenrelevant` (`boolean`), `priority` (`"hi" | "mid" | "lo"`), `filed` (`boolean`), `customerId` (`string | null`), `customer` (`{ id, name, meta, color } | null`).

Die Konto- und Tab-Filterung passiert vollständig **clientseitig** in `Cockpit.tsx` — der Endpunkt liefert immer alle Mails.

## Erweiterung / Roadmap
- Der Bottom-Nav verweist auf noch nicht gebaute Bereiche: „Heute" (Kalender, Phase 2) und „Rechnungen" (Angebote & Rechnungen, Phase 4) — beide lösen aktuell nur einen Toast aus.
- „KI-Antwort entwerfen" in der Detailansicht zeigt laut Code-Toast: „Antwort-Entwurf kommt in einer späteren Phase."
- Serverseitige Filterung/Pagination ist noch nicht vorhanden (alle Mails kommen ungefiltert).

## Verwandte Docs
- [01-datenmodell.md](./01-datenmodell.md)
- [03-ki-klassifizierung.md](./03-ki-klassifizierung.md)
- [04-firmenrelevanz.md](./04-firmenrelevanz.md)
- [05-kunden-zuordnung.md](./05-kunden-zuordnung.md)
- [07-buchhaltung-bmd.md](./07-buchhaltung-bmd.md)
