# Apps & Claude-Sitzungen am Handy (03.11.2026)

Im Cockpit (`/apps`) jede Kunden-App antippen, reinschreiben, was Claude machen soll, und den Verlauf live
mitlesen – ohne VS Code. Ausgeführt wird alles vom Roboter auf der Devbox
(`~/Developer/_baukasten/werkzeuge/roboter/roboter.mjs`, ab Version 4.3).

## Seiten

| Route | Was |
|---|---|
| `/apps` | Roboter-Status (Pause/Weiter je App oder alle), Liste aller Apps, sortiert nach letzter Tätigkeit |
| `/apps/:key` | Neue Sitzung starten, Sitzungen der App (Handy / VS Code / Roboter), Pause für diese App |
| `/apps/:key/:id` | Verlauf als Chat, Schritte zusammengeklappt, unten weiterschreiben, „Abbrechen“ |

Am Handy (unter 640 px) gibt es statt der Leiste oben eine Leiste unten: Heute, Apps, Wünsche, CRM, Mehr.
Das Cockpit lässt sich über „Teilen → Zum Home-Bildschirm“ als App installieren (`public/manifest.webmanifest`).

## Tabellen (Schema `crm`, Migration `20261103120000_cockpit_sitzungen.sql`)

- `cockpit_sitzungen`: eine Zeile je Claude-Verlauf. `herkunft` ist `cockpit`, `vscode` oder `roboter`.
  `claude_sitzung` ist die Claude-Sitzungs-ID (eindeutig). `status` ist `bereit`, `wartet`, `laeuft` oder `fehler`.
  `abbrechen` hält Claude an. `beobachten_bis` setzt die Seite, solange sie offen ist.
- `cockpit_nachrichten`: der gespiegelte Verlauf. `rolle` ist `du`, `claude`, `werkzeug` oder `info`.
  Eigene Nachrichten haben einen `status` (`neu` → `in_arbeit` → `erledigt`/`fehler`).
- `roboter_befehle`: `pause`/`weiter` je App (oder `alle`); der Roboter erledigt sie innerhalb von Sekunden.
- `roboter_puls.pausen` und `roboter_puls.laeuft`: was gerade pausiert ist und was gerade läuft.

## Ablauf im Roboter (alle 4 s)

1. Befehle erledigen (`pause.json` schreiben).
2. Neue Nachrichten (`status = neu`) abholen. Pro App läuft immer nur eine Arbeit: ein Roboter-Auftrag oder
   eine Sitzung. Sonst ist die Sitzung auf `wartet` und zeigt einen Hinweis. Höchstens 3 Sitzungen gleichzeitig.
3. Claude läuft in der Arbeitskopie `~/roboter/kopien/<app>` und setzt die eigene Sitzung fort (`--resume`).
   Eine VS-Code-Sitzung oder eine, die gerade woanders läuft, geht als Abzweig weiter (`--fork-session`).
   Das Original bleibt unverändert.
4. Der Verlauf wird alle 2,5 s in `cockpit_nachrichten` gespiegelt.
5. Danach prüft der Roboter: ist alles auf GitHub? Wenn gepusht wurde, wartet er auf das Deploy und meldet
   „✅ Live“.
6. Alle 2 Minuten gleicht er die Verläufe aus VS Code und von Roboter-Aufträgen ab (letzte 21 Tage).

## VS Code bleibt gleichwertig

Sitzungen vom Handy heißen „Cockpit · App · …“. Der Roboter verlinkt sie in den Projektordner der App, so dass
sie in VS Code unter den Claude-Verläufen erscheinen und dort weitergehen. Was in VS Code passiert, erscheint
im Cockpit innerhalb von 2 Minuten. Bei offener Seite erscheint es live.

## Grenzen

- Die Devbox muss laufen; sonst zeigt `/apps` „Roboter meldet sich nicht“.
- Eine Arbeit je App gleichzeitig (Aufträge und Sitzungen teilen sich die Arbeitskopie).
- Verläufe werden gespiegelt, nicht gesichert: Die Wahrheit sind die `.jsonl`-Dateien auf der Devbox.
