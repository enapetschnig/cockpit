-- Besprechungen aus Plaud: der PC (werkzeuge/plaud/plaud.mjs) holt neue Aufnahmen,
-- Claude ordnet sie einem Kunden oder Lead zu und zieht Zusammenfassung und
-- Handlungsschritte heraus. Das CRM zeigt sie beim Kunden bzw. Lead.
create table if not exists crm.besprechungen (
  id                uuid primary key default gen_random_uuid(),
  plaud_id          text not null unique,
  titel             text,
  beginn            timestamptz,
  dauer_sek         int,
  customer_id       uuid references crm.customers (id) on delete set null,
  lead_id           uuid references crm.leads (id) on delete set null,
  status            text not null default 'zugeordnet' check (status in ('zugeordnet', 'unklar', 'ignoriert')),
  begruendung       text,          -- warum Claude diesen Kunden gewählt hat (bzw. warum unklar)
  zusammenfassung   text,          -- Markdown, kurz
  handlungsschritte jsonb not null default '[]'::jsonb,  -- [{text, erledigt}]
  plaud_zusammenfassung text,      -- Plauds eigene Zusammenfassung (Markdown)
  transkript        text,
  gemeldet          timestamptz,   -- Telegram-Zeile verschickt
  erstellt_am       timestamptz not null default now(),
  aktualisiert      timestamptz not null default now()
);
create index if not exists besprechungen_customer on crm.besprechungen (customer_id);
create index if not exists besprechungen_lead on crm.besprechungen (lead_id);
create index if not exists besprechungen_beginn on crm.besprechungen (beginn desc);

alter table crm.besprechungen enable row level security;
drop policy if exists besprechungen_alle on crm.besprechungen;
create policy besprechungen_alle on crm.besprechungen for all to authenticated using (true) with check (true);
grant select, insert, update, delete on crm.besprechungen to authenticated;
