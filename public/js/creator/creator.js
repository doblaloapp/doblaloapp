// js/creator/creator.js
import { supabase, requireAuth } from '../lib/supabase.js';
import { BUCKETS } from '../lib/config.js';
import { trimVideo } from './videoTrimmer.js';

const $ = (id) => document.getElementById(id);
await requireAuth();

const PALETTE = ['#f59e0b','#ec4899','#22d3ee','#8b5cf6','#34d399','#f43f5e','#60a5fa','#a3e635'];
let colorIx = 0;
const nextColor = () => PALETTE[colorIx++ % PALETTE.length];
const qs = new URLSearchParams(location.search);

const state = {
  file: null, trimmedBlob: null, trimmedUrl: null, sceneVideoUrl: null, storagePath: null,
  duration: 30, characters: [], lines: [], active: -1, editSceneId: qs.get('edit') || null, tlZoom: 1,
};

function goPhase(n) {
  [1,2,3].forEach(i => { $('phase'+i).classList.toggle('active', i === n); const dot = $('stepDot'+i); dot.classList.toggle('active', i === n); dot.classList.toggle('done', i < n); });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const tc = (s) => { s = Math.max(0, s||0); const m = Math.floor(s/60), sec = Math.floor(s%60), cs = Math.round((s-Math.floor(s))*100); const p = n=>String(n).padStart(2,'0'); return `${p(m)}:${p(sec)}:${p(cs===100?99:cs)}`; };
const char = (lid) => state.characters.find(c => c.lid === lid);
const hasTr = () => state.lines.some(l => !l.expr && l.translated);
const autoGrow = (el) => { el.style.height = 'auto'; el.style.height = (el.scrollHeight)+'px'; };

// ============ MODO EDICION ============
if (state.editSceneId) { await loadForEdit(state.editSceneId); }

async function loadForEdit(id) {
  const { data: scene } = await supabase.from('scenes').select('*').eq('id', id).single();
  if (!scene) { alert('Escena no encontrada'); location.href='/dashboard.html'; return; }
  state.sceneVideoUrl = scene.source_video_url; state.trimmedUrl = scene.source_video_url;
  state.duration = scene.duration_seconds || 30;
  $('creatorTitle').textContent = 'Editar Escena';
  $('sceneTitle').value = scene.title;
  const { data: chars } = await supabase.from('characters').select('*').eq('scene_id', id);
  state.characters = (chars||[]).map(c => ({ lid: c.id, name: c.name, color: c.color, avatarUrl: c.avatar_url || null }));
  const { data: dlg } = await supabase.from('dialogues').select('*').eq('scene_id', id).order('line_order');
  state.lines = (dlg||[]).map(d => ({ text: d.original_text||'', translated: d.translated_text||'', start: +d.start_time, end: +d.end_time, charLid: d.character_id, expr: /^\(.*\)$/.test((d.original_text||'').trim()) }));
  enterReview(); goPhase(2);
}

// ============ FASE 1 ============
$('videoInput').addEventListener('change', (e) => {
  state.file = e.target.files[0]; if (!state.file) return;
  const v = $('preview'); v.src = URL.createObjectURL(state.file); v.classList.remove('hidden');
  v.onloadedmetadata = () => { state.duration = v.duration; setupTrimmer(v.duration); };
  $('trimBlock').classList.remove('hidden');
});
const trim = { in: 0, out: 0, dur: 0 };
function setupTrimmer(duration) { trim.dur = duration; trim.in = 0; trim.out = duration; $('inRange').max = $('outRange').max = duration; $('inRange').value = 0; $('outRange').value = duration; updateTrimUI(); }
function updateTrimUI() { const pct = t => (trim.dur ? (t/trim.dur)*100 : 0); $('trimFill').style.left = pct(trim.in)+'%'; $('trimFill').style.width = (pct(trim.out)-pct(trim.in))+'%'; $('inLabel').textContent = trim.in.toFixed(1)+'s'; $('outLabel').textContent = trim.out.toFixed(1)+'s'; $('selDur').textContent = (trim.out-trim.in).toFixed(1)+'s'; }
$('inRange').addEventListener('input', e => { trim.in = Math.min(+e.target.value, trim.out-0.2); e.target.value = trim.in; $('preview').currentTime = trim.in; updateTrimUI(); });
$('outRange').addEventListener('input', e => { trim.out = Math.max(+e.target.value, trim.in+0.2); e.target.value = trim.out; $('preview').currentTime = trim.out; updateTrimUI(); });
$('markIn').addEventListener('click', () => { trim.in = Math.min($('preview').currentTime, trim.out-0.2); $('inRange').value = trim.in; updateTrimUI(); });
$('markOut').addEventListener('click', () => { trim.out = Math.max($('preview').currentTime, trim.in+0.2); $('outRange').value = trim.out; updateTrimUI(); });
$('playSel').addEventListener('click', () => { const v = $('preview'); v.currentTime = trim.in; v.play(); const stop = () => { if (v.currentTime >= trim.out) { v.pause(); v.removeEventListener('timeupdate', stop); } }; v.addEventListener('timeupdate', stop); });

$('cutAnalyzeBtn').addEventListener('click', async () => {
  if (trim.out <= trim.in) return alert('El fin debe ser mayor que el inicio');
  $('cutAnalyzeBtn').disabled = true; $('p1BarWrap').classList.remove('hidden');
  const st = $('p1Status');
  try {
    st.textContent = 'Recortando...'; $('p1Bar').style.width = '10%';
    state.trimmedBlob = await trimVideo(state.file, trim.in, trim.out, $('aspect').value, s => st.textContent = s);
    state.duration = trim.out - trim.in; state.trimmedUrl = URL.createObjectURL(state.trimmedBlob);
    st.textContent = 'Subiendo...'; $('p1Bar').style.width = '35%';
    const { data: { user } } = await supabase.auth.getUser();
    state.storagePath = `${user.id}/${Date.now()}.mp4`;
    const up = await supabase.storage.from(BUCKETS.scenesSource).upload(state.storagePath, state.trimmedBlob, { contentType: 'video/mp4' });
    if (up.error) throw up.error;
    state.sceneVideoUrl = supabase.storage.from(BUCKETS.scenesSource).getPublicUrl(state.storagePath).data.publicUrl;
    st.textContent = 'Analizando con IA...'; $('p1Bar').style.width = '50%';
    const start = await callFn({ action: 'start', audioUrl: state.sceneVideoUrl });
    if (start.error) throw new Error(start.error);
    let done = null, tries = 0;
    while (!done) { await sleep(3000); tries++; $('p1Bar').style.width = `${Math.min(90, 50+tries*4)}%`; st.textContent = 'Procesando audio... (~1-2 min)'; const res = await callFn({ action: 'status', transcriptId: start.id }); if (res.error) throw new Error(res.error); if (res.status === 'completed') done = res; if (tries > 60) throw new Error('Tiempo agotado'); }
    $('p1Bar').style.width = '100%';
    if (!done.utterances?.length) throw new Error('No se detectaron diálogos');
    buildFromUtterances(done.utterances); enterReview(); goPhase(2);
  } catch (err) { st.textContent = 'Error: ' + (err.message || err); }
  finally { $('cutAnalyzeBtn').disabled = false; }
});
async function callFn(body) { const { data, error } = await supabase.functions.invoke('transcribe', { body }); if (error) { try { return await error.context.json(); } catch { return { error: error.message }; } } return data; }

// ============ FASE 2 ============
function buildFromUtterances(utts) {
  const speakers = [...new Set(utts.map(u => u.speaker))];
  state.characters = speakers.map(sp => ({ lid: 'c_'+sp, name: `Personaje ${sp}`, color: nextColor() }));
  const spToLid = Object.fromEntries(speakers.map(sp => [sp, 'c_'+sp]));
  state.lines = utts.map(u => ({ text: u.text||'', translated: '', start: +(u.start/1000).toFixed(2), end: +(u.end/1000).toFixed(2), charLid: spToLid[u.speaker], expr: false }));
}

function enterReview() {
  const rv = $('reviewVideo');
  rv.src = state.trimmedUrl || state.sceneVideoUrl;
  rv.ontimeupdate = () => {
    const t = rv.currentTime, dur = state.duration || 60;
    $('revTc').textContent = tc(t);
    const cur = state.lines.find(l => t >= l.start && t <= l.end);
    const sub = $('revSub');
    if (cur) { sub.textContent = cur.translated || cur.text || ''; sub.style.display = 'block'; } else { sub.textContent = ''; sub.style.display = 'none'; }
    const cursor = $('tlCursor'); if (cursor) cursor.style.left = Math.min(100, t/dur*100) + '%';
  };
  // registrar linea activa al enfocar
  $('reviewLines').addEventListener('focusin', (e) => { const row = e.target.closest('.rev-line'); if (row) state.active = +row.dataset.i; });
  renderCharManager(); renderReviewLines(); renderTimeline();
}

function renderCharManager() {
  $('charManager').innerHTML = state.characters.map(c => `
    <div class="rounded-lg p-1 flex items-center gap-1" style="background:${c.color}22; border:1px solid ${c.color}66">
      <label class="cursor-pointer" title="Subir foto cuadrada">
        <input type="file" accept="image/*" class="cm-photo hidden" data-lid="${c.lid}">
        ${c.avatarUrl ? `<img src="${c.avatarUrl}" class="avatar-sq">` : `<span class="avatar-sq text-sm">📷</span>`}
      </label>
      <input type="color" value="${c.color}" data-lid="${c.lid}" class="cm-color w-6 h-6 rounded-full bg-transparent border-0">
      <input value="${c.name}" data-lid="${c.lid}" class="cm-name bg-transparent text-xs outline-none w-20">
      <button data-lid="${c.lid}" class="cm-del text-rose-400 text-xs px-1">✕</button>
    </div>`).join('');
  document.querySelectorAll('.cm-photo').forEach(el => el.addEventListener('change', e => {
    const c = char(e.target.dataset.lid), f = e.target.files[0]; if (!f) return;
    c.avatarFile = f; c.avatarUrl = URL.createObjectURL(f); renderCharManager();
  }));
  document.querySelectorAll('.cm-name').forEach(el => el.addEventListener('input', e => { char(e.target.dataset.lid).name = e.target.value; renderReviewLines(); renderTimeline(); }));
  document.querySelectorAll('.cm-color').forEach(el => el.addEventListener('input', e => { char(e.target.dataset.lid).color = e.target.value; renderCharManager(); renderReviewLines(); renderTimeline(); }));
  document.querySelectorAll('.cm-del').forEach(el => el.addEventListener('click', e => removeChar(e.target.dataset.lid)));
}
$('addCharBtn').addEventListener('click', () => { const name = $('newCharName').value.trim(); if (!name) return; state.characters.push({ lid: 'c_'+Date.now(), name, color: $('newCharColor').value }); $('newCharName').value=''; $('newCharColor').value = nextColor(); renderCharManager(); renderReviewLines(); renderTimeline(); });
function removeChar(lid) { if (state.characters.length <= 1) return alert('Debe quedar al menos un personaje'); state.characters = state.characters.filter(c => c.lid !== lid); const fb = state.characters[0].lid; state.lines.forEach(l => { if (l.charLid === lid) l.charLid = fb; }); renderCharManager(); renderReviewLines(); renderTimeline(); }

function renderReviewLines() {
  const dur = state.duration || 60;
  const showEs = hasTr();
  $('reviewLines').innerHTML = state.lines.map((l, i) => {
    const c = char(l.charLid) || { name: '?', color: '#888' };
    const opts = state.characters.map(ch => `<option value="${ch.lid}" ${ch.lid===l.charLid?'selected':''}>${ch.name}</option>`).join('');
    const accent = l.expr ? '#f59e0b' : c.color;
    const bg = l.expr ? 'rgba(245,158,11,.12)' : (c.color+'14');
    const pad = l._zoom ? Math.max(0.5, (l.end - l.start) * 0.75) : 0;  // zoom adaptable
    const zMin = l._zoom ? Math.max(0, l.start - pad) : 0;
    const zMax = l._zoom ? Math.min(dur, l.end + pad) : dur;
    const span = (zMax - zMin) || dur;
    const sL = ((l.start - zMin)/span)*100, sW = ((l.end-l.start)/span)*100;
    return `
      <div class="rev-line rounded-lg p-2.5 ${l.expr?'expr':''}" data-i="${i}" style="border-left:4px solid ${accent}; background:${bg}">
        <div class="flex items-center gap-2 mb-2 flex-wrap">
          <span class="drag-handle text-slate-500" draggable="true" title="Arrastra para reordenar">⋮⋮</span>
          <span class="text-[11px] font-mono text-slate-500">#${i+1}</span>
          <button class="play-line text-sm px-2 py-0.5 rounded bg-violet-600/70 hover:bg-violet-600" data-i="${i}">▶</button>
          <select class="assign-char glass rounded px-2 py-0.5 text-xs bg-transparent" data-i="${i}">${opts}</select>
          <button class="zoom-line text-xs px-1 rounded ${l._zoom?'bg-cyan-500/40':'bg-white/10'}" data-i="${i}" title="Zoom para ajuste fino">🔍</button>
          <span class="text-[11px] font-mono ml-auto" style="color:${accent}">${tc(l.start)} → ${tc(l.end)}</span>
          <button class="del-line text-rose-400 text-xs" data-i="${i}">🗑</button>
        </div>
        <div class="dr-track mb-2" data-i="${i}">
          <div class="dr-fill" style="left:${sL}%; width:${sW}%"></div>
          <input type="range" class="dr-range start" data-i="${i}" min="${zMin}" max="${zMax}" step="${l._zoom?0.01:0.05}" value="${l.start}">
          <input type="range" class="dr-range end" data-i="${i}" min="${zMin}" max="${zMax}" step="${l._zoom?0.01:0.05}" value="${l.end}">
        </div>
        <textarea rows="1" class="ln-text ln-area w-full bg-transparent border-b border-white/10 text-xs py-1 ${l.expr?'text-amber-300':'text-slate-200'}" data-i="${i}" placeholder="${l.expr?'Expresión':'Texto original'}">${(l.text||'')}</textarea>
        ${(!l.expr && showEs) ? `<textarea rows="1" class="ln-es ln-area w-full bg-transparent border-b border-cyan-400/30 text-xs py-1 mt-1" data-i="${i}" placeholder="Español">${(l.translated||'')}</textarea>` : ''}
        ${l.expr ? '' : `<button class="split-line text-[11px] text-violet-300 mt-1 hover:underline" data-i="${i}">✂ Dividir en el cursor</button>`}
      </div>`;
  }).join('');

  const rv = $('reviewVideo');
  document.querySelectorAll('.ln-area').forEach(autoGrow);
  document.querySelectorAll('.play-line').forEach(b => b.addEventListener('click', () => togglePlay(+b.dataset.i)));
  document.querySelectorAll('.assign-char').forEach(el => el.addEventListener('change', e => { state.lines[+e.target.dataset.i].charLid = e.target.value; renderReviewLines(); renderTimeline(); }));
  document.querySelectorAll('.del-line').forEach(b => b.addEventListener('click', () => { state.lines.splice(+b.dataset.i, 1); renderReviewLines(); renderTimeline(); }));
  document.querySelectorAll('.zoom-line').forEach(b => b.addEventListener('click', () => { const i=+b.dataset.i; state.lines[i]._zoom = !state.lines[i]._zoom; renderReviewLines(); }));
  document.querySelectorAll('.ln-text').forEach(el => el.addEventListener('input', e => { state.lines[+e.target.dataset.i].text = e.target.value; autoGrow(e.target); }));
  document.querySelectorAll('.ln-es').forEach(el => el.addEventListener('input', e => { state.lines[+e.target.dataset.i].translated = e.target.value; autoGrow(e.target); }));
  document.querySelectorAll('.split-line').forEach(b => b.addEventListener('click', () => { const i=+b.dataset.i, input = document.querySelector(`.ln-text[data-i="${i}"]`); splitLine(i, input.selectionStart ?? Math.floor((input.value||'').length/2)); }));

  const zwin = (l) => { const pad = l._zoom ? Math.max(0.5,(l.end-l.start)*0.75) : 0; const zMin = l._zoom?Math.max(0,l.start-pad):0, zMax = l._zoom?Math.min(dur,l.end+pad):dur; return { zMin, span:(zMax-zMin)||dur }; };
  const clampFill = (i) => { const l = state.lines[i], row = document.querySelector(`.dr-track[data-i="${i}"]`), {zMin,span}=zwin(l); if (row) { row.querySelector('.dr-fill').style.left = ((l.start-zMin)/span*100)+'%'; row.querySelector('.dr-fill').style.width = ((l.end-l.start)/span*100)+'%'; } updateLineTc(i); renderTimeline(); };
  document.querySelectorAll('.dr-range.start').forEach(el => el.addEventListener('input', e => { const i=+e.target.dataset.i, l=state.lines[i]; let v=+e.target.value; if (v>l.end-0.05){v=l.end-0.05;e.target.value=v;} l.start=+v.toFixed(2); rv.pause(); rv.currentTime=v; clampFill(i); }));
  document.querySelectorAll('.dr-range.end').forEach(el => el.addEventListener('input', e => { const i=+e.target.dataset.i, l=state.lines[i]; let v=+e.target.value; if (v<l.start+0.05){v=l.start+0.05;e.target.value=v;} l.end=+v.toFixed(2); rv.pause(); rv.currentTime=v; clampFill(i); }));

  // reordenar: SOLO desde el asa (asi el slider no mueve la caja)
  document.querySelectorAll('.drag-handle').forEach(h => {
    h.addEventListener('dragstart', () => { const row = h.closest('.rev-line'); dragFrom = +row.dataset.i; row.classList.add('dragging'); });
    h.addEventListener('dragend', () => { const row = h.closest('.rev-line'); if (row) row.classList.remove('dragging'); document.querySelectorAll('.rev-line').forEach(x=>x.classList.remove('drop-target')); });
  });
  document.querySelectorAll('.rev-line').forEach(el => {
    el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drop-target'); });
    el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
    el.addEventListener('drop', e => { e.preventDefault(); const to = +el.dataset.i; if (dragFrom===null||dragFrom===to) return; const [m] = state.lines.splice(dragFrom,1); state.lines.splice(to,0,m); dragFrom=null; renderReviewLines(); renderTimeline(); });
  });
}
let dragFrom = null;

function updateLineTc(i) { const row = document.querySelector(`.rev-line[data-i="${i}"]`); if (!row) return; const l = state.lines[i]; const span = row.querySelector('.font-mono.ml-auto'); if (span) span.textContent = `${tc(l.start)} → ${tc(l.end)}`; }

let playIdx = -1, lineStop = null;
function togglePlay(i) {
  const v = $('reviewVideo'); const btn = document.querySelector(`.play-line[data-i="${i}"]`);
  if (lineStop) { v.removeEventListener('timeupdate', lineStop); lineStop = null; }
  if (playIdx === i && !v.paused) { v.pause(); if (btn) btn.textContent = '▶'; return; }
  playIdx = i;
  document.querySelectorAll('.play-line').forEach(b => b.textContent = '▶');
  document.querySelectorAll('.rev-line').forEach(el => el.classList.toggle('playing', +el.dataset.i === i));
  if (btn) btn.textContent = '⏸';
  const l = state.lines[i]; v.currentTime = l.start; v.play();
  lineStop = () => { if (v.currentTime >= state.lines[i].end) { v.pause(); v.removeEventListener('timeupdate', lineStop); lineStop = null; if (btn) btn.textContent = '▶'; } };
  v.addEventListener('timeupdate', lineStop);
}

// timeline por personajes: alineada, con zoom y barras editables
function renderTimeline() {
  const dur = state.duration || 60;
  const ticks = 8;
  let ruler = '<div class="tl-ruler">';
  for (let k = 0; k <= ticks; k++) { const p = k/ticks*100; ruler += `<span class="tl-tick" style="left:${p}%">${tc(dur*k/ticks)}</span>`; }
  ruler += '</div>';

  const rows = state.characters.map(c => {
    const bars = state.lines.map((l,i)=>({l,i})).filter(x => x.l.charLid === c.lid).map(({l,i}) => {
      const left = l.start/dur*100, w = Math.max(0.8, (l.end-l.start)/dur*100);
      const col = l.expr ? '#f59e0b' : c.color;
      return `<div class="tl-bar" data-i="${i}" style="left:${left}%;width:${w}%;background:${col}" title="${(l.text||'').slice(0,40).replace(/"/g,'')}"></div>`;
    }).join('');
    return `<div class="text-[10px] mt-1 font-semibold" style="color:${c.color}">${c.name}</div><div class="tl-row" data-cid="${c.lid}">${bars}</div>`;
  }).join('');

  const inner = ruler + rows + '<div id="tlCursor" style="left:0%"></div>';
  $('timeline').innerHTML =
    `<div class="flex items-center gap-2 mb-1 text-xs">
       <button id="tlZoomOut" class="glass px-2 py-0.5 rounded">−</button>
       <span class="text-slate-400">Zoom ${state.tlZoom.toFixed(1)}x</span>
       <button id="tlZoomIn" class="glass px-2 py-0.5 rounded">+</button>
       <button id="tlZoomFit" class="glass px-2 py-0.5 rounded">Ajustar</button>
       <span class="text-[10px] text-slate-500 ml-auto">Arrastra las barras (centro mueve, bordes ajustan)</span>
     </div>
     <div id="tlScroll" class="overflow-x-auto"><div id="tlInner" class="relative" style="width:${state.tlZoom*100}%">${inner}</div></div>`;

  $('tlZoomIn').onclick = () => { state.tlZoom = Math.min(10, state.tlZoom + 0.5); renderTimeline(); };
  $('tlZoomOut').onclick = () => { state.tlZoom = Math.max(1, state.tlZoom - 0.5); renderTimeline(); };
  $('tlZoomFit').onclick = () => { state.tlZoom = 1; renderTimeline(); };

  document.querySelectorAll('.tl-row').forEach(tr => tr.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('tl-bar')) return;
    const r = tr.getBoundingClientRect(); const p = Math.max(0, Math.min(1, (e.clientX - r.left)/r.width));
    $('reviewVideo').currentTime = p * dur;
  }));
  document.querySelectorAll('.tl-bar').forEach(b => attachBarDrag(b, dur));
}

// arrastrar/redimensionar una barra para editar su tiempo
function attachBarDrag(bar, dur) {
  bar.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const i = +bar.dataset.i, l = state.lines[i];
    const row = bar.parentElement, rect = row.getBoundingClientRect();
    const rel = (e.clientX - bar.getBoundingClientRect().left) / Math.max(1, bar.offsetWidth);
    const mode = rel < 0.28 ? 'start' : rel > 0.72 ? 'end' : 'move';
    const startX = e.clientX, o = { s: l.start, e: l.end };
    const rv = $('reviewVideo'); rv.pause();
    const move = (ev) => {
      const dt = (ev.clientX - startX) / rect.width * dur;
      if (mode === 'move') { const len = o.e - o.s; let ns = Math.max(0, Math.min(dur - len, o.s + dt)); l.start = +ns.toFixed(2); l.end = +(ns + len).toFixed(2); }
      else if (mode === 'start') { l.start = +Math.max(0, Math.min(l.end - 0.05, o.s + dt)).toFixed(2); }
      else { l.end = +Math.min(dur, Math.max(l.start + 0.05, o.e + dt)).toFixed(2); }
      bar.style.left = (l.start/dur*100) + '%';
      bar.style.width = Math.max(0.8, (l.end-l.start)/dur*100) + '%';
      rv.currentTime = mode === 'end' ? l.end : l.start;
    };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); renderReviewLines(); renderTimeline(); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  });
}

$('addLineBtn').addEventListener('click', () => addLineAt(false));
$('addExprBtn').addEventListener('click', () => addLineAt(true));
function addLineAt(isExpr) {
  if (!state.characters.length) state.characters.push({ lid: 'c_'+Date.now(), name: 'Personaje', color: nextColor() });
  const at = (state.active >= 0 && state.active < state.lines.length) ? state.active + 1 : state.lines.length;
  const ref = state.lines[state.active] || state.lines[state.lines.length-1];
  const start = ref ? ref.end : 0;
  const tag = isExpr ? $('exprSelect').value : '';
  state.lines.splice(at, 0, { text: tag, translated: isExpr?tag:'', start: +start.toFixed(2), end: +(start + (isExpr?1:2)).toFixed(2), charLid: (ref?ref.charLid:state.characters[0].lid), expr: isExpr });
  state.active = at;
  renderReviewLines(); renderTimeline();
}

function splitLine(i, caret) {
  const l = state.lines[i], text = l.text || '';
  caret = Math.max(1, Math.min(caret, text.length - 1));
  const left = text.slice(0, caret).trim(), right = text.slice(caret).trim();
  if (!left || !right) return alert('Coloca el cursor en medio del texto para dividir');
  const ratio = caret / text.length, mid = +(l.start + (l.end - l.start) * ratio).toFixed(2);
  const newLine = { text: right, translated: '', start: mid, end: l.end, charLid: l.charLid, expr: false };
  l.text = left; l.translated = ''; l.end = mid;
  state.lines.splice(i + 1, 0, newLine);
  renderReviewLines(); renderTimeline();
}

const STOP = new Set(['I','The','A','An','And','But','So','Oh','Hey','Yes','No','Ok','Okay','Well','Why','What','Who','How','When','Where','Mr','Mrs','God','Hi','Hello']);
$('detectNamesBtn').addEventListener('click', () => {
  const freq = {};
  state.lines.forEach(l => (l.text||'').split(/\s+/).forEach((w, idx) => { const clean = w.replace(/[^A-Za-z]/g,''); if (idx>0 && /^[A-Z][a-z]{2,}$/.test(clean) && !STOP.has(clean)) freq[clean]=(freq[clean]||0)+1; }));
  const names = Object.entries(freq).sort((a,b)=>b[1]-a[1]).map(x=>x[0]);
  if (!names.length) { $('p2Status').textContent = 'No se detectaron nombres.'; return; }
  state.characters.forEach((c,i)=>{ if (names[i]) c.name = names[i]; });
  renderCharManager(); renderReviewLines(); renderTimeline();
  $('p2Status').textContent = `Sugeridos: ${names.slice(0, state.characters.length).join(', ')}`;
});

$('translateBtn').addEventListener('click', async () => {
  const btn = $('translateBtn'); btn.disabled = true;
  const total = state.lines.length;
  for (let i = 0; i < total; i++) {
    const l = state.lines[i]; if (!l.text || l.expr) continue;
    $('p2Status').textContent = `Traduciendo ${i+1}/${total}...`;
    try { const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(l.text)}&langpair=en|es`; const data = await (await fetch(url)).json(); const tr = data?.responseData?.translatedText || ''; l.translated = (tr && tr.toLowerCase() !== l.text.toLowerCase()) ? tr : (l.translated||''); } catch {}
  }
  renderReviewLines();
  $('p2Status').textContent = '✅ Traducido (revisa el español)';
  btn.disabled = false;
});

$('toPhase3').addEventListener('click', () => goPhase(3));

// divisor ajustable
(function initDivider(){
  const div = $('divider'), left = $('leftPane'), split = $('revSplit');
  if (!div) return; let dragging = false;
  div.addEventListener('pointerdown', e => { dragging = true; div.setPointerCapture(e.pointerId); });
  div.addEventListener('pointermove', e => { if (!dragging) return; const r = split.getBoundingClientRect(); let pct = ((e.clientX - r.left)/r.width)*100; pct = Math.max(30, Math.min(78, pct)); left.style.flex = `0 0 ${pct}%`; });
  div.addEventListener('pointerup', () => dragging = false);
})();

// ============ FASE 3: PUBLICAR / ACTUALIZAR ============
$('publishBtn').addEventListener('click', async () => {
  const title = $('sceneTitle').value.trim();
  if (!title) return alert('Ponle título');
  if (!state.sceneVideoUrl) return alert('Falta el video');
  const st = $('publishStatus'); $('publishBtn').disabled = true;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    let sceneId;
    if (state.editSceneId) {
      st.textContent = 'Actualizando escena...';
      await supabase.from('scenes').update({ title, duration_seconds: state.duration }).eq('id', state.editSceneId);
      await supabase.from('dialogues').delete().eq('scene_id', state.editSceneId);
      await supabase.from('characters').delete().eq('scene_id', state.editSceneId);
      sceneId = state.editSceneId;
    } else {
      st.textContent = 'Creando escena...';
      const { data: scene, error: e1 } = await supabase.from('scenes').insert({ title, source_video_url: state.sceneVideoUrl, duration_seconds: state.duration, aspect_ratio: ($('aspect')?.value)||'original', status: 'published', created_by: user.id }).select().single();
      if (e1) throw e1; sceneId = scene.id;
    }
    st.textContent = 'Subiendo fotos...';
    for (const c of state.characters) {
      if (c.avatarFile) {
        const ext = (c.avatarFile.type.split('/')[1] || 'png').replace('jpeg','jpg');
        const path = `${user.id}/avatars/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const up = await supabase.storage.from(BUCKETS.scenesSource).upload(path, c.avatarFile, { contentType: c.avatarFile.type, upsert: true });
        if (!up.error) c.avatarUrl = supabase.storage.from(BUCKETS.scenesSource).getPublicUrl(path).data.publicUrl;
      }
    }
    st.textContent = 'Guardando personajes...';
    const charRows = state.characters.map(c => ({ scene_id: sceneId, name: (c.name||'Personaje').trim(), color: c.color, avatar_url: (c.avatarUrl && !c.avatarUrl.startsWith('blob:')) ? c.avatarUrl : null }));
    const { data: chars, error: e2 } = await supabase.from('characters').insert(charRows).select();
    if (e2) throw e2;
    const lidToId = {}; state.characters.forEach((c, idx) => { lidToId[c.lid] = chars[idx].id; });
    st.textContent = 'Guardando líneas...';
    const dlgRows = state.lines.map((l, i) => ({ scene_id: sceneId, character_id: lidToId[l.charLid], line_order: i+1, start_time: l.start, end_time: l.end, original_text: l.text, translated_text: l.translated || '' }));
    if (dlgRows.length) { const { error: e3 } = await supabase.from('dialogues').insert(dlgRows); if (e3) throw e3; }
    st.textContent = state.editSceneId ? '✅ ¡Actualizada!' : '✅ ¡Publicada!';
    setTimeout(() => location.href = '/dashboard.html', 900);
  } catch (err) { st.textContent = 'Error: ' + (err.message || err); }
  finally { $('publishBtn').disabled = false; }
});
