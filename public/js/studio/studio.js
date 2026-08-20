// js/studio/studio.js
import { supabase, requireAuth } from '../lib/supabase.js';
import { BUCKETS } from '../lib/config.js';
import { LineRecorder } from './recorder.js';
import { createOriginalWave, createTakeWave } from './waveform.js';
import { PROFILES } from './voiceProfiles.js';
import { PreviewPlayer } from './audioEngine.js';
import { exportProject } from '../postproduction/exporter.js';

const $ = (id) => document.getElementById(id);
const qs = new URLSearchParams(location.search);

const state = {
  sceneId: qs.get('scene'),
  projectId: qs.get('project'),
  scene: null, characters: [], dialogues: [],
  myCharIds: new Set(),
  active: 0,
  takes: {},        // dialogueId -> { blob, url, offset_ms, gain_db, voice_profile }
  project: null,
};

const recorder = new LineRecorder();
const preview = new PreviewPlayer();
let waveOriginal, waveTake;
let currentProfile = 'natural';

await requireAuth();
try {
  await loadScene();
} catch (e) {
  console.error('loadScene error:', e);
  $('karaokeText').textContent = 'Error al cargar la escena';
  $('originalText').textContent = String(e.message || e);
}

// ============ CARGA ============
async function loadScene() {
  const { data: scene } = await supabase.from('scenes').select('*').eq('id', state.sceneId).single();
  state.scene = scene;
  $('sceneTitle').textContent = scene.title;
  $('videoPlayer').src = scene.source_video_url;
  $('videoPlayer').crossOrigin = 'anonymous';

  const { data: chars } = await supabase.from('characters').select('*').eq('scene_id', state.sceneId);
  state.characters = chars || [];
  // mapa id->personaje para resolver de forma segura (evita crash si falta el embed)
  state.charById = Object.fromEntries(state.characters.map(c => [c.id, c]));

  const { data: lines } = await supabase.from('dialogues')
    .select('*').eq('scene_id', state.sceneId).order('line_order');
  state.dialogues = lines || [];

  // DIAGNOSTICO visible en el encabezado (personajes / lineas cargados)
  const nc = state.characters.length, nd = state.dialogues.length;
  $('myChars').textContent = `Escena: ${nc} personajes · ${nd} líneas`;

  // Sin personajes: la escena quedo incompleta al crearla
  if (!nc) {
    $('karaokeText').textContent = 'Esta escena no tiene personajes guardados.';
    $('originalText').textContent = 'Créala de nuevo con el análisis de IA (paso 3 del creador).';
    $('megaBtn').disabled = true; $('megaBtn').style.opacity = '.4';
    return;
  }

  // Hay personajes -> mostrar el panel SIEMPRE (aunque falten lineas)
  if (state.projectId) { await preloadProject(); }
  renderCharModal();
}

// carga proyecto existente sin saltarse el panel de seleccion
async function preloadProject() {
  const { data: project } = await supabase.from('projects').select('*').eq('id', state.projectId).single();
  state.project = project;
  const { data: pc } = await supabase.from('project_characters')
    .select('character_id').eq('project_id', state.projectId);
  (pc || []).forEach(r => state.myCharIds.add(r.character_id)); // pre-marca en el modal
  const { data: takes } = await supabase.from('takes').select('*').eq('project_id', state.projectId);
  (takes || []).forEach(t => {
    state.takes[t.dialogue_id] = {
      url: t.audio_url, offset_ms: t.offset_ms, gain_db: t.gain_db, voice_profile: t.voice_profile, saved: true,
    };
  });
}

// ============ SELECCION DE PERSONAJES ============
function renderCharModal() {
  $('charOptions').innerHTML = state.characters.map(c => {
    const mine = state.myCharIds.has(c.id);
    const count = state.dialogues.filter(d => d.character_id === c.id).length;
    return `
    <label class="glass rounded-xl p-3 flex items-center gap-2 cursor-pointer hover:bg-white/10 transition ${mine?'ring-2 ring-violet-500':''}">
      <input type="checkbox" value="${c.id}" class="char-check accent-violet-500 w-4 h-4" ${mine?'checked':''}>
      <span class="w-3 h-3 rounded-full" style="background:${c.color}"></span>
      <span class="text-sm font-medium flex-1">${c.name}</span>
      <span class="text-[10px] text-slate-400">${count} líneas</span>
    </label>`;
  }).join('');
  showModal('charModal');
}

$('startStudioBtn').addEventListener('click', async () => {
  const checked = [...document.querySelectorAll('.char-check:checked')].map(cb => cb.value);
  if (!checked.length) return alert('Elige al menos un personaje');
  state.myCharIds = new Set(checked);
  await ensureProject();
  hideModal('charModal');
  await initStudio();
});

// crea el proyecto si no existe, o sincroniza la seleccion si ya existe
async function ensureProject() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!state.projectId) {
    const { data: project } = await supabase.from('projects')
      .insert({ scene_id: state.sceneId, user_id: user.id, title: state.scene.title })
      .select().single();
    state.project = project; state.projectId = project.id;
  }
  // sincronizar personajes elegidos
  await supabase.from('project_characters').delete().eq('project_id', state.projectId);
  const rows = [...state.myCharIds].map(cid => ({ project_id: state.projectId, character_id: cid }));
  if (rows.length) await supabase.from('project_characters').insert(rows);
}
// ============ INICIALIZAR ESTUDIO ============
async function initStudio() {
  const names = state.characters.filter(c => state.myCharIds.has(c.id)).map(c => c.name).join(', ');
  $('myChars').textContent = `Doblas: ${names}`;

  try { await recorder.init(); }
  catch { alert('Necesito permiso del micrófono para grabar 🎙️'); }

  waveOriginal = createOriginalWave('#waveOriginal', $('videoPlayer'));
  waveTake = createTakeWave('#waveTake');

  renderProfiles();
  renderScript();
  bindControls();
  goToFirstPending();
  updateXP();
}

// ============ FILTROS DE VOZ ============
function renderProfiles() {
  $('profileRow').innerHTML = PROFILES.map(p => `
    <div class="profile-card glass rounded-xl px-3 py-2 min-w-[84px] text-center ${p.id===currentProfile?'selected':''}"
         data-id="${p.id}" title="${p.desc}">
      <div class="text-2xl">${p.emoji}</div>
      <div class="text-xs mt-1">${p.name}</div>
    </div>`).join('');
  document.querySelectorAll('.profile-card').forEach(el => {
    el.addEventListener('click', () => {
      currentProfile = el.dataset.id;
      document.querySelectorAll('.profile-card').forEach(c => c.classList.toggle('selected', c===el));
      const d = state.dialogues[state.active];
      if (state.takes[d.id]) {
        state.takes[d.id].voice_profile = currentProfile;
        previewCurrent(); // deja escuchar el filtro al instante
      }
    });
  });
}

// resuelve el personaje de una linea de forma segura
const charOf = (d) => state.charById[d.character_id] || { name: '¿?', color: '#94a3b8' };

// ============ LIBRETO ============
function renderScript() {
  $('scriptList').innerHTML = state.dialogues.map((d, i) => {
    const mine = state.myCharIds.has(d.character_id);
    const done = !!state.takes[d.id];
    const c = charOf(d);
    return `
      <div class="line-item rounded-lg p-2.5 cursor-pointer transition ${mine?'':'opacity-40'} ${done?'line-done':''}"
           data-index="${i}">
        <div class="flex justify-between items-center">
          <span class="text-xs font-semibold" style="color:${c.color}">${c.name}</span>
          <span class="take-status text-[11px] text-slate-500">${done?'✅':(mine?'· pendiente':'')}</span>
        </div>
        <p class="text-sm truncate">${d.translated_text || d.original_text || '—'}</p>
      </div>`;
  }).join('');
  document.querySelectorAll('.line-item').forEach(el =>
    el.addEventListener('click', () => selectLine(+el.dataset.index)));
}

function selectLine(index) {
  const d = state.dialogues[index];
  if (!d) return; // sin lineas, no hacer nada (evita crash)
  state.active = index;
  document.querySelectorAll('.line-item').forEach((el,i)=>el.classList.toggle('line-active', i===index));

  const c = charOf(d);
  $('lineCharName').textContent = c.name;
  $('lineCharDot').style.background = c.color;
  $('lineTimecode').textContent = `${fmt(d.start_time)} → ${fmt(d.end_time)}`;
  $('karaokeText').textContent = d.translated_text || d.original_text || '—';
  $('originalText').textContent = d.original_text ? `(${d.original_text})` : '';
  $('lineProgress').style.width = '0%';
  $('reward').classList.add('hidden');

  $('videoPlayer').currentTime = d.start_time;

  const t = state.takes[d.id];
  $('listenBtn').classList.toggle('hidden', !t);
  if (t) {
    $('offsetSlider').value = t.offset_ms || 0;
    $('offsetVal').textContent = `${t.offset_ms||0} ms`;
    $('gainSlider').value = t.gain_db || 0;
    $('gainVal').textContent = `${t.gain_db||0}dB`;
    if (t.blob) waveTake.loadBlob(t.blob);
  }

  const mine = state.myCharIds.has(d.character_id);
  $('megaBtn').disabled = !mine;
  $('megaBtn').style.opacity = mine ? '1' : '.4';
}

function goToFirstPending() {
  const idx = state.dialogues.findIndex(d => state.myCharIds.has(d.character_id) && !state.takes[d.id]);
  selectLine(idx >= 0 ? idx : 0);
}

// ============ CONTROLES / GRABACION GUIADA ============
function bindControls() {
  $('megaBtn').addEventListener('click', onMegaClick);
  $('prevBtn').addEventListener('click', () => selectLine(Math.max(0, state.active-1)));
  $('nextBtn').addEventListener('click', () => selectLine(Math.min(state.dialogues.length-1, state.active+1)));
  $('listenBtn').addEventListener('click', previewCurrent);
  $('saveBtn').addEventListener('click', saveAll);
  $('exportBtn').addEventListener('click', doExport);

  $('offsetSlider').addEventListener('input', e => {
    $('offsetVal').textContent = `${e.target.value} ms`;
    const d = state.dialogues[state.active];
    if (state.takes[d.id]) state.takes[d.id].offset_ms = +e.target.value;
  });
  $('gainSlider').addEventListener('input', e => {
    $('gainVal').textContent = `${e.target.value}dB`;
    const d = state.dialogues[state.active];
    if (state.takes[d.id]) state.takes[d.id].gain_db = +e.target.value;
  });

  $('closeExport').addEventListener('click', () => hideModal('exportModal'));
}

let recording = false;
async function onMegaClick() {
  if (recording) return stopRecording();
  const d = state.dialogues[state.active];
  const video = $('videoPlayer');

  // Cuenta regresiva 3-2-1
  await countdown();
  video.currentTime = Math.max(0, d.start_time - 0.15);
  await video.play();
  recorder.start();
  recording = true;
  $('megaBtn').classList.add('rec-pulse');
  $('megaBtn').innerHTML = '<span class="w-5 h-5 rounded-full bg-white"></span> Detener';

  // barra de progreso dentro de la linea + auto-stop
  const dur = d.end_time - d.start_time;
  const tick = () => {
    if (!recording) return;
    const p = Math.min(100, ((video.currentTime - d.start_time) / dur) * 100);
    $('lineProgress').style.width = `${Math.max(0,p)}%`;
    if (video.currentTime >= d.end_time) return stopRecording();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function stopRecording() {
  const video = $('videoPlayer');
  video.pause();
  const blob = await recorder.stop();
  recording = false;
  $('megaBtn').classList.remove('rec-pulse');
  $('megaBtn').innerHTML = '<span class="w-5 h-5 rounded-full bg-white"></span> Grabar de nuevo';
  $('lineProgress').style.width = '100%';
  if (blob) await handleTake(blob);
}

async function handleTake(blob) {
  const d = state.dialogues[state.active];
  const url = URL.createObjectURL(blob);
  state.takes[d.id] = {
    blob, url, offset_ms: 0, gain_db: 0, voice_profile: currentProfile, saved: false,
  };
  waveTake.loadBlob(blob);
  showReward();
  $('listenBtn').classList.remove('hidden');
  updateScriptRow(state.active);
  updateXP();
  await uploadTake(d, blob);
}

async function uploadTake(dialogue, blob) {
  const { data: { user } } = await supabase.auth.getUser();
  const path = `${user.id}/${state.projectId}/${dialogue.id}.webm`;
  await supabase.storage.from(BUCKETS.userTakes).upload(path, blob, { upsert: true, contentType: blob.type });
  const { data: pub } = supabase.storage.from(BUCKETS.userTakes).getPublicUrl(path);
  const t = state.takes[dialogue.id];
  t.url = pub.publicUrl; t.saved = true;
  await supabase.from('takes').upsert({
    project_id: state.projectId, dialogue_id: dialogue.id, audio_url: pub.publicUrl,
    offset_ms: t.offset_ms, gain_db: t.gain_db, voice_profile: t.voice_profile,
    duration_seconds: dialogue.end_time - dialogue.start_time,
  }, { onConflict: 'project_id,dialogue_id' });
}

async function previewCurrent() {
  const d = state.dialogues[state.active];
  const t = state.takes[d.id];
  if (!t) return;
  let blob = t.blob;
  if (!blob && t.url) blob = await (await fetch(t.url)).blob();
  await preview.play(blob, t.voice_profile || currentProfile, t.gain_db || 0);
}

// ============ RECOMPENSA / XP ============
function showReward() {
  const msgs = ['¡Buena toma! 🌟','¡Perfecto! 🎯','¡Suena genial! 🔥','¡Nivel actor! 🎭','¡Increíble! ✨'];
  const r = $('reward');
  r.textContent = msgs[Math.floor(Math.random()*msgs.length)];
  r.classList.remove('hidden');
  void r.offsetWidth; // reinicia animacion
  r.classList.remove('reward-badge'); void r.offsetWidth; r.classList.add('reward-badge');
}

function updateXP() {
  const mine = state.dialogues.filter(d => state.myCharIds.has(d.character_id));
  const done = mine.filter(d => state.takes[d.id]).length;
  const pct = mine.length ? Math.round((done/mine.length)*100) : 0;
  $('xpBar').style.width = `${pct}%`;
  $('xpLabel').textContent = `${done}/${mine.length}`;
  supabase.from('projects').update({ progress: pct, updated_at: new Date().toISOString() })
    .eq('id', state.projectId).then(()=>{});
}

function updateScriptRow(index) {
  const el = document.querySelector(`.line-item[data-index="${index}"]`);
  if (!el) return;
  el.classList.add('line-done');
  el.querySelector('.take-status').textContent = '✅';
}

async function saveAll() {
  $('saveBtn').textContent = '⏳';
  await supabase.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', state.projectId);
  setTimeout(()=> $('saveBtn').textContent = '💾', 800);
}

// ============ EXPORTAR ============
async function doExport() {
  showModal('exportModal');
  try {
    const finalUrl = await exportProject({
      scene: state.scene, dialogues: state.dialogues, takes: state.takes,
      projectId: state.projectId,
      onProgress: (pct, label) => {
        $('exportBar').style.width = `${pct}%`;
        if (label) $('exportStatus').textContent = label;
      },
    });
    $('exportStatus').textContent = '¡Listo! 🎉';
    const link = $('downloadLink');
    link.href = finalUrl; link.download = `${state.scene.title}.mp4`;
    link.classList.remove('hidden');
    await supabase.from('projects').update({ status:'completed', final_video_url: finalUrl }).eq('id', state.projectId);
  } catch (e) {
    console.error(e);
    $('exportStatus').textContent = 'Error al exportar: ' + e.message;
  }
}

// ============ UTILS / OVERLAYS ============
function countdown() {
  return new Promise(resolve => {
    const ov = $('countdownOverlay'), num = $('countdownNum');
    let n = 3;
    showOverlay(ov); num.textContent = n;
    const iv = setInterval(() => {
      n--;
      if (n === 0) { num.textContent = '🎬'; }
      else if (n < 0) { clearInterval(iv); hideOverlay(ov); resolve(); return; }
      else { num.textContent = n; }
      num.classList.remove('countdown'); void num.offsetWidth; num.classList.add('countdown');
    }, 700);
  });
}

function showModal(id) { $(id).classList.remove('hidden'); $(id).classList.add('flex'); }
function hideModal(id) { $(id).classList.add('hidden'); $(id).classList.remove('flex'); }
function showOverlay(el) { el.classList.remove('hidden'); el.classList.add('flex'); }
function hideOverlay(el) { el.classList.add('hidden'); el.classList.remove('flex'); }

const fmt = (s) => {
  const m = Math.floor(s/60), sec = (s%60).toFixed(1).padStart(4,'0');
  return `${String(m).padStart(2,'0')}:${sec}`;
};

$('videoPlayer').addEventListener('timeupdate', () => {});
