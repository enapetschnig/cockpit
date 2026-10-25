-- Sicherheit (Audit 25.10.2026, Teil 2): das ganze CRM gehört allein dem Inhaber.
--
-- 1) Die übrigen 18 Tabellen hatten noch „eigene Zeilen“-Policies für die Rolle public
--    (auth.uid() = user_id). Lesen konnte ein fremdes Konto im geteilten Projekt damit nichts,
--    aber eigene Zeilen ANLEGEN – z. B. einen Vertrag, den /unterschreiben dann mit ePower-Logo
--    ausgeliefert hätte. Jetzt: nur angemeldet UND Inhaber.
-- 2) anon bekommt im Schema crm keine Tabellenrechte mehr – auch nicht für künftige Tabellen
--    (eine neue Tabelle ohne RLS wäre sonst sofort öffentlich).
-- 3) Funktionen: nicht mehr für PUBLIC/anon ausführbar; Trigger-Funktion mit festem search_path.
--
-- ALTER statt DROP: Die Policies behalten ihren Namen, nichts ist auch nur kurz offen.
-- Daten werden nicht angefasst. Inhaber-Login, Cockpit (postgres) und die API-Funktionen
-- (Service-Role) arbeiten unverändert weiter.

do $$
declare r record;
begin
  for r in select tablename, policyname, cmd from pg_policies where schemaname = 'crm' and roles = '{public}' loop
    if r.cmd in ('SELECT', 'DELETE') then
      execute format('alter policy %I on crm.%I to authenticated using (crm.ist_inhaber())', r.policyname, r.tablename);
    elsif r.cmd = 'INSERT' then
      execute format('alter policy %I on crm.%I to authenticated with check (crm.ist_inhaber())', r.policyname, r.tablename);
    else
      execute format('alter policy %I on crm.%I to authenticated using (crm.ist_inhaber()) with check (crm.ist_inhaber())', r.policyname, r.tablename);
    end if;
  end loop;
end $$;

-- 2) Rechte: anon nichts, authenticated nur Lesen/Schreiben (RLS entscheidet den Rest)
revoke all on all tables in schema crm from anon;
revoke all on all sequences in schema crm from anon;
revoke truncate, references, trigger on all tables in schema crm from authenticated;
alter default privileges for role postgres in schema crm revoke all on tables from anon;
alter default privileges for role postgres in schema crm revoke all on sequences from anon;
alter default privileges for role postgres in schema crm revoke truncate, references, trigger on tables from authenticated;
do $$
begin
  -- MAINTAIN gibt es erst ab Postgres 17
  if current_setting('server_version_num')::int >= 170000 then
    execute 'revoke maintain on all tables in schema crm from authenticated, anon';
    execute 'alter default privileges for role postgres in schema crm revoke maintain on tables from authenticated, anon';
  end if;
end $$;

-- 3) Funktionen: nur angemeldete Konten (die Policies und die Nummernkreise brauchen das)
revoke execute on all functions in schema crm from public, anon;
alter default privileges for role postgres in schema crm revoke execute on functions from public;
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'crm' and p.proname in ('ist_inhaber', 'next_document_number', 'next_contract_number') loop
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
alter function crm.roboter_apps_umschaltzeit() set search_path = '';
