-- Schlussrechnung: welche Anzahlungsrechnungen (Nummer, Datum, netto, USt)
-- abgezogen werden – je Zeile eine, so steht es auch im PDF (§ 11 UStG).
alter table crm.documents
  add column if not exists deducted_note text;
