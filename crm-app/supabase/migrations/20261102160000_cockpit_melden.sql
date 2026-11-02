-- „Änderung melden" im Cockpit selbst (02.11.2026, Christoph: »baue das tool mit den änderungswünschen das mit
-- bildschirmaufnahme auch in meinem cockpit ein«).
--
-- Die Meldungen landen direkt in crm.app_wuensche (app_key 'cockpit') – kein Umweg über den Eingang, das Cockpit IST
-- die Wünsche-Ablage. Dateien im eigenen privaten Ablagebereich `cockpit-wuensche`; in bild_pfad/audio_pfad/
-- aufnahme_pfad steht der Bereich vorne dran (»cockpit-wuensche/<uid>/<datei>«), so erkennt der Roboter den Speicher.

insert into storage.buckets (id, name, public, file_size_limit)
values ('cockpit-wuensche', 'cockpit-wuensche', false, 52428800)
on conflict (id) do nothing;

-- Nur der Inhaber (wie alle CRM-Tabellen seit 25.10.2026).
create policy cockpit_wuensche_inhaber_lesen on storage.objects for select to authenticated
  using (bucket_id = 'cockpit-wuensche' and crm.ist_inhaber());
create policy cockpit_wuensche_inhaber_hochladen on storage.objects for insert to authenticated
  with check (bucket_id = 'cockpit-wuensche' and crm.ist_inhaber() and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Ablauf der Vorführung (Sekunde → Seite/Knopf) für die Abschrift (Function wunsch-abschrift).
alter table crm.app_wuensche add column if not exists aufnahme_ablauf jsonb;

-- Der Roboter setzt Cockpit-Wünsche selbst um, wie bei allen Apps (YOLO).
insert into crm.roboter_apps (app_key, yolo) values ('cockpit', true)
on conflict (app_key) do update set yolo = true;
