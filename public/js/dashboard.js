// js/dashboard.js
import { supabase, requireAuth, getProfile } from './lib/supabase.js';

const $ = (id) => document.getElementById(id);
const showErr = (el, msg) =>
  el.innerHTML = `<p class="text-rose-400 text-sm">⚠️ ${msg}</p>`;

// El boton de crear se muestra de inmediato (Opcion B), pase lo que pase.
$('creatorLink')?.classList.remove('hidden');

$('logoutBtn')?.addEventListener('click', async () => {
  await supabase.auth.signOut();
  location.href = '/index.html';
});

// --- Sesion ---
try {
  await requireAuth();
} catch (e) {
  showErr($('scenesGrid'), 'No hay sesion activa: ' + e.message);
}

// --- Perfil (no debe tumbar la pagina si falla) ---
try {
  const profile = await getProfile();
  $('userBadge').textContent = profile?.username ? `@${profile.username}` : '';
} catch (e) {
  console.warn('perfil:', e.message);
}

// --- Escenas publicadas ---
try {
  const { data: scenes, error } = await supabase
    .from('scenes').select('*')
    .eq('status', 'published')
    .order('created_at', { ascending: false });

  if (error) throw error;

  const grid = $('scenesGrid');
  grid.innerHTML = (scenes && scenes.length) ? scenes.map(s => `
    <a href="/studio.html?scene=${s.id}"
       class="glass rounded-2xl overflow-hidden hover:bg-white/10 transition group">
      <div class="aspect-video bg-black/40 flex items-center justify-center text-4xl">🎞️</div>
      <div class="p-4">
        <h3 class="font-semibold group-hover:text-violet-300">${s.title}</h3>
        <p class="text-xs text-slate-400 mt-1">${Math.round(s.duration_seconds)}s</p>
      </div>
    </a>`).join('')
    : '<p class="text-slate-400">No hay escenas publicadas todavia. Crea una con "+ Crear escena".</p>';
} catch (e) {
  showErr($('scenesGrid'), 'Error cargando escenas: ' + (e.message || e));
  console.error('scenes error:', e);
}

// --- Mis proyectos ---
try {
  const { data: { user } } = await supabase.auth.getUser();
  const { data: projects, error } = await supabase
    .from('projects').select('*, scenes(title)')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  if (error) throw error;

  const statusLabel = { in_progress: '🎙️ En progreso', completed: '✅ Terminado', rendering: '⏳ Renderizando' };
  const pg = $('projectsGrid');
  pg.innerHTML = (projects && projects.length) ? projects.map(p => `
    <a href="/studio.html?scene=${p.scene_id}&project=${p.id}"
       class="glass rounded-2xl p-4 hover:bg-white/10 transition">
      <h3 class="font-semibold">${p.scenes?.title ?? 'Proyecto'}</h3>
      <p class="text-xs text-slate-400 mt-1">${statusLabel[p.status] ?? p.status}</p>
      <div class="mt-3 h-2 rounded-full bg-white/10 overflow-hidden">
        <div class="xp-bar h-full bg-violet-500" style="width:${p.progress || 0}%"></div>
      </div>
    </a>`).join('')
    : '<p class="text-slate-400">Aun no has empezado ningun doblaje.</p>';
} catch (e) {
  showErr($('projectsGrid'), 'Error cargando proyectos: ' + (e.message || e));
  console.error('projects error:', e);
}
