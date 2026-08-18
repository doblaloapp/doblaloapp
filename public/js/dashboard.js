// js/dashboard.js
import { supabase, requireAuth, getProfile } from './lib/supabase.js';

await requireAuth();
const profile = await getProfile();
document.getElementById('userBadge').textContent = profile?.username ? `@${profile.username}` : '';
if (profile?.role === 'creator' || profile?.role === 'admin') {
  document.getElementById('creatorLink').classList.remove('hidden');
}

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await supabase.auth.signOut();
  location.href = '/index.html';
});

// ---- Escenas publicadas ----
const { data: scenes } = await supabase
  .from('scenes').select('*, characters(count)')
  .eq('status', 'published').order('created_at', { ascending: false });

const grid = document.getElementById('scenesGrid');
grid.innerHTML = (scenes && scenes.length) ? scenes.map(s => `
  <a href="/studio.html?scene=${s.id}"
     class="glass rounded-2xl overflow-hidden hover:bg-white/10 transition group">
    <div class="aspect-video bg-black/40 flex items-center justify-center text-4xl">🎞️</div>
    <div class="p-4">
      <h3 class="font-semibold group-hover:text-violet-300">${s.title}</h3>
      <p class="text-xs text-slate-400 mt-1">${Math.round(s.duration_seconds)}s · ${s.characters?.[0]?.count ?? 0} personajes</p>
    </div>
  </a>`).join('') : '<p class="text-slate-400">No hay escenas publicadas todavia.</p>';

// ---- Mis proyectos ----
const { data: { user } } = await supabase.auth.getUser();
const { data: projects } = await supabase
  .from('projects').select('*, scenes(title)')
  .eq('user_id', user.id).order('updated_at', { ascending: false });

const pg = document.getElementById('projectsGrid');
const statusLabel = { in_progress: '🎙️ En progreso', completed: '✅ Terminado', rendering: '⏳ Renderizando' };
pg.innerHTML = (projects && projects.length) ? projects.map(p => `
  <a href="/studio.html?scene=${p.scene_id}&project=${p.id}"
     class="glass rounded-2xl p-4 hover:bg-white/10 transition">
    <h3 class="font-semibold">${p.scenes?.title ?? 'Proyecto'}</h3>
    <p class="text-xs text-slate-400 mt-1">${statusLabel[p.status] ?? p.status}</p>
    <div class="mt-3 h-2 rounded-full bg-white/10 overflow-hidden">
      <div class="xp-bar h-full bg-violet-500" style="width:${p.progress || 0}%"></div>
    </div>
  </a>`).join('') : '<p class="text-slate-400">Aun no has empezado ningun doblaje.</p>';
