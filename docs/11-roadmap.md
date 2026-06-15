# Roadmap & Phasen

> Teil von **ePower Cockpit** · [‹ Doku-Übersicht](./README.md)

**In einem Satz:** Was heute schon läuft (Phase 1: E-Mail-Cockpit mit KI auf Seed-Daten) und welche Schritte als Nächstes kommen — von der echten Gmail-Anbindung bis zu Kalender, Rechnungen und Buchhaltung.

## Was es macht

Phase 1 ist gebaut und nutzbar: zwei Postfächer (Firma/Privat), KI-Klassifizierung pro Mail, Firmenrelevanz, Kunden-Zuordnung, Aufgaben und ein Telegram-Testknopf. Alles läuft aktuell auf **Seed-Daten** in der Datenbank, nicht auf echten Gmail-Postfächern. Die folgenden Phasen sind als Plan im Code und im [README.md](../README.md) hinterlegt — hier steht nur, was wirklich vorbereitet bzw. dokumentiert ist. In der UI sind zwei kommende Bereiche schon als „bald" sichtbar.

## Wie es funktioniert

**Heute (Phase 1, fertig):** Die UI [Cockpit.tsx](../src/components/Cockpit.tsx) lädt Mails (`loadEmails`) und Kunden (`loadCustomers`), klassifiziert über `classifyNow` → `POST /api/classify`, ordnet über `assign` → `POST /api/assign` zu, legt Aufgaben mit `makeTask` an und testet Telegram mit `testPush` → `POST /api/notify`.

**Bottom-Nav „bald"-Marker:** In [Cockpit.tsx](../src/components/Cockpit.tsx) tragen zwei Nav-Buttons ein `<span className="soon">bald</span>`:
- **„Heute"** ruft `pushToast("Heute", "Kalender-Ansicht kommt in Phase 2.")` auf (noch keine Ansicht, nur Toast).
- **„Rechnungen"** ruft `pushToast("Rechnungen", "Angebote & Rechnungen kommen in Phase 4.")` auf.

Auch in der Mail-Detailansicht gibt es einen Platzhalter-Button: „KI-Antwort entwerfen" zeigt `pushToast("KI-Antwort", "Antwort-Entwurf kommt in einer späteren Phase.")`.

**Phase 1 — Gmail echt anbinden:** Skizziert im Stub [gmail.ts](../src/lib/gmail.ts). Geplanter Ablauf laut Modul-Kommentar: Google-OAuth pro Konto (`getAuthUrl(account)`, Scopes `gmail.readonly` + `gmail.send`) → Refresh-Token verschlüsselt speichern → `users.watch` auf ein Pub/Sub-Topic (alle 7 Tage erneuern) → Pub/Sub-Push an `/api/gmail/webhook` → `users.history.list` ab letzter `historyId` → neue Mails über `syncMailbox(account)` laden → `classifyEmail()` → in DB speichern → ggf. Telegram-Push. Empfehlung im Code: das npm-Paket `googleapis` ergänzen. Details in [09-gmail-anbindung.md](./09-gmail-anbindung.md).

**Phase 1b — Telegram-Auto-Push + Befehle:** Laut [README.md](../README.md) automatische Pushes für wichtige Mails sowie Bot-Befehle `/heute` und `/offen`. Heute gibt es nur den manuellen Testknopf (`testPush`). Siehe [08-telegram-push.md](./08-telegram-push.md).

**Phase 2 — Kalender (2 Konten):** Hinter „Heute" in der Nav. Aktuell nur Toast-Platzhalter.

**Phase 4 — Angebote/Rechnungen:** Hinter „Rechnungen" in der Nav. Aktuell nur Toast-Platzhalter.

**Phase 5 — Buchhaltung + BMD-Upload:** Aufbauend auf der schon vorhandenen Ablage „→ Buchhaltung / BMD" (`fileBuch` → `POST /api/assign` mit `fileBuch: true`). Der eigentliche BMD-Upload ist noch offen. Siehe [07-buchhaltung-bmd.md](./07-buchhaltung-bmd.md).

## Beteiligte Dateien

- [src/lib/gmail.ts](../src/lib/gmail.ts) — Stub mit `RawMail`, `getAuthUrl()`, `syncMailbox()`; Kommentar beschreibt die echte Anbindung (Phase 1)
- [src/components/Cockpit.tsx](../src/components/Cockpit.tsx) — Bottom-Nav mit „Heute"/„Rechnungen" + „bald"-Badge und Toast-Platzhaltern
- [README.md](../README.md) — Abschnitt „Nächste Schritte (Roadmap)" mit Phasen 1–5

## Erweiterung / Roadmap

Geplante Reihenfolge laut [README.md](../README.md) und Code:

1. **Gmail echt anbinden** ([gmail.ts](../src/lib/gmail.ts)): OAuth für beide Konten, `users.watch` + Pub/Sub, eingehende Mails → `classifyEmail()` → DB → optional Telegram. Empfehlung: `googleapis`.
2. **Telegram-Auto-Push** für wichtige Mails + Befehle `/heute`, `/offen`.
3. **Phase 2:** Kalender (2 Konten) — Nav „Heute".
4. **Phase 4:** Angebote/Rechnungen — Nav „Rechnungen".
5. **Phase 5:** Buchhaltung + BMD-Upload.

Hinweis zur Datenbank: Für Produktion ist der Umstieg von SQLite auf PostgreSQL vorgesehen (Supabase, isoliertes Schema `cockpit`). Details in [10-supabase-datenbank.md](./10-supabase-datenbank.md).

## Verwandte Docs

- [Gmail-Anbindung](./09-gmail-anbindung.md)
- [Supabase-Datenbank](./10-supabase-datenbank.md)
- [Telegram-Push](./08-telegram-push.md)
- [Buchhaltung & BMD](./07-buchhaltung-bmd.md)
- [Architektur](./00-architektur.md)
