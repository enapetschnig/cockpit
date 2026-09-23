-- Zusätzliche Fotos je Meldung (bis zu 10) – Storage-Pfade im Bucket
-- „aenderungswuensche" der jeweiligen App. Das Cockpit holt sie wie das
-- Bildschirmfoto über /api/wuensche-datei (Edge Function wunsch-datei der App).
alter table crm.app_wuensche
  add column if not exists anhaenge text[] not null default '{}';

comment on column crm.app_wuensche.anhaenge is
  'Zusätzliche Fotos aus der App (Storage-Pfade <uid>/<name>, max. 10).';
