# Buchhaltung / BMD-Ablage

> Teil von **ePower Cockpit** · [‹ Doku-Übersicht](./README.md)

**In einem Satz:** Rechnungen, Belege und Steuerberater-Mails landen per Knopfdruck im Buchhaltungs-Stapel und werden als „in Buchhaltung ✓" abgehakt.

## Was es macht
Mails, die die KI als buchhaltungsrelevant erkennt (Label `buchhaltung`), erscheinen im Tab **Buchhaltung** und bekommen im Zuordnen-Vorschlag einen eigenen Button **→ Buchhaltung / BMD**. Ein Klick legt die Mail ab: Sie ist damit erledigt und trägt fortan das Kennzeichen „in Buchhaltung ✓". Es wird (Phase 1) noch nichts an BMD übermittelt — die Mail wird nur intern als abgelegt markiert. Der echte BMD-Export ist Roadmap (Phase 5).

## Wie es funktioniert
- Die KI/Heuristik vergibt das Label `buchhaltung` (z. B. bei Rechnung, Beleg, Steuerberater) — siehe [03-ki-klassifizierung.md](./03-ki-klassifizierung.md). Gespeichert wird es im Feld `labelsJson` der `Email` ([schema.prisma](../prisma/schema.prisma)).
- Der Button **→ Buchhaltung / BMD** wird nur gerendert, wenn `e.labels.includes("buchhaltung")` zutrifft. Er erscheint in der `AssignCard` (Tab „Zuordnen") und in der E-Mail-Detailansicht ([Cockpit.tsx](../src/components/Cockpit.tsx)).
- Klick ruft `fileBuch(e)` → `assign(e.id, { fileBuch: true })` → `POST /api/assign` ([Cockpit.tsx](../src/components/Cockpit.tsx)).
- Die Route [assign/route.ts](../src/app/api/assign/route.ts) erkennt `body.fileBuch` und setzt `data: { filed: true }` auf der `Email`. Zurück kommt das aktualisierte Email-DTO (`toEmailDTO`), das den lokalen State ersetzt.
- Das boolesche Feld `filed` ([schema.prisma](../prisma/schema.prisma), Default `false`) ist die einzige persistente Spur der Ablage.
- **Tab-Zähler:** `counts.buchhaltung` zählt `!e.filed && e.labels.includes("buchhaltung")` — also offene, noch nicht abgelegte Buchhaltungs-Mails. (Hinweis: die Liste `filtered()` im Tab „Buchhaltung" filtert nur auf `labels.includes("buchhaltung")`, zeigt also auch bereits abgelegte Mails.)
- **Anzeige:** In `LabelPills` erscheint die Pille `in Buchhaltung ✓` (Klasse `l-buch`), sobald `e.filed` true ist und kein Kunde zugeordnet wurde ([Cockpit.tsx](../src/components/Cockpit.tsx)).

## Beteiligte Dateien
- [../src/app/api/assign/route.ts](../src/app/api/assign/route.ts) — `POST /api/assign`; setzt bei `fileBuch:true` das Feld `filed=true`.
- [../src/components/Cockpit.tsx](../src/components/Cockpit.tsx) — Button „→ Buchhaltung / BMD", `fileBuch()`/`assign()`, Tab-Zähler `counts.buchhaltung`, Pille „in Buchhaltung ✓".
- [../prisma/schema.prisma](../prisma/schema.prisma) — `Email.filed` (Boolean) und `Email.labelsJson` (JSON-Array der Labels).

## Datenfluss / API
**Request** — `POST /api/assign`
```json
{ "emailId": "<cuid>", "fileBuch": true }
```
**Response** — `200` mit dem aktualisierten Email-DTO (u. a. `filed: true`).

Fehlerfälle: `400` wenn `emailId` fehlt, `404` wenn die Mail nicht existiert.
Hinweis: Dieselbe Route bedient auch die Kunden-Zuordnung (`customerId` / `newCustomerName`, optional `todos`) — siehe [05-kunden-zuordnung.md](./05-kunden-zuordnung.md). Der Zweig `fileBuch` ist davon getrennt und legt nur ab.

## Erweiterung / Roadmap
- **Phase 5 — Buchhaltung + BMD-Upload:** Statt nur `filed=true` zu setzen, soll der Beleg tatsächlich an BMD exportiert/hochgeladen werden (siehe [README.md](../README.md) und [11-roadmap.md](./11-roadmap.md)).
- Noch nicht im Code: getrennte Anzeige von offenen vs. bereits abgelegten Buchhaltungs-Mails, Rückgängig-Funktion, Beleg-Metadaten (Betrag/Datum/UID).

## Verwandte Docs
- [03-ki-klassifizierung.md](./03-ki-klassifizierung.md)
- [05-kunden-zuordnung.md](./05-kunden-zuordnung.md)
- [01-datenmodell.md](./01-datenmodell.md)
- [11-roadmap.md](./11-roadmap.md)
