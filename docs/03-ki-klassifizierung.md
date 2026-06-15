# KI-Klassifizierung — OpenAI + Regel-Fallback

> Teil von **ePower Cockpit** · [‹ Doku-Übersicht](./README.md)

**In einem Satz:** Jede E-Mail wird automatisch zusammengefasst, mit Labels versehen, als firmenrelevant/privat eingestuft, priorisiert und mit Aufgabenvorschlägen versehen — per OpenAI, oder ohne API-Key über einfache Stichwort-Regeln.

## Was es macht
Aus Absender, Betreff und Text einer Mail entsteht ein strukturiertes Ergebnis: ein deutscher Ein-Satz-Überblick (`summary`), passende `labels`, die Einstufung `firmenrelevant` (true/false), eine `priority` (`hi`/`mid`/`lo`) und konkrete Aufgabenvorschläge (`suggestedTodos`). Ist ein OpenAI-Key hinterlegt, übernimmt das KI-Modell die Einordnung. Fehlt der Key oder schlägt der Aufruf fehl, greift automatisch ein Regel-Fallback, damit die App immer funktioniert. Das Ergebnis lässt sich jederzeit per Button in der Mail-Ansicht neu berechnen.

## Wie es funktioniert
Kernfunktion ist `classifyEmail()` in [openai.ts](../src/lib/openai.ts). Sie bekommt `MailInput` (`account`, `fromName`, `fromAddr`, `subject`, `body`) und liefert ein `ClassifyResult`.

- **Mit Key:** Ist `OPENAI_API_KEY` gesetzt, ruft sie `client.chat.completions.create` mit dem Modell aus `OPENAI_MODEL` (Default `gpt-4o-mini`), `temperature: 0.2` und `response_format: { type: "json_object" }` auf. Als Nachrichten gehen der `SYSTEM_PROMPT` (Kontext: ePower GmbH, Software für Handwerker, nur gültiges JSON) und der per `buildUserPrompt()` gebaute User-Prompt mit. Der Prompt fordert exakt die Felder `summary`, `labels`, `firmenrelevant`, `priority`, `suggestedTodos` an.
- **Validierung:** Die rohe Antwort wird mit `JSON.parse` gelesen und durch `normalize()` geprüft. Dort werden nur Labels übernommen, die in `ALL_LABEL_KEYS` (aus [labels.ts](../src/lib/labels.ts)) vorkommen; eine ungültige `priority` fällt auf `mid` zurück; fehlt eine `summary`, springt `fallbackSummary()` ein (gekürzter Body bzw. Betreff). Ist `firmenrelevant` kein Boolean, gilt es als true, sobald mindestens ein Label gesetzt ist.
- **Ohne Key / bei Fehler:** Es läuft `heuristic()` — eine Stichwort-Suche über `subject + body + fromAddr`. Begriffe wie `rechnung`/`steuerberat` setzen `buchhaltung`, `angebot`/`anfrage` setzen `angebot` + `aufgabe`, `bug`/`support`/`problem` setzen `support` + `aufgabe` und `priority = "hi"`. Mails im Konto `firma` gelten von Haus aus als firmenrelevant; ohne Firmen-Signale wird `privat` mit Priorität `lo` vergeben. Passende `suggestedTodos` (z. B. „Angebot vorbereiten") werden aus den Labels abgeleitet.

Der Endpunkt [classify/route.ts](../src/app/api/classify/route.ts) (`POST /api/classify`) lädt die Mail per `prisma.email.findUnique`, ruft `classifyEmail()`, speichert `summary`, `labelsJson` (JSON-String), `firmenrelevant`, `priority` und `classifiedAt` per `prisma.email.update` und gibt die aktualisierte Mail (`toEmailDTO`) plus `suggestedTodos` zurück.

In der UI löst der Button „Mit KI neu klassifizieren" die Funktion `classifyNow()` in [Cockpit.tsx](../src/components/Cockpit.tsx) aus, die `/api/classify` mit `{ emailId }` aufruft und die Mail sowie die Aufgabenvorschläge im State aktualisiert.

## Beteiligte Dateien
- [openai.ts](../src/lib/openai.ts) — `classifyEmail()`, `SYSTEM_PROMPT`, `buildUserPrompt()`, `normalize()`, `heuristic()`, `fallbackSummary()`
- [classify/route.ts](../src/app/api/classify/route.ts) — Endpunkt `POST /api/classify`, speichert das Ergebnis
- [labels.ts](../src/lib/labels.ts) — `LABELS` und `ALL_LABEL_KEYS` (gemeinsame Label-Definition für KI und UI)
- [types.ts](../src/lib/types.ts) — `ClassifyResult`, `Priority`, `EmailDTO`
- [Cockpit.tsx](../src/components/Cockpit.tsx) — Button „Mit KI neu klassifizieren" / `classifyNow()`

## Datenfluss / API
**POST** `/api/classify`

- **Request:** `{ "emailId": string }` — fehlt `emailId`, kommt `400` („emailId fehlt"); ist die Mail unbekannt, `404` („Mail nicht gefunden").
- **Response:** `{ "email": EmailDTO, "suggestedTodos": string[] }` — die Mail enthält danach `summary`, `labels`, `firmenrelevant`, `priority` und `classifiedAt`.

`ClassifyResult`-Felder: `summary` (string), `labels` (string[]), `firmenrelevant` (boolean), `priority` (`"hi" | "mid" | "lo"`), `suggestedTodos` (string[]).

Verfügbare Label-Keys (aus `LABELS`): `buchhaltung`, `angebot`, `aufgabe`, `support`, `termin`, `newsletter`, `privat`.

## Erweiterung / Roadmap
- Modellwechsel ohne Codeänderung über `OPENAI_MODEL` möglich (Default `gpt-4o-mini`).
- Neue Labels lassen sich zentral in [labels.ts](../src/lib/labels.ts) ergänzen; KI-Prompt und UI nutzen sie automatisch über `ALL_LABEL_KEYS`.
- Weitere geplante Schritte siehe [Roadmap](./11-roadmap.md).

## Verwandte Docs
- [Architektur](./00-architektur.md)
- [Posteingang](./02-posteingang.md)
- [Firmenrelevanz](./04-firmenrelevanz.md)
- [Kunden-Zuordnung](./05-kunden-zuordnung.md)
- [Aufgaben](./06-aufgaben.md)
- [Roadmap](./11-roadmap.md)
