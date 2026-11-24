-- Werbeerfolg (24.11.2026): Herkunft „Privat“ (selbst akquiriert) und „YouTube“ dazu,
-- Herkunft der restlichen Kunden laut Christoph, Briefkosten erst ab Juni 2026.

alter table crm.werbe_herkunft drop constraint if exists werbe_herkunft_kanal_check;
alter table crm.werbe_herkunft add constraint werbe_herkunft_kanal_check
  check (kanal in ('facebook', 'instagram', 'brief', 'website', 'empfehlung', 'youtube', 'privat', 'sonstiges'));

insert into crm.werbe_herkunft (firma_key, firma, kanal)
select lower(regexp_replace(trim(f), '\s+', ' ', 'g')), f, k
from (values
  ('ET-König GmbH', 'privat'),
  ('Bau4You Baranowski Bau GmbH', 'youtube'),
  ('GT-Holzbau - Geisselbacher GmbH', 'brief'),
  ('Composite Solutions CSG GmbH', 'privat'),
  ('fonio GmbH', 'privat'),
  ('CS Powermetall', 'empfehlung'),
  ('Holzerleben GmbH Holzbau- und Projektmanagement', 'facebook'),
  ('ELEKTRIKER ÖSTERREICH', 'privat'),
  ('Automationstechnik Thomas Lederer GmbH', 'facebook')
) as v(f, k)
on conflict (firma_key) do update set kanal = excluded.kanal, firma = excluded.firma, geaendert_am = now();

-- PAGRO/POST vor Juni 2026 waren keine Briefaktionen → zählen nicht (in der Seite wieder „mitzählen“ möglich).
insert into crm.werbekosten (buchung_id, kanal)
select b.id, null
from crm.liq_buchungen b
where b.betrag < 0 and b.datum < '2026-06-01'
  and (b.text ~* 'PAGRO' or b.text ~* '\mPOST\M')
on conflict (buchung_id) do nothing;
