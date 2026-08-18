-- ============================================================
-- ESQUEMA INICIAL - Estudio de Doblaje Latino
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- Jerarquia: Escena -> Personajes -> Dialogos -> Tomas
-- ============================================================

-- ---------- PERFILES (extiende auth.users) ----------
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  username text unique,
  role text not null default 'actor' check (role in ('actor','creator','admin')),
  created_at timestamptz default now()
);

-- Crear perfil automaticamente al registrarse
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, username)
  values (new.id, coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1)));
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------- ESCENAS ----------
create table if not exists public.scenes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  source_video_url text not null,
  me_track_url text,
  duration_seconds numeric not null default 0,
  aspect_ratio text default '16:9',
  thumbnail_url text,
  status text default 'draft' check (status in ('draft','published','archived')),
  created_by uuid references public.profiles(id),
  created_at timestamptz default now()
);

-- ---------- PERSONAJES ----------
create table if not exists public.characters (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid references public.scenes(id) on delete cascade,
  name text not null,
  color text default '#8b5cf6',
  avatar_url text,
  created_at timestamptz default now()
);

-- ---------- DIALOGOS (lineas con timecodes) ----------
create table if not exists public.dialogues (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid references public.scenes(id) on delete cascade,
  character_id uuid references public.characters(id) on delete cascade,
  line_order int not null,
  start_time numeric not null,
  end_time numeric not null,
  original_text text,
  translated_text text,
  created_at timestamptz default now()
);
create index if not exists idx_dialogues_scene on public.dialogues(scene_id, line_order);

-- ---------- PROYECTOS (sesion de doblaje de un usuario) ----------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid references public.scenes(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  title text,
  status text default 'in_progress' check (status in ('in_progress','completed','rendering')),
  final_video_url text,
  progress int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.project_characters (
  project_id uuid references public.projects(id) on delete cascade,
  character_id uuid references public.characters(id) on delete cascade,
  primary key (project_id, character_id)
);

-- ---------- TOMAS ----------
create table if not exists public.takes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  dialogue_id uuid references public.dialogues(id) on delete cascade,
  audio_url text not null,
  is_selected boolean default true,
  offset_ms int default 0,
  gain_db numeric default 0,
  voice_profile text default 'natural',
  duration_seconds numeric,
  created_at timestamptz default now(),
  unique (project_id, dialogue_id)
);
create index if not exists idx_takes_project on public.takes(project_id, dialogue_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.profiles enable row level security;
alter table public.scenes enable row level security;
alter table public.characters enable row level security;
alter table public.dialogues enable row level security;
alter table public.projects enable row level security;
alter table public.project_characters enable row level security;
alter table public.takes enable row level security;

-- perfiles
drop policy if exists "profiles_self_read" on public.profiles;
create policy "profiles_self_read" on public.profiles for select using (true);
drop policy if exists "profiles_self_update" on public.profiles;
create policy "profiles_self_update" on public.profiles for update using (id = auth.uid());

-- escenas
drop policy if exists "scenes_read" on public.scenes;
create policy "scenes_read" on public.scenes
  for select using (status = 'published' or created_by = auth.uid());
drop policy if exists "scenes_creator_write" on public.scenes;
create policy "scenes_creator_write" on public.scenes
  for insert with check (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('creator','admin'))
  );
drop policy if exists "scenes_creator_update" on public.scenes;
create policy "scenes_creator_update" on public.scenes
  for update using (created_by = auth.uid());

-- personajes y dialogos (lectura libre para autenticados)
drop policy if exists "characters_read" on public.characters;
create policy "characters_read" on public.characters for select using (true);
drop policy if exists "characters_write" on public.characters;
create policy "characters_write" on public.characters for all using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('creator','admin'))
);

drop policy if exists "dialogues_read" on public.dialogues;
create policy "dialogues_read" on public.dialogues for select using (true);
drop policy if exists "dialogues_write" on public.dialogues;
create policy "dialogues_write" on public.dialogues for all using (
  exists (select 1 from public.profiles where id = auth.uid() and role in ('creator','admin'))
);

-- proyectos y tomas (solo el dueno)
drop policy if exists "projects_owner_all" on public.projects;
create policy "projects_owner_all" on public.projects
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "project_chars_owner" on public.project_characters;
create policy "project_chars_owner" on public.project_characters
  for all using (project_id in (select id from public.projects where user_id = auth.uid()));

drop policy if exists "takes_owner_all" on public.takes;
create policy "takes_owner_all" on public.takes
  for all using (project_id in (select id from public.projects where user_id = auth.uid()));

-- ============================================================
-- STORAGE BUCKETS (crear tambien desde el Dashboard si prefieres)
-- ============================================================
insert into storage.buckets (id, name, public)
values
  ('scenes-source','scenes-source', true),
  ('me-tracks','me-tracks', true),
  ('user-takes','user-takes', true),
  ('final-renders','final-renders', true)
on conflict (id) do nothing;

-- Politicas de storage: cada usuario escribe en su propia carpeta
drop policy if exists "takes_upload_own" on storage.objects;
create policy "takes_upload_own" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'user-takes' and (storage.foldername(name))[1] = auth.uid()::text
  );
drop policy if exists "takes_read_all" on storage.objects;
create policy "takes_read_all" on storage.objects
  for select using (bucket_id in ('user-takes','scenes-source','me-tracks','final-renders'));
drop policy if exists "renders_upload_own" on storage.objects;
create policy "renders_upload_own" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'final-renders' and (storage.foldername(name))[1] = auth.uid()::text
  );
drop policy if exists "source_upload_creator" on storage.objects;
create policy "source_upload_creator" on storage.objects
  for insert to authenticated with check (bucket_id in ('scenes-source','me-tracks'));
