/**
 * Seed: Beispiel-Daten wie im Mockup.
 * Enthält bewusst zwei Privat-Mails, die firmenrelevant sind (Steuerberater, Hetzner),
 * damit die "Privat -> Firma"-Erkennung sofort sichtbar ist.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Reset (Reihenfolge wegen Relationen)
  await prisma.todo.deleteMany();
  await prisma.email.deleteMany();
  await prisma.customer.deleteMany();

  const mueller = await prisma.customer.create({
    data: { name: "Müller Bau GmbH", meta: "Lagerverwaltungs-Software", color: "#2f6df0" },
  });
  const gartner = await prisma.customer.create({
    data: { name: "Gartner Elektro", meta: "Wartungs-App (laufend)", color: "#1f9d63" },
  });
  await prisma.customer.create({
    data: { name: "Huber Installationen", meta: "Angebot offen", color: "#d8932a" },
  });

  const emails = [
    {
      account: "firma", fromAddr: "angebot@muellerbau.at", fromName: "Müller Bau GmbH",
      subject: "Brauchen Termin für Angebot Lagerverwaltung",
      body: "Hallo Chris,\n\nwir würden gerne mit der Lagerverwaltungs-Software loslegen. Kannst du nächste Woche für eine Aufnahme vorbeikommen und uns danach ein Angebot machen?\n\nBesten Dank,\nThomas Müller",
      summary: "Will mit der Lagerverwaltung starten und bittet um Vor-Ort-Termin nächste Woche + Angebot.",
      labelsJson: JSON.stringify(["angebot", "aufgabe", "termin"]),
      firmenrelevant: true, priority: "hi", customerId: mueller.id,
    },
    {
      account: "firma", fromAddr: "office@gartner-elektro.at", fromName: "Gartner Elektro",
      subject: "Bug im Auftrags-Modul – dringend",
      body: "Hallo Chris,\n\nbeim Anlegen eines neuen Auftrags stürzt die App seit heute ab. Das blockiert uns gerade. Können wir kurz telefonieren?\n\nLG, Sandra",
      summary: "App stürzt beim Anlegen neuer Aufträge ab, blockiert den Betrieb. Bittet um Rückruf.",
      labelsJson: JSON.stringify(["support", "aufgabe"]),
      firmenrelevant: true, priority: "hi", customerId: gartner.id,
    },
    {
      account: "firma", fromAddr: "rechnung@a1.net", fromName: "A1 Telekom",
      subject: "Ihre Rechnung Juni 2026 ist verfügbar",
      body: "Sehr geehrter Kunde,\n\nIhre aktuelle Rechnung (Juni 2026) steht im Kundenportal bereit.\nBetrag: € 79,90.\n\nIhr A1 Team",
      summary: "Telefonrechnung Juni über 79,90 € liegt im Kundenportal — Beleg für die Buchhaltung.",
      labelsJson: JSON.stringify(["buchhaltung"]),
      firmenrelevant: true, priority: "mid",
    },
    {
      account: "firma", fromAddr: "t.huber@huber-inst.at", fromName: "Huber Installationen",
      subject: "Frage zum Funktionsumfang",
      body: "Servus Chris,\n\nkann deine Software auch die Arbeitszeiten der Monteure erfassen? Wenn ja, hätten wir Interesse an einem Angebot.\n\nGruß, Tobias Huber",
      summary: "Fragt, ob die Software Monteur-Arbeitszeiten erfassen kann — bei Ja Interesse an Angebot.",
      labelsJson: JSON.stringify(["angebot", "aufgabe"]),
      firmenrelevant: true, priority: "mid",
    },
    {
      account: "privat", fromAddr: "kanzlei@steuerberatung-xy.at", fromName: "Steuerberatung XY",
      subject: "Offene Belege Q2 – bitte bis Freitag",
      body: "Hallo Christoph,\n\nfür die Buchhaltung Q2 fehlen uns noch ein paar Belege. Kannst du sie uns bis Freitag schicken?\n\nDanke und liebe Grüße,\nKanzlei XY",
      summary: "Steuerberater braucht die offenen Belege fürs 2. Quartal bis Freitag. Firmensache, kam aber privat rein.",
      labelsJson: JSON.stringify(["buchhaltung", "aufgabe"]),
      firmenrelevant: true, priority: "hi",
    },
    {
      account: "privat", fromAddr: "team@dev-weekly.com", fromName: "Dev Weekly",
      subject: "Diese Woche: 10 VS-Code-Tricks",
      body: "Hi,\n\ndie besten Shortcuts und Extensions der Woche...\n\n— Dev Weekly",
      summary: "Newsletter mit Shortcuts und Extensions der Woche. Nicht firmenrelevant.",
      labelsJson: JSON.stringify(["newsletter"]),
      firmenrelevant: false, priority: "lo",
    },
    {
      account: "privat", fromAddr: "mama@gmail.com", fromName: "Mama",
      subject: "Sonntag Essen?",
      body: "Kommst du am Sonntag zum Mittagessen? Bring bitte den Salat mit :)",
      summary: "Private Einladung zum Mittagessen am Sonntag. Nicht firmenrelevant.",
      labelsJson: JSON.stringify(["privat"]),
      firmenrelevant: false, priority: "lo",
    },
    {
      account: "privat", fromAddr: "billing@hetzner.com", fromName: "Hetzner",
      subject: "Ihre Rechnung 06/2026",
      body: "Hallo,\n\nIhre monatliche Rechnung über € 24,90 steht bereit.\n\nIhr Hetzner-Team",
      summary: "Server-Rechnung 24,90 € — gehört in die Buchhaltung. Kam ans Privat-Postfach.",
      labelsJson: JSON.stringify(["buchhaltung"]),
      firmenrelevant: true, priority: "mid",
    },
  ];

  let i = 0;
  for (const e of emails) {
    // receivedAt leicht gestaffelt, damit die Sortierung sinnvoll ist
    const receivedAt = new Date(Date.now() - i * 3600_000);
    await prisma.email.create({
      data: { ...e, classifiedAt: new Date(), receivedAt },
    });
    i++;
  }

  console.log(`Seed fertig: ${emails.length} Mails, 3 Kunden.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
