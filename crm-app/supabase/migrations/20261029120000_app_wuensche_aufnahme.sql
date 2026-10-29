-- „Zeigen & erklären" aus den Handwerker-Apps (29.10.2026): Pfad der
-- Bildschirmaufnahme (rrweb, gzip) im privaten Bucket der App. Abruf über
-- /api/wuensche-datei?art=aufnahme. Bestehende Wünsche bleiben leer. Idempotent.
ALTER TABLE crm.app_wuensche ADD COLUMN IF NOT EXISTS aufnahme_pfad text;
