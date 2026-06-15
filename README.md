# ePower Cockpit

Kontrollhub der **ePower GmbH** — **Phase 1: E-Mail-Cockpit mit KI**.
Zwei Postfächer (Firma + privat) an einem Ort, KI-Zusammenfassung & Labels pro Mail,
Erkennung firmenrelevanter Mails **auch im Privat-Postfach**, Kunden-Zuordnung mit
offenen To-dos und Telegram-Push.

> Läuft auch **ohne** OpenAI-Key (dann mit einfachem Regel-Fallback statt echter KI).
> Gmail- und Telegram-Anbindung sind als nächste Schritte vorbereitet.
>
> 📚 **Doku pro Funktion:** [`docs/`](./docs/README.md) — je eine `.md` pro Funktion,
> inkl. Anleitungen für [Supabase](./docs/10-supabase-datenbank.md) und
> [Gmail](./docs/09-gmail-anbindung.md).
>
> 🗄️ **Datenbank:** Supabase PostgreSQL im isolierten Schema `cockpit` — parallel zur
> bestehenden Demo-App (deren `public`-Schema bleibt unberührt).

---

## Schnellstart

Voraussetzungen: **Node.js 20+** und npm.

```bash
# 1) ins Projekt
cd epower-cockpit

# 2) Abhängigkeiten
npm install

# 3) Umgebungsvariablen anlegen
cp .env.example .env
#   -> PFLICHT: [DEIN-DB-PASSWORT] in DATABASE_URL + DIRECT_URL ersetzen (Supabase)
#      siehe docs/10-supabase-datenbank.md
#   -> optional: OPENAI_API_KEY eintragen (echte KI statt Fallback)

# 4) Tabellen im Schema "cockpit" erzeugen + Beispiel-Daten laden
npm run setup        # prisma generate + db push + seed (nur Schema cockpit)

# 5) starten
npm run dev
```

Dann im Browser: **http://localhost:3000**

### Nützliche Befehle
| Befehl | Zweck |
|---|---|
| `npm run dev` | Dev-Server (Hot Reload) |
| `npm run setup` | DB erzeugen + Beispiel-Daten |
| `npm run db:reset` | DB zurücksetzen + neu seeden |
| `npm run build` | Produktions-Build |

---

## Was drin ist (Phase 1)

- **Posteingang** über zwei Konten (Firma / Privat) mit Umschalter.
- **KI pro Mail (OpenAI):** Ein-Satz-Zusammenfassung, Labels (Buchhaltung, Angebot,
  Aufgabe, Support, Termin …) und **Firmenrelevanz** — auch wenn die Mail privat
  ankommt (z. B. Steuerberater, Server-/Lieferantenrechnung).
- **Tabs:** Firmenrelevant · Wichtig · Buchhaltung · Zuordnen · Alle.
- **Zuordnen:** offene Mails per Klick einem Kunden zuweisen oder
  **→ Buchhaltung/BMD** ablegen; vorgeschlagene To-dos wandern zum Kunden.
- **Kunden-Akte:** „Was noch zu tun ist" + zugeordnete Mails.
- **Aufgabe erstellen** direkt aus einer Mail.
- **Telegram-Push** (Testknopf; echte Auto-Pushes in Phase 1b).

### KI ein-/ausschalten
Ohne `OPENAI_API_KEY` nutzt die App einen Stichwort-Fallback (`src/lib/openai.ts`),
damit alles sofort läuft. Mit Key wird jede Mail über das Modell `OPENAI_MODEL`
(Standard `gpt-4o-mini`) klassifiziert — Button **„Mit KI neu klassifizieren"** in
der Mail-Detailansicht.

---

## Projektstruktur

```
epower-cockpit/
├─ docs/                    # Doku – eine .md je Funktion (Start: docs/README.md)
├─ prisma/
│  ├─ schema.prisma         # Customer / Email / Todo (Supabase/Postgres, Schema "cockpit")
│  └─ seed.ts               # Beispiel-Daten (inkl. Privat→Firma-Mails)
├─ src/
│  ├─ app/
│  │  ├─ page.tsx           # rendert das Cockpit
│  │  ├─ layout.tsx
│  │  ├─ globals.css
│  │  └─ api/               # Backend (Route Handlers)
│  │     ├─ emails/         # GET Liste
│  │     ├─ customers/      # GET / POST (Kunde anlegen)
│  │     ├─ classify/       # POST -> OpenAI-Klassifizierung
│  │     ├─ assign/         # POST -> Kunde / neu / Buchhaltung
│  │     ├─ todos/          # POST / PATCH
│  │     └─ notify/         # POST -> Telegram
│  ├─ components/Cockpit.tsx# gesamte UI (Client)
│  └─ lib/
│     ├─ db.ts              # Prisma-Client
│     ├─ openai.ts          # classifyEmail() + Fallback
│     ├─ telegram.ts        # sendTelegram()
│     ├─ gmail.ts           # STUB für die echte Gmail-Anbindung
│     ├─ labels.ts          # Label-Definitionen
│     ├─ serialize.ts       # DB -> DTO
│     └─ types.ts
└─ .env.example
```

---

## Nächste Schritte (Roadmap)

1. **Gmail** ✅ angebunden — OAuth für beide Konten + Sync via `googleapis`, Verbinden-Seite
   unter `/connect`. Eingehende Mails → `classifyEmail()` → DB → Telegram-Push.
   Offen: Echtzeit per `users.watch` + Cloud Pub/Sub statt manuellem Sync. Details:
   [docs/09-gmail-anbindung.md](./docs/09-gmail-anbindung.md).
2. **Telegram-Auto-Push** für wichtige Mails + Befehle (`/heute`, `/offen`).
3. **Phase 2:** Kalender (2 Konten). **Phase 4:** Angebote/Rechnungen.
   **Phase 5:** Buchhaltung + BMD-Upload. (Siehe Plan-Dokument.)

## Datenbank: Supabase (bereits eingerichtet)
Das Cockpit läuft auf **Supabase PostgreSQL** im isolierten Schema `cockpit` — getrennt von
der bestehenden Demo-App. Setup & Connection-Strings: [`docs/10-supabase-datenbank.md`](./docs/10-supabase-datenbank.md).

---

*Hinweis: Dieses Projekt ersetzt keine Rechts-/Steuerberatung. Buchhaltungs-/RKSV-/
E-Rechnungs-Themen vor produktivem Einsatz mit dem Steuerberater abstimmen.*
