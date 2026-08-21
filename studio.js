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
  sceneId: qs.get('scene'), projectId: qs.get('project'),
  scene: null, characters: [], charById: {}, dialogues: [],
  myCharIds: new Set(), selectedChars: [], myLines: [], sections: [],
  active: 0, takes: {}, project: null,
};

const recorder = new LineRecorder();
const preview = new PreviewPlayer();
let waveOriginal, waveTake, studioReady = false, currentProfile = 'natural';

function showModal(id) { $(id).classList.remove('hidden'); $(id).classList.add('flex'); }
function hideModal(id) { $(id).classList.add('hidden'); $(id).classList.remove('flex'); }
function showOverlay(el) { el.classList.remove('hidden'); el.classList.add('flex'); }
function hideOverlay(el) { el.classList.add('hidden'); el.classList.remove('flex'); }
const charOf = (d) => state.charById[d.character_id] || { name: '¿?', color: '#94a3b8' };
const fmt = (s) => { const m = Math.floor(s/60), sec = (s%60).toFixed(1).padStart(4,'0'); return `${String(m).padStart(2,'0')}:${sec}`; };

await requireAuth();
try { await loadScene(); }
catch (e) { console.error('loadScene error:', e); $('karaokeText').textContent = 'Error al cargar la escena'; $('originalText').textContent = String(e.message || e); }

// ============ CARGA ============
async function loadScene() {
  const { data: scene } = await supabase.from('scenes').select('*').eq('id', state.sceneId).single();
  state.scene = scene;
  $('sceneTitle').textContent = scene.title;
  $('videoPlayer').src = scene.source_video_url;
  $('videoPlayer').crossOrigin = 'anonymous';

  const { data: chars } = await supabase.from('characters').select('*').eq('scene_id', state.sceneId);
  state.characters = chars || [];
  state.charById = Object.fromEntries(state.characters.map(c => [c.id, c]));

  const { data: lines } = await supabase.from('dialogues').select('*').eq('scene_id', state.sceneId).order('line_order');
  state.dialogues = lines || [];

  const nc = state.characters.length, nd = state.dialogues.length;
  $('myChars').textContent = `Escena: ${nc} personajes · ${nd} líneas`;
  if (!nc) {
    $('karaokeText').textContent = 'Esta escena no tiene personajes guardados.';
    $('megaBtn').disabled = true; $('megaBtn').style.opacity = '.4'; return;
  }
  if (state.projectId) { await preloadProject(); }
  renderCharModal();
}

async function preloadProject() {
  const { data: project } = await supabase.from('projects').select('*').eq('id', state.projectId).single();
  state.project = project;
  const { data: pc } = await supabase.from('project_characters').select('character_id').eq('project_id', state.projectId);
  (pc || []).forEach(r => state.myCharIds.add(r.character_id));
  const { data: takes } = await supabase.from('takes').select('*').eq('project_id', state.projectId);
  (takes || []).forEach(t => { state.takes[t.dialogue_id] = { url: t.audio_url, offset_ms: t.offset_ms, gain_db: t.gain_db, voice_profile: t.voice_profile, saved: true }; });
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
  if (!studioReady) { await initOnce(); studioReady = true; }
  refreshSession();
});

$('changeCharsBtn').addEventListener('click', () => renderCharModal());

async function ensureProject() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!state.projectId) {
    const { data: project } = await supabase.from('projects')
      .insert({ scene_id: state.sceneId, user_id: user.id, title: state.scene.title }).select().single();
    state.project = project; state.projectId = project.id;
  }
  await supabase.from('project_characters').delete().eq('project_id', state.projectId);
  const rows = [...state.myCharIds].map(cid => ({ project_id: state.projectId, character_id: cid }));
  if (rows.length) await supabase.from('project_characters').insert(rows);
}

// ============ INIT (una sola vez) ============
async function initOnce() {
  try { await recorder.init(); } catch { alert('Necesito permiso del micrófono para grabar 🎙️'); }
  waveOriginal = createOriginalWave('#waveOriginal', $('videoPlayer'));
  waveTake = createTakeWave('#waveTake');
  renderProfiles();
  bindControls();
}

// ============ REFRESCAR SESION (al cambiar personajes) ============
function refreshSession() {
  state.selectedChars = state.characters.filter(c => state.myCharIds.has(c.id));
  $('myChars').textContent = `Doblas: ${state.selectedChars.map(c => c.name).join(', ')}`;
  buildMyLines();
  renderScript();
  renderBreakdown();
  goToFirstPending();
  updateXP();
}

function buildMyLines() {
  state.myLines = []; state.sections = [];
  state.selectedChars.forEach(c => {
    const lines = state.dialogues.filter(d => d.character_id === c.id);
    if (!lines.length) return;
    const from = state.myLines.length;
    state.myLines.push(...lines);
    state.sections.push({ char: c, from, to: state.myLines.length - 1 });
  });
}
const sectionOf = (index) => state.sections.find(s => index >= s.from && index <= s.to);

// ============ FILTROS (POST) ============
function renderProfiles() {
  $('profileRow').innerHTML = PROFILES.map(p => `
    <div class="profile-card glass rounded-xl px-3 py-2 min-w-[84px] text-center ${p.id===currentProfile?'selected':''}"
         data-id="${p.id}" title="${p.desc}">
      <div class="text-2xl">${p.emoji}</div><div class="text-xs mt-1">${p.name}</div>
    </div>`).join('');
  document.querySelectorAll('.profile-card').forEach(el => el.addEventListener('click', () => {
    currentProfile = el.dataset.id;
    document.querySelectorAll('.profile-card').forEach(c => c.classList.toggle('selected', c===el));
    const d = state.myLines[state.active];
    if (d && state.takes[d.id]) { state.takes[d.id].voice_profile = currentProfile; saveTakeMeta(d); previewCurrent(); }
  }));
}

// ============ KARAOKE ============
function renderKaraoke(text) {
  const parts = (text || '—').split(/(\s+)/);
  $('karaokeText').innerHTML = parts.map(w => /\S/.test(w) ? `<span class="kw">${w}</span>` : w).join('');
}
function setKaraokeProgress(p) {
  const spans = $('karaokeText').querySelectorAll('.kw');
  const on = Math.ceil(p * spans.length);
  spans.forEach((s, i) => s.classList.toggle('on', i < on));
}

// ============ LIBRETO POR SECCIONES ============
function renderScript() {
  let html = '';
  state.sections.forEach(sec => {
    html += `<div class="text-xs font-bold uppercase tracking-wide mt-3 mb-1" style="color:${sec.char.color}">▸ ${sec.char.name}</div>`;
    for (let i = sec.from; i <= sec.to; i++) {
      const d = state.myLines[i], done = !!state.takes[d.id];
      html += `
        <div class="line-item rounded-lg p-2.5 cursor-pointer transition ${done?'line-done':''}" data-index="${i}">
          <div class="flex justify-between items-center">
            <span class="text-[11px] font-mono text-slate-400">${fmt(d.start_time)} → ${fmt(d.end_time)}</span>
            <span class="take-status text-[11px] text-slate-500">${done?'✅':'· pendiente'}</span>
          </div>
          <p class="text-sm">${d.translated_text || d.original_text || '—'}</p>
          ${d.translated_text && d.original_text ? `<p class="text-[11px] text-slate-500 italic">${d.original_text}</p>` : ''}
        </div>`;
    }
  });
  $('scriptList').innerHTML = html;
  document.querySelectorAll('.line-item').forEach(el => el.addEventListener('click', () => selectLine(+el.dataset.index)));
}

function selectLine(index) {
  const d = state.myLines[index];
  if (!d) return;
  state.active = index;
  document.querySelectorAll('.line-item').forEach(el => el.classList.toggle('line-active', +el.dataset.index===index));
  const sec = sectionOf(index), c = charOf(d);
  $('sectionTag').textContent = sec ? `Sección: ${sec.char.name} (${index - sec.from + 1}/${sec.to - sec.from + 1})` : '';
  $('lineCharName').textContent = c.name;
  $('lineCharDot').style.background = c.color;
  $('lineTimecode').textContent = `${fmt(d.start_time)} → ${fmt(d.end_time)}`;
  renderKaraoke(d.translated_text || d.original_text || '—');
  $('originalText').textContent = d.original_text && d.translated_text ? `(${d.original_text})` : '';
  $('lineProgress').style.width = '0%';
  $('reward').classList.add('hidden');
  $('videoPlayer').currentTime = d.start_time;
  const t = state.takes[d.id];
  $('listenBtn').classList.toggle('hidden', !t);
  if (t) {
    $('offsetSlider').value = t.offset_ms || 0; $('offsetVal').textContent = `${t.offset_ms||0} ms`;
    $('gainSlider').value = t.gain_db || 0; $('gainVal').textContent = `${t.gain_db||0}dB`;
    if (t.blob) waveTake.loadBlob(t.blob);
  }
}
function goToFirstPending() {
  const idx = state.myLines.findIndex(d => !state.takes[d.id]);
  selectLine(idx >= 0 ? idx : 0);
}

// ============ DESGLOSE DE PERSONAJES ============
function renderBreakdown() {
  let allDone = state.myLines.length > 0;
  $('charBreakdown').innerHTML = state.sections.map(sec => {
    const total = sec.to - sec.from + 1;
    let done = 0; for (let i = sec.from; i <= sec.to; i++) if (state.takes[state.myLines[i].id]) done++;
    if (done < total) allDone = false;
    const pct = Math.round((done/total)*100), complete = done === total;
    return `
      <div class="glass rounded-xl p-3">
        <div class="flex items-center gap-2 mb-2">
          <span class="w-3 h-3 rounded-full" style="background:${sec.char.color}"></span>
          <span class="text-sm font-medium flex-1">${sec.char.name}</span>
          <span class="text-xs text-slate-400">${done}/${total}</span>
          ${complete ? '<span class="text-xs text-emerald-400 font-semibold">✅ Completo</span>'
            : `<button class="rec-char btn-primary px-3 py-1 rounded-lg text-xs" data-from="${sec.from}">Grabar</button>`}
        </div>
        <div class="h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div class="h-full ${complete?'bg-emerald-400':'bg-violet-500'}" style="width:${pct}%"></div>
        </div>
      </div>`;
  }).join('');
  document.querySelectorAll('.rec-char').forEach(b => b.addEventListener('click', () => {
    const from = +b.dataset.from, sec = sectionOf(from); let target = from;
    for (let i = sec.from; i <= sec.to; i++) if (!state.takes[state.myLines[i].id]) { target = i; break; }
    selectLine(target);
    $('lineCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));
  $('finishRecBtn').classList.toggle('hidden', !allDone);
}

// ============ CONTROLES + GRABACION con PRE-ROLL 3s ============
function bindControls() {
  $('megaBtn').addEventListener('click', onMegaClick);
  $('prevBtn').addEventListener('click', () => selectLine(Math.max(0, state.active-1)));
  $('nextBtn').addEventListener('click', () => selectLine(Math.min(state.myLines.length-1, state.active+1)));
  $('listenBtn').addEventListener('click', previewCurrent);
  $('saveBtn').addEventListener('click', saveAll);
  $('exportBtn').addEventListener('click', doExport);
  $('closeExport').addEventListener('click', () => hideModal('exportModal'));
  $('finishRecBtn').addEventListener('click', () => {
    $('postSection').open = true;
    $('postSection').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  $('offsetSlider').addEventListener('input', e => {
    $('offsetVal').textContent = `${e.target.value} ms`;
    const d = state.myLines[state.active]; if (d && state.takes[d.id]) { state.takes[d.id].offset_ms = +e.target.value; saveTakeMeta(d); }
  });
  $('gainSlider').addEventListener('input', e => {
    $('gainVal').textContent = `${e.target.value}dB`;
    const d = state.myLines[state.active]; if (d && state.takes[d.id]) { state.takes[d.id].gain_db = +e.target.value; saveTakeMeta(d); }
  });
  $('videoPlayer').addEventListener('timeupdate', () => { $('tcOverlay').textContent = fmt($('videoPlayer').currentTime); });
}

let recording = false, armed = false;
async function onMegaClick() {
  if (recording || armed) return stopRecording();
  const d = state.myLines[state.active]; if (!d) return;
  const video = $('videoPlayer');
  await countdown();
  armed = true;
  video.currentTime = Math.max(0, d.start_time - 3); // 3s antes para alistarse
  await video.play();
  $('megaBtn').innerHTML = '<span class="w-5 h-5 rounded-full bg-yellow-300"></span> Prepárate...';
  $('entryHint').classList.remove('hidden');

  const dur = d.end_time - d.start_time;
  const loop = () => {
    if (!armed && !recording) return;
    const t = video.currentTime;
    if (!recording && t < d.start_time) {
      $('entryHint').textContent = `▶ Entra en ${(d.start_time - t).toFixed(1)}s`;
    }
    if (!recording && t >= d.start_time) {
      recorder.start(); recording = true;
      $('entryHint').textContent = '🔴 GRABANDO';
      $('megaBtn').classList.add('rec-pulse');
      $('megaBtn').innerHTML = '<span class="w-5 h-5 rounded-full bg-white"></span> Detener';
    }
    if (recording) {
      const p = Math.min(1, (t - d.start_time) / dur);
      $('lineProgress').style.width = `${p*100}%`;
      setKaraokeProgress(p);
    }
    if (t >= d.end_time) { stopRecording(); return; }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

async function stopRecording() {
  const video = $('videoPlayer'); video.pause();
  const wasRecording = recording;
  armed = false; recording = false;
  $('entryHint').classList.add('hidden');
  $('megaBtn').classList.remove('rec-pulse');
  $('megaBtn').innerHTML = '<span class="w-5 h-5 rounded-full bg-white"></span> Grabar de nuevo';
  $('lineProgress').style.width = '100%';
  setKaraokeProgress(1);
  if (wasRecording) { const blob = await recorder.stop(); if (blob) await handleTake(blob); }
}

async function handleTake(blob) {
  const d = state.myLines[state.active];
  state.takes[d.id] = { blob, url: URL.createObjectURL(blob), offset_ms: 0, gain_db: 0, voice_profile: 'natural', saved: false };
  waveTake.loadBlob(blob);
  showReward();
  $('listenBtn').classList.remove('hidden');
  renderScript(); renderBreakdown(); updateXP(); selectLine(state.active);
  await uploadTake(d, blob);
}

async function uploadTake(dialogue, blob) {
  const { data: { user } } = await supabase.auth.getUser();
  const path = `${user.id}/${state.projectId}/${dialogue.id}.webm`;
  await supabase.storage.from(BUCKETS.userTakes).upload(path, blob, { upsert: true, contentType: blob.type });
  const { data: pub } = supabase.storage.from(BUCKETS.userTakes).getPublicUrl(path);
  const t = state.takes[dialogue.id]; t.url = pub.publicUrl; t.saved = true;
  await supabase.from('takes').upsert({
    project_id: state.projectId, dialogue_id: dialogue.id, audio_url: pub.publicUrl,
    offset_ms: t.offset_ms, gain_db: t.gain_db, voice_profile: t.voice_profile,
    duration_seconds: dialogue.end_time - dialogue.start_time,
  }, { onConflict: 'project_id,dialogue_id' });
}

async function saveTakeMeta(dialogue) {
  const t = state.takes[dialogue.id]; if (!t || !t.saved) return;
  await supabase.from('takes').update({ offset_ms: t.offset_ms, gain_db: t.gain_db, voice_profile: t.voice_profile })
    .eq('project_id', state.projectId).eq('dialogue_id', dialogue.id);
}

async function previewCurrent() {
  const d = state.myLines[state.active], t = state.takes[d.id]; if (!t) return;
  let blob = t.blob; if (!blob && t.url) blob = await (await fetch(t.url)).blob();
  await preview.play(blob, t.voice_profile || 'natural', t.gain_db || 0);
}

function showReward() {
  const msgs = ['¡Buena toma! 🌟','¡Perfecto! 🎯','¡Suena genial! 🔥','¡Nivel actor! 🎭','¡Increíble! ✨'];
  const r = $('reward'); r.textContent = msgs[Math.floor(Math.random()*msgs.length)];
  r.classList.remove('hidden'); r.classList.remove('reward-badge'); void r.offsetWidth; r.classList.add('reward-badge');
}
function updateXP() {
  const total = state.myLines.length, done = state.myLines.filter(d => state.takes[d.id]).length;
  const pct = total ? Math.round((done/total)*100) : 0;
  $('xpBar').style.width = `${pct}%`; $('xpLabel').textContent = `${done}/${total}`;
  supabase.from('projects').update({ progress: pct, updated_at: new Date().toISOString() }).eq('id', state.projectId).then(()=>{});
}
async function saveAll() {
  $('saveBtn').textContent = '⏳';
  await supabase.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', state.projectId);
  setTimeout(()=> $('saveBtn').textContent = '💾', 800);
}

async function doExport() {
  showModal('exportModal');
  try {
    const finalUrl = await exportProject({
      scene: state.scene, dialogues: state.dialogues, takes: state.takes, projectId: state.projectId,
      onProgress: (pct, label) => { $('exportBar').style.width = `${pct}%`; if (label) $('exportStatus').textContent = label; },
    });
    $('exportStatus').textContent = '¡Listo! 🎉';
    const link = $('downloadLink'); link.href = finalUrl; link.download = `${state.scene.title}.mp4`; link.classList.remove('hidden');
    await supabase.from('projects').update({ status:'completed', final_video_url: finalUrl }).eq('id', state.projectId);
  } catch (e) { console.error(e); $('exportStatus').textContent = 'Error al exportar: ' + e.message; }
}

function countdown() {
  return new Promise(resolve => {
    const ov = $('countdownOverlay'), num = $('countdownNum');
    let n = 3; showOverlay(ov); num.textContent = n;
    const iv = setInterval(() => {
      n--;
      if (n === 0) num.textContent = '🎬';
      else if (n < 0) { clearInterval(iv); hideOverlay(ov); resolve(); return; }
      else num.textContent = n;
      num.classList.remove('countdown'); void num.offsetWidth; num.classList.add('countdown');
    }, 700);
  });
}
