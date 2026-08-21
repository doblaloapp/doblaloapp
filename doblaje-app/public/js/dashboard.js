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
    <div class="glass rounded-2xl overflow-hidden hover:bg-white/10 transition group relative">
      <button class="del-scene absolute top-2 right-2 z-10 bg-black/60 hover:bg-rose-600 rounded-lg px-2 py-1 text-xs" data-id="${s.id}" title="Eliminar escena">🗑</button>
      <a href="/studio.html?scene=${s.id}" class="block">
        <div class="aspect-video bg-black/40 flex items-center justify-center text-4xl">🎞️</div>
        <div class="p-4">
          <h3 class="font-semibold group-hover:text-violet-300">${s.title}</h3>
          <p class="text-xs text-slate-400 mt-1">${Math.round(s.duration_seconds)}s</p>
        </div>
      </a>
    </div>`).join('')
    : '<p class="text-slate-400">No hay escenas publicadas todavia. Crea una con "+ Crear escena".</p>';

  document.querySelectorAll('.del-scene').forEach(b => b.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!confirm('¿Eliminar esta escena y todo su contenido? No se puede deshacer.')) return;
    const { error } = await supabase.from('scenes').delete().eq('id', b.dataset.id);
    if (error) return alert('No se pudo eliminar: ' + error.message);
    b.closest('.glass').remove();
  }));
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
    <div class="glass rounded-2xl p-4 hover:bg-white/10 transition relative">
      <button class="del-project absolute top-2 right-2 z-10 bg-black/60 hover:bg-rose-600 rounded-lg px-2 py-1 text-xs" data-id="${p.id}" title="Eliminar grabación">🗑</button>
      <a href="/studio.html?scene=${p.scene_id}&project=${p.id}" class="block">
        <h3 class="font-semibold pr-8">${p.scenes?.title ?? 'Proyecto'}</h3>
        <p class="text-xs text-slate-400 mt-1">${statusLabel[p.status] ?? p.status}</p>
        <div class="mt-3 h-2 rounded-full bg-white/10 overflow-hidden">
          <div class="xp-bar h-full bg-violet-500" style="width:${p.progress || 0}%"></div>
        </div>
      </a>
    </div>`).join('')
    : '<p class="text-slate-400">Aun no has empezado ningun doblaje.</p>';

  document.querySelectorAll('.del-project').forEach(b => b.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!confirm('¿Eliminar esta grabación (proyecto)? Tus tomas se borrarán. No se puede deshacer.')) return;
    const { error } = await supabase.from('projects').delete().eq('id', b.dataset.id);
    if (error) return alert('No se pudo eliminar: ' + error.message);
    b.closest('.glass').remove();
  }));
} catch (e) {
  showErr($('projectsGrid'), 'Error cargando proyectos: ' + (e.message || e));
  console.error('projects error:', e);
}
