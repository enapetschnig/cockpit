-- Sicherheit: Wünsche, Besprechungen, Mahnungen und Roboter nur noch für den Inhaber.
--
-- Bisher galt hier "jedes angemeldete Konto darf alles" (using true). Im Projekt gibt es aber
-- auch Konten anderer Apps (Kunde, Demo) – und über roboter_auftraege/roboter_fragen/roboter_apps
-- hätte so ein Konto dem Roboter am PC Aufträge unterschieben können (Code ändern + live schalten).
-- Der Roboter selbst arbeitet über die Supabase-Verwaltungs-API (Rolle postgres) und ist nicht betroffen.
-- Die Regeln werden nur umgestellt (alter policy), nicht neu angelegt – es gibt keinen Moment ohne Regel.

create or replace function crm.ist_inhaber()
returns boolean
language sql
stable
set search_path = ''
as $$
  -- napetschnig.chris@gmail.com – dem gehören alle CRM-Daten
  select coalesce((select auth.uid()) = '83edc9c7-26a7-4f56-8806-cdfe253b9751'::uuid, false)
$$;

alter policy app_wuensche_alle on crm.app_wuensche using (crm.ist_inhaber()) with check (crm.ist_inhaber());
alter policy app_wuensche_alle on crm.app_wuensche rename to app_wuensche_inhaber;

alter policy besprechungen_alle on crm.besprechungen using (crm.ist_inhaber()) with check (crm.ist_inhaber());
alter policy besprechungen_alle on crm.besprechungen rename to besprechungen_inhaber;

alter policy mahnungen_alle on crm.mahnungen using (crm.ist_inhaber()) with check (crm.ist_inhaber());
alter policy mahnungen_alle on crm.mahnungen rename to mahnungen_inhaber;

alter policy roboter_apps_alle on crm.roboter_apps using (crm.ist_inhaber()) with check (crm.ist_inhaber());
alter policy roboter_apps_alle on crm.roboter_apps rename to roboter_apps_inhaber;

alter policy roboter_auftraege_alle on crm.roboter_auftraege using (crm.ist_inhaber()) with check (crm.ist_inhaber());
alter policy roboter_auftraege_alle on crm.roboter_auftraege rename to roboter_auftraege_inhaber;

alter policy roboter_fragen_alle on crm.roboter_fragen using (crm.ist_inhaber()) with check (crm.ist_inhaber());
alter policy roboter_fragen_alle on crm.roboter_fragen rename to roboter_fragen_inhaber;

alter policy roboter_puls_lesen on crm.roboter_puls using (crm.ist_inhaber());
alter policy roboter_puls_lesen on crm.roboter_puls rename to roboter_puls_inhaber;
