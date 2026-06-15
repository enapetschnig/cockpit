# Anleitung: Gmail mit dem Cockpit verbinden (Google-OAuth-Client)

> Teil von **ePower Cockpit** · [‹ Doku-Übersicht](./README.md) · gehört zu [Gmail-Anbindung](./09-gmail-anbindung.md)

Diese Anleitung führt dich **Klick für Klick** durch die einmalige Einrichtung. Du brauchst
kein Vorwissen. Am Ende hast du zwei Werte (**Client-ID** + **Client-Schlüssel**), die du mir
schickst — dann holt das Cockpit deine echten Gmail-Mails.

---

## Worum geht es hier eigentlich?
Damit eine App (unser Cockpit) deine Gmails lesen darf, verlangt Google einen sauberen,
sicheren Weg — **kein** Passwort-Eintippen, sondern eine offizielle Freigabe namens **OAuth**.
Dafür legst du bei Google einen **„OAuth-Client"** an. Das ist quasi ein Ausweis für unsere App,
mit dem Google weiß: „Diese App darf fragen, ob sie die Mails von Christoph lesen darf."

- **Kostet:** nichts.
- **Dauer:** ~10–15 Minuten.
- **Wie oft:** nur einmal.
- **Sicher?** Ja. Du gibst nie ein Passwort weiter; du kannst die Freigabe jederzeit in deinem
  Google-Konto wieder entziehen.

## Was du vorher bereit haben solltest
- Ein **Google-Konto** (am besten dein **Firmen**-Gmail). Damit loggst du dich gleich ein.
- Die **zwei E-Mail-Adressen**, die ins Cockpit sollen (Firma + privat).
- Diese Anleitung offen lassen — wir springen am Ende wieder hierher zurück.

> Alles passiert auf einer Google-Seite: **[console.cloud.google.com](https://console.cloud.google.com)**
> („Google Cloud Console"). Beim ersten Öffnen evtl. Land auswählen + Nutzungsbedingungen
> akzeptieren — ganz normal, einfach bestätigen.

---

## Schritt 1 — Ein „Projekt" anlegen
Ein Projekt ist nur ein Sammelordner für die Einstellungen unserer App.

1. Oben **links**, direkt neben dem Schriftzug „Google Cloud", ist eine **Projekt-Auswahl**
   (ein Dropdown, evtl. steht dort „Projekt auswählen"). Draufklicken.
2. Im Fenster oben rechts auf **„Neues Projekt" / „New Project"**.
3. **Projektname:** `ePower Cockpit` eingeben. „Organisation" / „Speicherort" einfach lassen.
4. **„Erstellen" / „Create"** klicken.
5. Oben erscheint kurz eine Benachrichtigung. Danach **nochmal** auf die Projekt-Auswahl oben
   links und **„ePower Cockpit"** auswählen, damit du wirklich in diesem Projekt arbeitest.
   (Kontrolle: oben links muss jetzt „ePower Cockpit" stehen.)

## Schritt 2 — Die „Gmail API" einschalten
„API" = die Schnittstelle, über die Apps mit Gmail reden dürfen. Standardmäßig ist sie aus.

1. Oben in die **Suchleiste** (Mitte) `Gmail API` eintippen.
2. In den Treffern auf **„Gmail API"** klicken.
3. Auf der Seite den blauen Button **„Aktivieren" / „Enable"** klicken.
4. Kurz warten, bis „API aktiviert" erscheint. Fertig.

## Schritt 3 — Den „Zustimmungs-Bildschirm" einrichten
Das ist das Fenster, das **dir** später angezeigt wird („App XY möchte auf dein Gmail
zugreifen — Erlauben?"). Das richten wir jetzt einmal ein.

1. Links oben auf das **Menü ☰** (Hamburger-Icon) → **„APIs und Dienste"** →
   **„OAuth-Zustimmungsbildschirm"**.
   > In der neueren Oberfläche heißt dieser Bereich **„Google Auth Platform"**. Egal welcher
   > Name — du landest am richtigen Ort. Wenn ein Button **„Jetzt starten" / „Get started"**
   > erscheint, klick ihn.
2. Jetzt füllst du nacheinander aus:
   - **App-Informationen:**
     - **App-Name:** `ePower Cockpit`
     - **Nutzer-Support-E-Mail:** `hallo@epowergmbh.at` (aus der Liste wählen)
   - **Zielgruppe / Audience:** Wahl zwischen **Intern** und **Extern** —
     bitte so entscheiden:
     | Deine Situation | Wähle | Warum |
     |---|---|---|
     | Beide Postfächer sind `@epowergmbh.at` (Google Workspace) | **Intern / Internal** | Kein Test-Modus, **keine** 7-Tage-Ablauffrist, am einfachsten |
     | Das Privat-Postfach ist eine normale `@gmail.com` | **Extern / External** | Funktioniert mit jeder Adresse; im Test-Modus muss man ~alle 7 Tage neu „Verbinden" |
   - **Kontaktdaten:** nochmal `hallo@epowergmbh.at`.
   - Häkchen bei den **Nutzungsbedingungen** → **„Erstellen" / „Create"**.

## Schritt 4 — Test-Nutzer eintragen  *(nur wenn du „Extern" gewählt hast)*
Im Test-Modus darf nur zugreifen, wer hier eingetragen ist.

1. In der **Google Auth Platform** links auf **„Zielgruppe" / „Audience"**.
2. Abschnitt **„Testnutzer" / „Test users"** → **„Nutzer hinzufügen" / „Add users"**.
3. Trage **beide** Adressen ein (Enter nach jeder):
   - deine **Firmen**-Gmail-Adresse
   - deine **Privat**-Gmail-Adresse
4. **„Speichern" / „Save"**.

> Hast du „**Intern**" gewählt, gibt es diesen Schritt nicht — überspring ihn einfach.

## Schritt 5 — (Optional) Berechtigung „Gmail lesen" hinterlegen
Das macht den Zustimmungs-Text sauberer. Wenn du den Punkt nicht findest, überspring ihn —
die App fragt die Leseberechtigung beim Verbinden ohnehin selbst an.

1. In der **Google Auth Platform** links auf **„Datenzugriff" / „Data Access"**.
2. **„Bereiche hinzufügen" / „Add or remove scopes"**.
3. In der Suche `gmail.readonly` eingeben, das Häkchen bei
   **`.../auth/gmail.readonly`** setzen → **„Aktualisieren"** → **„Speichern"**.

## Schritt 6 — Den OAuth-Client erstellen  ⭐ (hier kommen die zwei Werte raus)
1. In der **Google Auth Platform** links auf **„Clients"**.
   > Alternativweg in der klassischen Ansicht: *Menü ☰ → APIs und Dienste → **Anmeldedaten**
   > → **Anmeldedaten erstellen** → **OAuth-Client-ID***.
2. **„Client erstellen" / „Create client"** (bzw. „+ Anmeldedaten erstellen").
3. **Anwendungstyp / Application type:** **„Webanwendung" / „Web application"** wählen.
4. **Name:** z. B. `Cockpit lokal` (frei wählbar, nur für dich).
5. Runterscrollen zu **„Autorisierte Weiterleitungs-URIs" / „Authorized redirect URIs"**:
   - **„URI hinzufügen" / „Add URI"** klicken.
   - Genau das hier einfügen (am besten **kopieren**, **nichts** ändern):
     ```
     http://localhost:3000/api/gmail/callback
     ```
   - ⚠️ Wichtig: `http` (nicht `https`), kein Leerzeichen, **kein** Schrägstrich am Ende.
     Dieser Wert muss **exakt** stimmen, sonst gibt's später die Meldung
     „redirect_uri_mismatch".
6. **„Erstellen" / „Create"** klicken.
7. 🎉 Es öffnet sich ein Fenster **„OAuth-Client erstellt"** mit zwei Werten:
   - **Client-ID** — lang, endet auf `...apps.googleusercontent.com`
   - **Client-Schlüssel / Client secret** — kürzer, beginnt meist mit `GOCSPX-...`
   Lass das Fenster offen oder klick **„JSON herunterladen"**, damit du die Werte hast.

## Schritt 7 — Die zwei Werte an mich schicken
Kopier beide Werte und schreib sie mir genau so in den Chat:
```
GOOGLE_CLIENT_ID = 1234567890-abcdef.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET = GOCSPX-xxxxxxxxxxxxxxxx
```
Das war's für dich! Ich übernehme dann:
1. Werte in die `.env` eintragen (bleibt **lokal**, kommt **nie** ins Repo / auf GitHub).
2. App neu starten.
3. Gemeinsam auf **http://localhost:3000/connect**: **„Verbinden" (Firma)** → bei Google
   einloggen + erlauben → **„Verbinden" (Privat)** → **„Jetzt synchronisieren"**.
4. Deine echten Mails erscheinen klassifiziert im Cockpit; wichtige firmenrelevante Mails
   lösen (sofern eingerichtet) einen Telegram-Push aus.

---

## Häufige Stolpersteine (falls etwas hakt)
- **„Zugriff blockiert: Diese App ist nicht verifiziert"** beim Verbinden →
  völlig normal im Test-Modus. Klick **„Erweitert" / „Advanced"** → **„Weiter zu ePower
  Cockpit (unsicher)"**. Es ist ja **deine eigene** App, kein Fremder.
- **„redirect_uri_mismatch"** → die URI in Schritt 6 ist nicht exakt
  `http://localhost:3000/api/gmail/callback`. Nochmal kontrollieren (http, kein Slash am Ende).
- **Ich finde „Google Auth Platform" nicht** → über die obere **Suchleiste** einfach
  `OAuth` oder `Anmeldedaten` suchen; Google führt dich zur richtigen Seite.
- **Client-Schlüssel verlegt?** Menü → APIs und Dienste → **Anmeldedaten** → deinen Client
  öffnen → Secret wird angezeigt bzw. **„Schlüssel hinzufügen"** für ein neues.
- **Verbindung läuft nach ~7 Tagen ab** (nur „Extern/Test"): einfach auf `/connect` erneut
  **„Verbinden"** klicken. Mit „Intern" (Workspace) passiert das nicht.
- **Freigabe später widerrufen?** [myaccount.google.com/permissions](https://myaccount.google.com/permissions)
  → „ePower Cockpit" → Zugriff entfernen.
