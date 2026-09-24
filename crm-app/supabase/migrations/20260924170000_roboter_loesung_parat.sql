-- Roboter 2.9 – Christoph, 24.09.2026: „die Nachricht nur bekommen, wenn er schon die Lösung parat hat,
-- und ich sage nur noch ja passt – und es soll nie zu einem Fehler kommen.“
-- Ablauf: analyse → vorbereiten (Roboter setzt um und prüft alles) → vorschlag (fertige Lösung, EINE Nachricht)
-- → freigegeben (Christoph: „passt“) → live, ohne weitere Rückfrage.
alter table crm.roboter_auftraege drop constraint if exists roboter_auftraege_status_check;
alter table crm.roboter_auftraege add constraint roboter_auftraege_status_check check (status = any (array[
  'analyse', 'vorbereiten', 'vorschlag', 'aendern', 'freigegeben', 'in_arbeit', 'vorschau', 'live', 'erledigt',
  'abgelehnt', 'verworfen', 'wartet', 'fehler', 'db_pruefen', 'db_freigabe', 'db_live']));
-- Zweig-Stand (Commit), der fertig geprüft gezeigt wurde – Christophs „passt“ gilt genau für ihn.
alter table crm.roboter_auftraege add column if not exists geprueft text;
-- Selbst nochmal versuchen statt Fehler melden: wie oft schon, wann wieder.
alter table crm.roboter_auftraege add column if not exists versuche integer not null default 0;
alter table crm.roboter_auftraege add column if not exists naechster_versuch timestamptz;
-- Seit wann er still wartet (z. B. jemand arbeitet gerade im Projektordner) – erst nach 2 Stunden fragt er nach.
alter table crm.roboter_auftraege add column if not exists wartet_seit timestamptz;
