# Firmenrelevanz — auch im Privat-Postfach

> Teil von **ePower Cockpit** · [‹ Doku-Übersicht](./README.md)

**In einem Satz:** Das Cockpit erkennt Mails, die die Firma betreffen, auch wenn sie im privaten Postfach landen — und macht das in der Oberfläche deutlich sichtbar.

## Was es macht
Steuerberater, Lieferanten- oder Server-Rechnungen kommen oft am privaten E-Mail-Konto an, gehören aber zur Firma. Das Cockpit setzt für solche Mails das Flag `firmenrelevant=true` — unabhängig davon, an welchem Konto sie ankamen. In der Oberfläche werden sie eigens markiert (`↳ Firmenrelevant` + Pille `Privat-Konto`), tauchen im Tab **Firmenrelevant** auf und lösen beim ersten Laden eine Demo-Benachrichtigung aus. So geht keine Firmensache unter, nur weil sie privat reingekommen ist.

## Wie es funktioniert
Das Flag `firmenrelevant` entsteht bei der KI-Klassifizierung in [openai.ts](../src/lib/openai.ts):

- **Im Prompt** weist `buildUserPrompt` die KI explizit an: `"firmenrelevant": true/false – WICHTIG: auch true, wenn die Mail im Privat-Postfach ankommt, aber die Firma betrifft (z. B. Steuerberater, Lieferanten-/Server-Rechnung)`. Das Konto steht der KI als `Konto: ${m.account}` mit im Kontext.
- **Im Regel-Fallback** `heuristic()` (greift ohne `OPENAI_API_KEY`): Startwert ist `firmenrelevant = m.account === "firma"`. Trifft aber ein Schlüsselwort wie `rechnung`, `betrag`, `zahlung`, `steuerberat`, `faktura`, `invoice` (oder `angebot`/`support`-Signale), wird `firmenrelevant = true` gesetzt — auch bei `account === "privat"`. `newsletter`-Treffer setzen es wieder auf `false`.
- **Beim Normalisieren** der KI-Antwort übernimmt `normalize()` das boolean-Feld; fehlt es, gilt `labels.length > 0` als Ersatz.

In der Oberfläche [Cockpit.tsx](../src/components/Cockpit.tsx) wird der Sonderfall `e.account === "privat" && e.firmenrelevant` an mehreren Stellen ausgewertet:

- **`LabelPills`** rendert dann `↳ Firmenrelevant` (Klasse `lab l-cross`) plus die Pille `Privat-Konto` (`pill p-acct privat`) statt der normalen Konto-Pille.
- **E-Mail-Detail** (View `email`) zeigt oben den Hinweis `↳ firmenrelevant — kam im Privat-Postfach an`.
- **Demo-Toast:** Ein `useEffect` sucht nach dem Laden die erste Mail mit `e.account === "privat" && e.firmenrelevant` (`cross`) und ruft nach 1200 ms `pushToast("Firmenrelevant — im Privat-Postfach", ...)`. Ein Klick auf den Toast öffnet diese Mail.
- **Tab „Firmenrelevant"** ist der Default-Tab (`useState<Tab>("firmenrelevant")`). `filtered()` filtert auf `e.firmenrelevant`, der Zähler `counts.firmenrelevant` zeigt die Anzahl.

Die Seed-Daten in [seed.ts](../prisma/seed.ts) liefern die Beispiele: `Steuerberatung XY` (`kanzlei@steuerberatung-xy.at`, `account: "privat"`, `firmenrelevant: true`) und `Hetzner` (`billing@hetzner.com`, `account: "privat"`, `firmenrelevant: true`).

## Beteiligte Dateien
- [src/lib/openai.ts](../src/lib/openai.ts) — `buildUserPrompt` (Prompt-Hinweis), `heuristic()` (Regel-Fallback), `normalize()` (übernimmt das Flag)
- [src/components/Cockpit.tsx](../src/components/Cockpit.tsx) — `LabelPills`, Detail-Hinweis, Demo-Toast, Tab/Filter `firmenrelevant`
- [prisma/seed.ts](../prisma/seed.ts) — Beispiel-Mails Steuerberatung XY und Hetzner (privat + firmenrelevant)

## Datenfluss / API
Das Flag wird gesetzt, wenn eine Mail klassifiziert wird:

- **POST `/api/classify`** mit Body `{ "emailId": "<id>" }` — angestoßen über den Button „Mit KI neu klassifizieren" (`classifyNow`). Antwort enthält u. a. `email` (die aktualisierte Mail inkl. `firmenrelevant`) und `suggestedTodos`.

Die Anzeige selbst liest das gespeicherte Feld `firmenrelevant` der Mail aus **GET `/api/emails`** (`loadEmails`) — es wird im Frontend nur gefiltert und markiert, nicht neu berechnet.

## Erweiterung / Roadmap
- Der Tab **Zuordnen** baut direkt auf `firmenrelevant` auf: `e.firmenrelevant && !e.customerId && !e.filed` — firmenrelevante Privat-Mails landen so automatisch im Zuordnungs-Workflow (siehe [Kunden-Zuordnung](./05-kunden-zuordnung.md)).
- Echte Telegram-Pushes statt Demo-Toast für neu erkannte firmenrelevante Privat-Mails (siehe [Telegram-Push](./08-telegram-push.md)).

## Verwandte Docs
- [KI-Klassifizierung](./03-ki-klassifizierung.md)
- [Posteingang](./02-posteingang.md)
- [Kunden-Zuordnung](./05-kunden-zuordnung.md)
- [Buchhaltung / BMD](./07-buchhaltung-bmd.md)
- [Telegram-Push](./08-telegram-push.md)
