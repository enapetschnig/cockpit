# Automatik & KI-Funktionen (Sync, Neu-Einordnen, Kundenerkennung)

> Teil von **ePower Cockpit** · [‹ Doku-Übersicht](./README.md)

**In einem Satz:** Das Cockpit hält sich selbst aktuell und nutzt KI, um Mails einzuordnen
und echte Kunden zu erkennen.

## Auto-Sync (immer synchron)
- **Server-seitig:** [src/instrumentation.ts](../src/instrumentation.ts) startet beim Serverstart
  einen Timer, der alle `SYNC_INTERVAL_MS` (Standard **120 s**) den Endpunkt
  [`POST /api/gmail/sync`](../src/app/api/gmail/sync/route.ts) anstößt. Läuft, solange die App
  läuft – auch ohne offenen Browser. (Die Instrumentation importiert `googleapis` bewusst NICHT,
  sondern ruft nur den HTTP-Endpunkt – sonst Bundling-Fehler.)
- **Beim Öffnen:** Das [Cockpit](../src/components/Cockpit.tsx) stößt beim Laden einmal einen Sync an
  und aktualisiert die Liste; zusätzlich lädt es alle 60 s neu. So ist „beim Reingehen" alles frisch.
- Die eigentliche Sync-Logik (Mails holen → klassifizieren → speichern → Telegram) liegt zentral in
  [src/lib/gmailSync.ts](../src/lib/gmailSync.ts) (`runSync`), geteilt von Route und Auto-Sync.

## Alle Mails neu mit KI einordnen
- [`POST /api/classify/all`](../src/app/api/classify/all/route.ts) läuft über alle Mails und ruft pro
  Mail [classifyEmail()](../src/lib/openai.ts) neu auf (Zusammenfassung, Labels, Firmenrelevanz, Priorität).
  Verschickt **keine** Push-Nachrichten.
- Button **„Alle mit KI neu einordnen"** auf [/connect](../src/app/connect/page.tsx). Sinnvoll z. B.
  direkt nachdem ein `OPENAI_API_KEY` gesetzt wurde.

## Kundenerkennung aus Mails
- [`POST /api/customers/detect`](../src/app/api/customers/detect/route.ts) analysiert die Absender der
  **firmenrelevanten** Mails mit KI und entscheidet je Absender: echter **Kunde** (Handwerksbetrieb)
  vs. **kein Kunde** (Dienste/Tools, Lieferanten, Steuerberater, Marktplätze, Newsletter, privat).
- Erkannte Kunden werden als [Customer](./01-datenmodell.md) angelegt und ihre Mails zugeordnet.
- **Harte Regel:** die eigene Firma (`epowergmbh.at`) und die verbundenen Konten werden nie als Kunde
  gewertet. Zuordnung erfolgt robust über die Listen-Nummer (nicht die – evtl. von der KI abgewandelte – Adresse).
- Button **„Kunden aus Mails erkennen & anlegen"** auf [/connect](../src/app/connect/page.tsx).
  > Hinweis: KI-Erkennung ist nicht perfekt – grenzwertige Treffer (Plattformen/Tools) bitte kurz prüfen.

## Verwandte Docs
- [Gmail-Anbindung](./09-gmail-anbindung.md)
- [KI-Klassifizierung](./03-ki-klassifizierung.md)
- [Kunden-Zuordnung](./05-kunden-zuordnung.md)
- [Telegram-Push](./08-telegram-push.md)
