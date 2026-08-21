-- ============================================================
-- 003 · Permitir ELIMINAR escenas (y en cascada su contenido)
-- Ejecutar en Supabase > SQL Editor.
-- Los proyectos y tomas ya se pueden borrar por su dueño
-- (política projects_owner_all cubre delete).
-- Al borrar una escena, characters/dialogues/projects/takes se
-- eliminan solos por las llaves foráneas ON DELETE CASCADE.
-- ============================================================

drop policy if exists "scenes_owner_delete" on public.scenes;
create policy "scenes_owner_delete" on public.scenes
  for delete to authenticated
  using (created_by = auth.uid() or created_by is null);
