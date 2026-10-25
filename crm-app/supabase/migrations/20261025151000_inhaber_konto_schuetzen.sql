-- Sicherheit (Audit 25.10.2026): Das Inhaber-Konto kann nicht mehr gelöscht werden.
-- CRM und Cockpit hängen an genau dieser User-ID (crm.ist_inhaber, INHABER_USER_IDS, über 2.400
-- user_id-Werte, Storage-Pfade). Im geteilten Projekt hätte es sonst z. B. die hws-Funktion
-- „Benutzer löschen“ entfernen können – absichtlich oder aus Versehen.
-- Wer das Konto wirklich löschen will, muss zuerst diesen Trigger entfernen.
create or replace function crm.inhaber_konto_schuetzen() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.id = '83edc9c7-26a7-4f56-8806-cdfe253b9751'::uuid then
    raise exception 'Das Inhaber-Konto ist geschützt und kann nicht gelöscht werden.';
  end if;
  return old;
end $$;
grant usage on schema crm to supabase_auth_admin;
grant execute on function crm.inhaber_konto_schuetzen() to supabase_auth_admin;
create or replace trigger inhaber_konto_schuetzen before delete on auth.users
  for each row execute function crm.inhaber_konto_schuetzen();
