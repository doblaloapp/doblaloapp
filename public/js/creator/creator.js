// js/creator/creator.js
import { supabase, requireAuth } from '../lib/supabase.js';
import { BUCKETS } from '../lib/config.js';
import { trimVideo } from './videoTrimmer.js';

const $ = (id) => document.getElementById(id);
await requireAuth();

// Paleta para asignar colores a los hablantes detectados
const PALETTE = ['#f59e0b','#ec4899','#22d3ee','#8b5cf6','#34d399','#f43f5e','#60a5fa','#a3e635'];

const state = {
  file: null,
  trimmedBlob: null,
  sceneVideoUrl: null,   // url publica del video recortado ya subido
  storagePath: null,
  duration: 30,
  utterances: [],        // [{speaker,text,start,end}] de AssemblyAI
  speakers: {},          // 'A' -> { name, color }
};

// ============ Paso 1: Subir ============
$('videoInput').addEventListener('change', (e) => {
  state.file = e.target.files[0];
  if (!state.file) return;
  const v = $('preview');
  v.src = URL.createObjectURL(state.file);
  v.classList.remove('hidden');
  v.onloadedmetadata = () => {
    state.duration = v.duration;
    $('outPoint').value = Math.min(30, v.duration).toFixed(1);
  };
  $('trimSection').classList.remove('hidden');
});

// ============ Paso 2: Recortar + subir ============
$('trimBtn').addEventListener('click', async () => {
  const inP = parseFloat($('inPoint').value), outP = parseFloat($('outPoint').value);
  if (outP <= inP) return alert('El fin debe ser mayor que el inicio');
  $('trimBtn').disabled = true;
  const st = $('trimStatus');
  try {
    st.textContent = 'Recortando...';
    state.trimmedBlob = await trimVideo(state.file, inP, outP, $('aspect').value, (s) => st.textContent = s);
    state.duration = outP - inP;
    $('preview').src = URL.createObjectURL(state.trimmedBlob);

    // subir de una vez (lo necesitamos para que la IA lea el audio por URL)
    st.textContent = 'Subiendo a la nube...';
    const { data: { user } } = await supabase.auth.getUser();
    state.storagePath = `${user.id}/${Date.now()}.mp4`;
    const up = await supabase.storage.from(BUCKETS.scenesSource)
      .upload(state.storagePath, state.trimmedBlob, { contentType: 'video/mp4' });
    if (up.error) throw up.error;
    const { data: pub } = supabase.storage.from(BUCKETS.scenesSource).getPublicUrl(state.storagePath);
    state.sceneVideoUrl = pub.publicUrl;

    st.textContent = '\u2705 Listo';
    $('transSection').classList.remove('hidden');
  } catch (err) {
    st.textContent = 'Error: ' + (err.message || err);
  } finally { $('trimBtn').disabled = false; }
});

// ============ Paso 3: Transcripcion IA ============
$('analyzeBtn').addEventListener('click', async () => {
  if (!state.sceneVideoUrl) return alert('Primero recorta y sube el video');
  $('analyzeBtn').disabled = true;
  const st = $('analyzeStatus');
  $('analyzeBarWrap').classList.remove('hidden');
  try {
    st.textContent = 'Enviando a la IA...';
    // 1) iniciar
    const start = await callFn({ action: 'start', audioUrl: state.sceneVideoUrl });
    if (start.error) throw new Error(start.error);
    const id = start.id;

    // 2) sondear estado
    let done = null, tries = 0;
    while (!done) {
      await sleep(3000);
      tries++;
      $('analyzeBar').style.width = `${Math.min(90, tries * 8)}%`;
      st.textContent = 'Procesando audio... (esto tarda ~1-2 min)';
      const res = await callFn({ action: 'status', transcriptId: id });
      if (res.error) throw new Error(res.error);
      if (res.status === 'completed') done = res;
      if (tries > 60) throw new Error('Tiempo de espera agotado');
    }

    $('analyzeBar').style.width = '100%';
    state.utterances = done.utterances || [];
    if (!state.utterances.length) throw new Error('No se detectaron di\u00e1logos en el audio');

    st.textContent = `\u2705 ${state.utterances.length} l\u00edneas detectadas`;
    buildSpeakers();
    $('mapSection').classList.remove('hidden');
    $('publishSection').classList.remove('hidden');
  } catch (err) {
    st.textContent = 'Error: ' + (err.message || err);
  } finally { $('analyzeBtn').disabled = false; }
});

// invocar la Edge Function
async function callFn(body) {
  const { data, error } = await supabase.functions.invoke('transcribe', { body });
  if (error) {
    // intenta leer el cuerpo de error de la funcion
    try { return await error.context.json(); } catch { return { error: error.message }; }
  }
  return data;
}

// ============ Pasos 4 y 5: Mapear hablantes ============
function buildSpeakers() {
  const uniq = [...new Set(state.utterances.map(u => u.speaker))];
  state.speakers = {};
  uniq.forEach((sp, i) => {
    state.speakers[sp] = { name: `Personaje ${sp}`, color: PALETTE[i % PALETTE.length] };
  });
  renderSpeakers();
  renderLines();
}

function renderSpeakers() {
  $('speakerList').innerHTML = Object.entries(state.speakers).map(([sp, info]) => {
    const sample = state.utterances.find(u => u.speaker === sp)?.text || '';
    const count = state.utterances.filter(u => u.speaker === sp).length;
    return `
      <div class="glass rounded-xl p-3">
        <div class="flex items-center gap-2 mb-2">
          <span class="w-3 h-3 rounded-full" style="background:${info.color}"></span>
          <span class="text-xs text-slate-400">Hablante ${sp} &middot; ${count} l\u00edneas</span>
        </div>
        <input data-sp="${sp}" class="sp-name w-full glass rounded-lg px-3 py-2 text-sm mb-1"
               value="${info.name}" placeholder="Nombre del personaje">
        <p class="text-xs text-slate-500 italic truncate">"${sample}"</p>
      </div>`;
  }).join('');
  document.querySelectorAll('.sp-name').forEach(el =>
    el.addEventListener('input', e => {
      state.speakers[e.target.dataset.sp].name = e.target.value;
      renderLines();
    }));
}

function renderLines() {
  $('lineList').innerHTML = state.utterances.map((u, i) => {
    const info = state.speakers[u.speaker] || {};
    return `
      <div class="glass rounded-lg p-2 text-sm">
        <div class="flex justify-between items-center mb-1">
          <span class="text-xs font-semibold" style="color:${info.color}">${info.name || u.speaker}</span>
          <span class="text-[11px] font-mono text-slate-400">${(u.start/1000).toFixed(1)}s \u2192 ${(u.end/1000).toFixed(1)}s</span>
        </div>
        <input data-i="${i}" class="ln-text w-full bg-transparent border-b border-white/10 text-xs py-1"
               value="${(u.text||'').replace(/"/g,'&quot;')}">
      </div>`;
  }).join('');
  document.querySelectorAll('.ln-text').forEach(el =>
    el.addEventListener('input', e => state.utterances[+e.target.dataset.i].text = e.target.value));
}

// ============ Publicar ============
$('publishBtn').addEventListener('click', async () => {
  const title = $('sceneTitle').value.trim();
  if (!title) return alert('Ponle t\u00edtulo');
  if (!state.sceneVideoUrl) return alert('Falta el video');
  const st = $('publishStatus');
  $('publishBtn').disabled = true;

  try {
    const { data: { user } } = await supabase.auth.getUser();

    st.textContent = 'Creando escena...';
    const { data: scene, error: e1 } = await supabase.from('scenes').insert({
      title, source_video_url: state.sceneVideoUrl, duration_seconds: state.duration,
      aspect_ratio: $('aspect').value, status: 'published', created_by: user.id,
    }).select().single();
    if (e1) throw e1;

    // personajes desde el mapeo validado
    st.textContent = 'Guardando personajes...';
    const charRows = Object.values(state.speakers).map(s => ({ scene_id: scene.id, name: s.name, color: s.color }));
    const { data: chars, error: e2 } = await supabase.from('characters').insert(charRows).select();
    if (e2) throw e2;
    const nameToId = Object.fromEntries(chars.map(c => [c.name, c.id]));

    // dialogos desde las utterances
    st.textContent = 'Guardando di\u00e1logos...';
    const dlgRows = state.utterances.map((u, i) => ({
      scene_id: scene.id,
      character_id: nameToId[state.speakers[u.speaker].name],
      line_order: i + 1,
      start_time: +(u.start / 1000).toFixed(2),
      end_time: +(u.end / 1000).toFixed(2),
      original_text: u.text,
      translated_text: '',
    }));
    if (dlgRows.length) {
      const { error: e3 } = await supabase.from('dialogues').insert(dlgRows);
      if (e3) throw e3;
    }

    st.textContent = '\u2705 \u00a1Publicada!';
    setTimeout(() => location.href = '/dashboard.html', 900);
  } catch (err) {
    st.textContent = 'Error: ' + (err.message || err);
  } finally { $('publishBtn').disabled = false; }
});

// utils
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
