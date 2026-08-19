// js/creator/creator.js
import { supabase, requireAuth, getProfile } from '../lib/supabase.js';
import { BUCKETS } from '../lib/config.js';
import { trimVideo } from './videoTrimmer.js';

const $ = (id) => document.getElementById(id);
await requireAuth();
// Opcion B: cualquier usuario autenticado puede crear escenas.
const profile = await getProfile();

const state = { file: null, trimmedBlob: null, chars: [], dialogues: [], duration: 30 };

// ---- 1. Subir ----
$('videoInput').addEventListener('change', (e) => {
  state.file = e.target.files[0];
  if (!state.file) return;
  const url = URL.createObjectURL(state.file);
  const v = $('preview');
  v.src = url; v.classList.remove('hidden');
  v.onloadedmetadata = () => {
    state.duration = v.duration;
    $('outPoint').value = Math.min(30, v.duration).toFixed(1);
  };
  $('trimSection').classList.remove('hidden');
  $('charSection').classList.remove('hidden');
});

// ---- 2. Recorte ----
$('trimBtn').addEventListener('click', async () => {
  const inP = parseFloat($('inPoint').value), outP = parseFloat($('outPoint').value);
  if (outP <= inP) return alert('El fin debe ser mayor que el inicio');
  $('trimBtn').disabled = true;
  try {
    state.trimmedBlob = await trimVideo(state.file, inP, outP, $('aspect').value,
      (s) => $('trimStatus').textContent = s);
    state.duration = outP - inP;
    const v = $('preview'); v.src = URL.createObjectURL(state.trimmedBlob);
    $('trimStatus').textContent = '✅ Recortado';
    $('dialSection').classList.remove('hidden');
    $('publishSection').classList.remove('hidden');
  } catch (err) {
    $('trimStatus').textContent = 'Error: ' + err.message;
  } finally { $('trimBtn').disabled = false; }
});

// ---- 3. Personajes ----
$('addChar').addEventListener('click', () => {
  const name = $('charName').value.trim();
  if (!name) return;
  state.chars.push({ name, color: $('charColor').value });
  $('charName').value = '';
  renderChars();
});
function renderChars() {
  $('charList').innerHTML = state.chars.map((c,i) => `
    <div class="flex items-center gap-2 glass rounded-lg px-3 py-2 text-sm">
      <span class="w-3 h-3 rounded-full" style="background:${c.color}"></span>
      <span class="flex-1">${c.name}</span>
      <button data-i="${i}" class="del-char text-rose-400">✕</button>
    </div>`).join('');
  document.querySelectorAll('.del-char').forEach(b =>
    b.addEventListener('click', () => { state.chars.splice(+b.dataset.i,1); renderChars(); }));
}

// ---- 4. Deteccion de dialogos (MOCKUP) ----
// En produccion: subir audio a un servicio de STT + diarizacion
// (ej. Whisper / AssemblyAI / Google Speech) que devuelva
// segmentos {start, end, speaker, text}. Aqui generamos segmentos
// de ejemplo repartidos en la duracion para poder probar el flujo.
$('detectBtn').addEventListener('click', () => {
  if (!state.chars.length) return alert('Añade personajes primero');
  const n = Math.max(3, Math.round(state.duration / 4));
  const seg = state.duration / n;
  state.dialogues = Array.from({ length: n }, (_, i) => ({
    line_order: i + 1,
    start_time: +(i * seg).toFixed(2),
    end_time: +((i + 1) * seg - 0.3).toFixed(2),
    character: state.chars[i % state.chars.length].name,
    original_text: '',
    translated_text: '',
  }));
  renderDialogues();
});

function renderDialogues() {
  $('dialList').innerHTML = state.dialogues.map((d,i) => `
    <div class="glass rounded-lg p-3 text-sm space-y-2">
      <div class="flex gap-2 items-center">
        <select data-i="${i}" class="dlg-char glass rounded px-2 py-1 bg-transparent text-xs">
          ${state.chars.map(c => `<option class="bg-slate-800" ${c.name===d.character?'selected':''}>${c.name}</option>`).join('')}
        </select>
        <span class="text-xs font-mono text-slate-400">${d.start_time}s → ${d.end_time}s</span>
      </div>
      <input data-i="${i}" class="dlg-orig w-full glass rounded px-2 py-1 text-xs" placeholder="Texto original" value="${d.original_text}">
      <input data-i="${i}" class="dlg-trad w-full glass rounded px-2 py-1 text-xs" placeholder="Traducción español" value="${d.translated_text}">
    </div>`).join('');
  document.querySelectorAll('.dlg-char').forEach(el => el.addEventListener('change', e => state.dialogues[+e.target.dataset.i].character = e.target.value));
  document.querySelectorAll('.dlg-orig').forEach(el => el.addEventListener('input', e => state.dialogues[+e.target.dataset.i].original_text = e.target.value));
  document.querySelectorAll('.dlg-trad').forEach(el => el.addEventListener('input', e => state.dialogues[+e.target.dataset.i].translated_text = e.target.value));
}

// ---- 5. Publicar ----
$('publishBtn').addEventListener('click', async () => {
  const title = $('sceneTitle').value.trim();
  if (!title) return alert('Ponle título');
  if (!state.trimmedBlob) return alert('Recorta el video primero');
  const st = $('publishStatus');
  st.textContent = 'Subiendo video...';
  $('publishBtn').disabled = true;

  try {
    const { data: { user } } = await supabase.auth.getUser();
    // subir video recortado
    const path = `${user.id}/${Date.now()}.mp4`;
    await supabase.storage.from(BUCKETS.scenesSource).upload(path, state.trimmedBlob, { contentType: 'video/mp4' });
    const { data: pub } = supabase.storage.from(BUCKETS.scenesSource).getPublicUrl(path);

    // crear escena
    st.textContent = 'Creando escena...';
    const { data: scene } = await supabase.from('scenes').insert({
      title, source_video_url: pub.publicUrl, duration_seconds: state.duration,
      aspect_ratio: $('aspect').value, status: 'published', created_by: user.id,
    }).select().single();

    // personajes
    const charRows = state.chars.map(c => ({ scene_id: scene.id, name: c.name, color: c.color }));
    const { data: insertedChars } = await supabase.from('characters').insert(charRows).select();
    const charMap = Object.fromEntries(insertedChars.map(c => [c.name, c.id]));

    // dialogos
    const dlgRows = state.dialogues.map(d => ({
      scene_id: scene.id, character_id: charMap[d.character],
      line_order: d.line_order, start_time: d.start_time, end_time: d.end_time,
      original_text: d.original_text, translated_text: d.translated_text,
    }));
    if (dlgRows.length) await supabase.from('dialogues').insert(dlgRows);

    st.textContent = '✅ ¡Publicada!';
    setTimeout(() => location.href = '/dashboard.html', 900);
  } catch (err) {
    st.textContent = 'Error: ' + err.message;
  } finally { $('publishBtn').disabled = false; }
});
