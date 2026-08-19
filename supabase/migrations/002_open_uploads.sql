-- ============================================================
-- OPCION B: Subida abierta a todos los usuarios autenticados.
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- Reemplaza las politicas que exigian rol 'creator'/'admin'.
-- ============================================================

-- --- ESCENAS: cualquier autenticado puede crear ---
drop policy if exists "scenes_creator_write" on public.scenes;
drop policy if exists "scenes_open_write" on public.scenes;
create policy "scenes_open_write" on public.scenes
  for insert to authenticated with check (true);

-- puede actualizar/borrar solo sus propias escenas
drop policy if exists "scenes_creator_update" on public.scenes;
create policy "scenes_owner_update" on public.scenes
  for update to authenticated using (created_by = auth.uid());

-- --- PERSONAJES: escritura para autenticados ---
drop policy if exists "characters_write" on public.characters;
drop policy if exists "characters_open_write" on public.characters;
create policy "characters_open_write" on public.characters
  for all to authenticated using (true) with check (true);

-- --- DIALOGOS: escritura para autenticados ---
drop policy if exists "dialogues_write" on public.dialogues;
drop policy if exists "dialogues_open_write" on public.dialogues;
create policy "dialogues_open_write" on public.dialogues
  for all to authenticated using (true) with check (true);

-- --- STORAGE: subir video/M&E abierto a autenticados ---
drop policy if exists "source_upload_creator" on storage.objects;
drop policy if exists "source_upload_open" on storage.objects;
create policy "source_upload_open" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('scenes-source','me-tracks'));
