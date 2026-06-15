# ePower Cockpit — Doku

Kontrollhub der **ePower GmbH**. Diese Doku ist bewusst in **eine Datei pro Funktion**
aufgeteilt, damit nichts überläuft. Start/Setup steht im [Haupt-README](../README.md).

## Funktionen (Phase 1)

| # | Doku | Worum es geht |
|---|---|---|
| 00 | [Architektur & Stack](./00-architektur.md) | Next.js · React · Prisma · Supabase, Ordner & Datenfluss |
| 01 | [Datenmodell](./01-datenmodell.md) | `Customer` · `Email` · `Todo`, Felder & DTOs |
| 02 | [Posteingang](./02-posteingang.md) | Zwei Konten, Tabs, Mail-Karten, Detailansicht |
| 03 | [KI-Klassifizierung](./03-ki-klassifizierung.md) | OpenAI-Zusammenfassung/Labels + Regel-Fallback |
| 04 | [Firmenrelevanz](./04-firmenrelevanz.md) | Firmen-Mails **auch im Privat-Postfach** erkennen |
| 05 | [Kunden-Zuordnung](./05-kunden-zuordnung.md) | Mails Kunden zuordnen, Kunden-Akte |
| 06 | [Aufgaben / To-dos](./06-aufgaben.md) | Aufgaben aus Mails, abhaken |
| 07 | [Buchhaltung / BMD](./07-buchhaltung-bmd.md) | Belege ablegen (`filed`), BMD-Roadmap |
| 08 | [Telegram-Push](./08-telegram-push.md) | Benachrichtigungen & Test-Push |

## Anbindungen & Betrieb

| # | Doku | Worum es geht |
|---|---|---|
| 09 | [Gmail-Anbindung](./09-gmail-anbindung.md) | Echte Mails aus 2 Postfächern — **Anleitung** |
| 10 | [Supabase-Datenbank](./10-supabase-datenbank.md) | Isoliertes Schema `cockpit` — **Setup-Anleitung** |
| 11 | [Roadmap & Phasen](./11-roadmap.md) | Was als Nächstes kommt |
| 12 | [Automatik & KI-Funktionen](./12-automatik-und-ki-funktionen.md) | Auto-Sync, „alle neu einordnen", Kundenerkennung |

**Schritt-für-Schritt-Anleitung:** [Gmail mit dem Cockpit verbinden](./anleitung-gmail-einrichten.md) (Google-OAuth einrichten).

---

### Konventionen
- **Sprache:** Deutsch. **Code-Verweise:** klickbare relative Links (z. B. `../src/lib/openai.ts`).
- **Eine Funktion = eine Datei.** Neue Funktion → neue `NN-name.md` + Zeile in dieser Tabelle.
- **Secrets** stehen ausschließlich in `.env` (gitignored), nie in der Doku oder im Code.
