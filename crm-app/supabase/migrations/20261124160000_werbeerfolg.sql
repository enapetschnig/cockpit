-- Werbeerfolg / ROAS (24.11.2026, Christoph: „eine schöne Auswertung, wo ich die ausgegebenen Werbekosten und
-- Briefkosten habe und den ROAS sehe“). Seite Mehr → Verkauf → Werbeerfolg (/werbeerfolg, docs/17-werbeerfolg.md).
--
-- Umsatz = Rechnungen (ohne Entwurf/Storno, Gutschriften negativ), je Firma.
-- Herkunft einer Firma: Eintrag in crm.werbe_herkunft (von Hand) – sonst die Quelle ihrer Anfrage (crm.leads.source).
-- Kosten = Abbuchungen aus dem Kontoauszug (crm.liq_buchungen): FACEBK… → Facebook/Instagram, PAGRO/POST → Briefe.
-- crm.werbekosten: Ausnahmen je Buchung (kanal null = zählt nicht) und von Hand nachgetragene Kosten.

create table if not exists crm.werbe_herkunft (
  firma_key text primary key,              -- Firmenname klein, Leerzeichen zusammengezogen (wie in der Seite)
  firma text not null,
  kanal text not null check (kanal in ('facebook','instagram','brief','website','empfehlung','sonstiges')),
  geaendert_am timestamptz not null default now()
);

create table if not exists crm.werbekosten (
  id uuid primary key default gen_random_uuid(),
  buchung_id uuid unique references crm.liq_buchungen(id) on delete cascade,
  kanal text check (kanal in ('meta','brief','sonstiges')),
  datum date,
  betrag numeric(12,2) check (betrag is null or betrag >= 0),
  text text,
  erstellt_am timestamptz not null default now(),
  -- Ausnahme zu einer Buchung (kanal null = nicht mitzählen) ODER eigener Kosteneintrag mit Datum, Kanal, Betrag
  check (buchung_id is not null or (kanal is not null and datum is not null and betrag is not null))
);

alter table crm.werbe_herkunft enable row level security;
alter table crm.werbekosten enable row level security;
create policy werbe_herkunft_inhaber on crm.werbe_herkunft for all to authenticated using (crm.ist_inhaber()) with check (crm.ist_inhaber());
create policy werbekosten_inhaber on crm.werbekosten for all to authenticated using (crm.ist_inhaber()) with check (crm.ist_inhaber());
grant select, insert, update, delete on crm.werbe_herkunft, crm.werbekosten to authenticated;

-- Herkunft laut Christoph (24.11.2026): Diese Kunden kamen über eine Facebook-Anzeige bzw. einen Brief –
-- auch die aus der Nähe wurden erst durch die Anzeige aufmerksam.
insert into crm.werbe_herkunft (firma_key, firma, kanal)
select lower(regexp_replace(trim(f), '\s+', ' ', 'g')), trim(f), k
from (values
  ('SETEC GmbH', 'facebook'),
  ('Monti.pro - Günter Zerzawy e.U.', 'facebook'),
  ('Pachlinger GmbH', 'facebook'),
  ('Ruff Michael GmbH', 'facebook'),
  ('Mathias Trippl', 'facebook'),
  ('Mechanische Instandhaltung Trippl', 'facebook'),
  ('Andreas Johann Dörflinger', 'facebook'),
  ('Dörflinger Wasser- und Heizungstechnik', 'facebook'),
  ('HTP Kellner GmbH', 'facebook'),
  ('Steron GmbH', 'facebook'),
  ('Fliesentechnik & Natursteinteppich Tilger - Gottfried Tilger', 'facebook'),
  ('Sonnenoase - Wilfinger & Kancz Wintergarten GmbH', 'brief'),
  ('Holzbau Lengauer-Stockner GmbH', 'brief'),
  ('Christian Netzker GmbH', 'brief')
) as v(f, k)
on conflict (firma_key) do nothing;
