// Zentrale Label-Definition – von KI-Klassifizierung und UI gemeinsam genutzt.
export const LABELS: Record<string, { t: string; c: string }> = {
  buchhaltung: { t: "Buchhaltung", c: "l-buch" },
  angebot: { t: "Angebot", c: "l-ang" },
  aufgabe: { t: "Aufgabe", c: "l-task" },
  support: { t: "Support", c: "l-sup" },
  termin: { t: "Termin", c: "l-sup" },
  newsletter: { t: "Newsletter", c: "l-lo" },
  privat: { t: "Privat", c: "l-priv" },
};

export const ALL_LABEL_KEYS = Object.keys(LABELS);
