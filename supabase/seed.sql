-- ============================================================
-- DATOS DE EJEMPLO (opcional) - para probar el estudio rapido.
-- Usa un video de dominio publico (Big Buck Bunny) como stand-in.
-- Ejecutar DESPUES de 001_initial_schema.sql
-- ============================================================
do $$
declare
  v_scene uuid;
  c_billy uuid;
  c_mandy uuid;
  c_hueso uuid;
begin
  insert into public.scenes (title, description, source_video_url, duration_seconds, status)
  values (
    'Billy y Mandy - Demo 30s',
    'Escena de prueba para el estudio de doblaje.',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
    30, 'published'
  ) returning id into v_scene;

  insert into public.characters (scene_id, name, color)
  values (v_scene,'Billy','#f59e0b') returning id into c_billy;
  insert into public.characters (scene_id, name, color)
  values (v_scene,'Mandy','#ec4899') returning id into c_mandy;
  insert into public.characters (scene_id, name, color)
  values (v_scene,'Puro Hueso','#22d3ee') returning id into c_hueso;

  insert into public.dialogues (scene_id, character_id, line_order, start_time, end_time, original_text, translated_text) values
    (v_scene, c_billy, 1, 1.0, 4.0, 'Hey Mandy, look at this!', 'Oye Mandy, mira esto!'),
    (v_scene, c_mandy, 2, 4.5, 7.5, 'That is disgusting, Billy.', 'Eso es asqueroso, Billy.'),
    (v_scene, c_hueso,3, 8.0, 12.0, 'Foolish mortals...', 'Mortales insensatos...'),
    (v_scene, c_billy, 4, 12.5, 15.5, 'Can we keep it? Please?', 'Podemos quedarnoslo? Por favor?'),
    (v_scene, c_mandy, 5, 16.0, 19.0, 'Absolutely not.', 'Definitivamente no.'),
    (v_scene, c_hueso,6, 19.5, 24.0, 'You will regret this decision.', 'Te arrepentiras de esta decision.');
end $$;
