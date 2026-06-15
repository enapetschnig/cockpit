# Telegram-Push

> Teil von **ePower Cockpit** · [‹ Doku-Übersicht](./README.md)

**In einem Satz:** Das Cockpit kann kurze Hinweise per Telegram aufs Handy schicken — getestet über einen Glocken-Button, mit Badge für wichtige Mails und einem In-App-Hinweis (Toast).

## Was es macht
Über die Glocke oben rechts im Posteingang lässt sich ein Test-Push auslösen. Ist ein Telegram-Bot hinterlegt, kommt die Nachricht aufs Handy; ist nichts konfiguriert, läuft die App normal weiter und schreibt die Nachricht nur ins Server-Log. Die Badge an der Glocke zeigt, wie viele wichtige Mails gerade im aktiven Konto-Filter liegen. Zusätzlich erscheinen im Cockpit kurze Hinweis-Karten (Toasts), z. B. wenn eine firmenrelevante Mail im Privat-Postfach landet.

## Wie es funktioniert
Die Funktion [`sendTelegram(text)`](../src/lib/telegram.ts) liest `TELEGRAM_BOT_TOKEN` und `TELEGRAM_CHAT_ID` aus den Umgebungsvariablen. Fehlt eines davon, loggt sie eine Warnung (`[telegram] nicht konfiguriert …`) und gibt `{ ok: false, skipped: true }` zurück — es wird also nichts gesendet. Sind beide gesetzt, ruft sie `https://api.telegram.org/bot<token>/sendMessage` per `POST` auf (Body: `chat_id`, `text`, `parse_mode: "HTML"`, `disable_web_page_preview: true`) und gibt `{ ok }` aus der Telegram-Antwort zurück.

Aufgerufen wird das über den Endpunkt [`POST /api/notify`](../src/app/api/notify/route.ts): Er liest `text` aus dem Request-Body (Default: `"🔔 Test vom ePower Cockpit"`), reicht ihn an `sendTelegram(text)` weiter und gibt dessen Ergebnis als JSON zurück.

In der Oberfläche ([`Cockpit.tsx`](../src/components/Cockpit.tsx)):
- Der **Glocken-Button** (`className="bell"`, `aria-label="Push testen"`) ruft `testPush()` auf. Diese Funktion schickt `POST /api/notify` mit dem Test-Text und zeigt danach einen Toast: bei `skipped` „Telegram noch nicht konfiguriert – nur im Server-Log.“, sonst „An Telegram übermittelt.“
- Die **Badge** an der Glocke (`<span className="badge">`) zeigt `counts.wichtig` — die Anzahl sichtbarer Mails mit `priority === "hi"` — und nur, wenn dieser Wert > 0 ist.
- Der **Toast** wird über `pushToast(title, body)` gesetzt; er blendet sich nach 4600 ms automatisch aus (`toastTimer`). Klick auf den Toast öffnet bei Bedarf die firmenrelevante Privat-Mail. Beim ersten Laden zeigt ein `useEffect` automatisch einen Toast, falls eine firmenrelevante Mail im Privat-Postfach gefunden wird (Demo-Push).

Hinweis: Der automatische Push aus dem Cockpit ist aktuell ein **In-App-Toast**, kein Telegram-Versand. Telegram wird derzeit nur über `testPush` / `/api/notify` ausgelöst.

## Beteiligte Dateien
- [src/lib/telegram.ts](../src/lib/telegram.ts) — `sendTelegram(text)`, der eigentliche Telegram-Versand inkl. Skip-Logik
- [src/app/api/notify/route.ts](../src/app/api/notify/route.ts) — `POST /api/notify`, nimmt `{ text }` entgegen und ruft `sendTelegram` auf
- [src/components/Cockpit.tsx](../src/components/Cockpit.tsx) — Glocken-Button (`testPush`), Badge (`counts.wichtig`), Toasts (`pushToast`)

## Datenfluss / API
**`POST /api/notify`**

Request (JSON):
```json
{ "text": "Beliebiger Hinweistext" }
```
- `text` (optional): Fehlt es oder ist es leer, wird `"🔔 Test vom ePower Cockpit"` verwendet.

Response (JSON) — durchgereicht von `sendTelegram`:
- `{ "ok": true }` — an Telegram übermittelt
- `{ "ok": false, "skipped": true }` — kein Token/Chat-ID konfiguriert, nur ins Log geschrieben
- `{ "ok": false }` — Senden fehlgeschlagen (Fehler beim Telegram-API-Aufruf)

## Einrichtung
1. Bot bei **@BotFather** in Telegram erstellen → erhaltenen Token als `TELEGRAM_BOT_TOKEN` in `.env` eintragen.
2. Den neuen Bot in Telegram anschreiben, dann die Chat-ID via **@userinfobot** holen → als `TELEGRAM_CHAT_ID` in `.env` eintragen.

Ohne diese beiden Werte bleibt der Versand inaktiv, das Cockpit funktioniert aber uneingeschränkt.

## Erweiterung / Roadmap
- **Automatischer Push bei wichtigen Mails:** Der Endpunkt `/api/notify` ist laut Code-Kommentar bereits als Basis für „automatische Benachrichtigung bei wichtigen Mails“ gedacht — bisher löst nur der Test-Button echte Telegram-Nachrichten aus.
- **Bot-Befehle** wie `/heute` (Tagesübersicht) und `/offen` (offene Aufgaben) sind angedacht, aber noch nicht implementiert.

## Verwandte Docs
- [Wichtig / Priorität](./04-firmenrelevanz.md)
- [Posteingang](./02-posteingang.md)
- [Roadmap](./11-roadmap.md)
