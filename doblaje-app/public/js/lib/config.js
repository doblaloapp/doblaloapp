// js/lib/config.js
// ============================================================
// Rellena estos dos valores con los de tu proyecto Supabase.
// Supabase Dashboard > Project Settings > API
// La ANON KEY es publica (segura para el frontend);
// NUNCA pongas aqui la service_role key.
// ============================================================
export const SUPABASE_URL = 'https://TU-PROYECTO.supabase.co';
export const SUPABASE_ANON_KEY = 'TU_ANON_KEY_PUBLICA';

export const BUCKETS = {
  scenesSource: 'scenes-source',
  meTracks: 'me-tracks',
  userTakes: 'user-takes',
  finalRenders: 'final-renders',
};
