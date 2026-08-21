// js/creator/creator.js
import { supabase, requireAuth } from '../lib/supabase.js';
import { BUCKETS } from '../lib/config.js';
import { trimVideo } from './videoTrimmer.js';

const $ = (id) => document.getElementById(id);
await requireAuth();

const PALETTE = ['#f59e0b','#ec4899','#22d3ee','#8b5cf6','#34d399','#f43f5e','#60a5fa','#a3e635'];
let colorIx = 0;
const nextColor = () => PALETTE[colorIx++ % PALETTE.length];

const state = {
  file: null, trimmedBlob: null, trimmedUrl: null, sceneVideoUrl: null, storagePath: null,
  duration: 30, characters: [], lines: [],
};

function goPhase(n) {
  [1,2,3].forEach(i => {
    $('phase'+i).classList.toggle('active', i === n);
    const dot = $('stepDot'+i); dot.classList.toggle('active', i === n); dot.classList.toggle('done', i < n);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const tc = (s) => { const m = Math.floor(s/60); const sec = (s%60); return `${String(m).padStart(2,'0')}:${sec.toFixed(2).padStart(5,'0')}`; };

// ============ FASE 1: SUBIR + RECORTAR + ANALIZAR ============
$('videoInput').addEventListener('change', (e) => {
  state.file = e.target.files[0];
  if (!state.file) return;
  const v = $('preview');
  v.src = URL.createObjectURL(state.file);
  v.classList.remove('hidden');
  v.onloadedmetadata = () => { state.duration = v.duration; setupTrimmer(v.duration); };
  $('trimBlock').classList.remove('hidden');
});

const trim = { in: 0, out: 0, dur: 0 };
function setupTrimmer(duration) {
  trim.dur = duration; trim.in = 0; trim.out = duration;
  $('inRange').max = $('outRange').max = duration;
  $('inRange').value = 0; $('outRange').value = duration; updateTrimUI();
}
function updateTrimUI() {
  const pct = (t) => (trim.dur ? (t/trim.dur)*100 : 0);
  $('trimFill').style.left = pct(trim.in)+'%';
  $('trimFill').style.width = (pct(trim.out)-pct(trim.in))+'%';
  $('inLabel').textContent = trim.in.toFixed(1)+'s';
  $('outLabel').textContent = trim.out.toFixed(1)+'s';
  $('selDur').textContent = (trim.out-trim.in).toFixed(1)+'s';
}
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
    state.duration = trim.out - trim.in;
    state.trimmedUrl = URL.createObjectURL(state.trimmedBlob);

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
    while (!done) {
      await sleep(3000); tries++;
      $('p1Bar').style.width = `${Math.min(90, 50 + tries*4)}%`;
      st.textContent = 'Procesando audio... (~1-2 min)';
      const res = await callFn({ action: 'status', transcriptId: start.id });
      if (res.error) throw new Error(res.error);
      if (res.status === 'completed') done = res;
      if (tries > 60) throw new Error('Tiempo agotado');
    }
    $('p1Bar').style.width = '100%';
    if (!done.utterances?.length) throw new Error('No se detectaron diálogos');
    buildFromUtterances(done.utterances);
    enterReview(); goPhase(2);
  } catch (err) { st.textContent = 'Error: ' + (err.message || err); }
  finally { $('cutAnalyzeBtn').disabled = false; }
});

async function callFn(body) {
  const { data, error } = await supabase.functions.invoke('transcribe', { body });
  if (error) { try { return await error.context.json(); } catch { return { error: error.message }; } }
  return data;
}

// ============ FASE 2: REVISION ============
function buildFromUtterances(utts) {
  const speakers = [...new Set(utts.map(u => u.speaker))];
  state.characters = speakers.map(sp => ({ lid: 'c_'+sp, name: `Personaje ${sp}`, color: nextColor() }));
  const spToLid = Object.fromEntries(speakers.map(sp => [sp, 'c_'+sp]));
  state.lines = utts.map(u => ({ text: u.text||'', translated: '', start: +(u.start/1000).toFixed(2), end: +(u.end/1000).toFixed(2), charLid: spToLid[u.speaker] }));
}

function enterReview() {
  const rv = $('reviewVideo');
  rv.src = state.trimmedUrl || state.sceneVideoUrl;
  rv.ontimeupdate = () => { $('revTc').textContent = tc(rv.currentTime); };
  renderCharManager(); renderReviewLines();
}

const char = (lid) => state.characters.find(c => c.lid === lid);

function renderCharManager() {
  $('charManager').innerHTML = state.characters.map(c => `
    <div class="glass rounded-full pl-1 pr-1 py-1 flex items-center gap-1">
      <input type="color" value="${c.color}" data-lid="${c.lid}" class="cm-color w-6 h-6 rounded-full bg-transparent border-0">
      <input value="${c.name}" data-lid="${c.lid}" class="cm-name bg-transparent text-xs outline-none w-24">
      <button data-lid="${c.lid}" class="cm-del text-rose-400 text-xs px-1">✕</button>
    </div>`).join('');
  document.querySelectorAll('.cm-name').forEach(el => el.addEventListener('input', e => { char(e.target.dataset.lid).name = e.target.value; renderReviewLines(); }));
  document.querySelectorAll('.cm-color').forEach(el => el.addEventListener('input', e => { char(e.target.dataset.lid).color = e.target.value; renderReviewLines(); }));
  document.querySelectorAll('.cm-del').forEach(el => el.addEventListener('click', e => removeChar(e.target.dataset.lid)));
}

$('addCharBtn').addEventListener('click', () => {
  const name = $('newCharName').value.trim(); if (!name) return;
  state.characters.push({ lid: 'c_'+Date.now(), name, color: $('newCharColor').value });
  $('newCharName').value = ''; $('newCharColor').value = nextColor();
  renderCharManager(); renderReviewLines();
});

function removeChar(lid) {
  if (state.characters.length <= 1) return alert('Debe quedar al menos un personaje');
  state.characters = state.characters.filter(c => c.lid !== lid);
  const fallback = state.characters[0].lid;
  state.lines.forEach(l => { if (l.charLid === lid) l.charLid = fallback; });
  renderCharManager(); renderReviewLines();
}

function renderReviewLines() {
  const dur = state.duration || 60;
  $('reviewLines').innerHTML = state.lines.map((l, i) => {
    const opts = state.characters.map(ch => `<option value="${ch.lid}" ${ch.lid===l.charLid?'selected':''}>${ch.name}</option>`).join('');
    return `
      <div class="rev-line glass rounded-lg p-2.5" data-i="${i}">
        <div class="flex items-center gap-2 mb-2 flex-wrap">
          <button class="play-line text-sm px-2 py-0.5 rounded bg-violet-600/70 hover:bg-violet-600" data-i="${i}">▶</button>
          <select class="assign-char glass rounded px-2 py-0.5 text-xs bg-transparent" data-i="${i}">${opts}</select>
          <span class="text-[11px] font-mono text-slate-400 ml-auto">${tc(l.start)} → ${tc(l.end)}</span>
          <button class="del-line text-rose-400 text-xs" data-i="${i}">🗑</button>
        </div>
        <div class="flex items-center gap-2 mb-1">
          <span class="text-[10px] text-violet-300 w-14">Inicio</span>
          <input type="range" class="ln-start flex-1 accent-violet-500" data-i="${i}" min="0" max="${dur}" step="0.05" value="${l.start}">
          <span class="tc-start text-[10px] font-mono w-16 text-right">${tc(l.start)}</span>
        </div>
        <div class="flex items-center gap-2 mb-2">
          <span class="text-[10px] text-cyan-300 w-14">Fin</span>
          <input type="range" class="ln-end flex-1 accent-cyan-400" data-i="${i}" min="0" max="${dur}" step="0.05" value="${l.end}">
          <span class="tc-end text-[10px] font-mono w-16 text-right">${tc(l.end)}</span>
        </div>
        <input class="ln-text w-full bg-transparent border-b border-white/10 text-xs py-1 text-slate-300" data-i="${i}" value="${(l.text||'').replace(/"/g,'&quot;')}" placeholder="Texto original">
        <input class="ln-es w-full bg-transparent border-b border-cyan-400/30 text-xs py-1 mt-1" data-i="${i}" value="${(l.translated||'').replace(/"/g,'&quot;')}" placeholder="Español">
        <button class="split-line text-[11px] text-violet-300 mt-1 hover:underline" data-i="${i}">✂ Dividir en el cursor del texto original</button>
      </div>`;
  }).join('');

  const rv = $('reviewVideo');
  document.querySelectorAll('.play-line').forEach(b => b.addEventListener('click', () => togglePlay(+b.dataset.i)));
  document.querySelectorAll('.assign-char').forEach(el => el.addEventListener('change', e => { state.lines[+e.target.dataset.i].charLid = e.target.value; }));
  document.querySelectorAll('.del-line').forEach(b => b.addEventListener('click', () => { state.lines.splice(+b.dataset.i, 1); renderReviewLines(); }));

  // sliders finos: al mover, el video salta a ese momento y se ve en vivo
  document.querySelectorAll('.ln-start').forEach(el => el.addEventListener('input', e => {
    const i = +e.target.dataset.i; let v = +e.target.value;
    if (v > state.lines[i].end - 0.1) { v = state.lines[i].end - 0.1; e.target.value = v; }
    state.lines[i].start = +v.toFixed(2);
    e.target.closest('.rev-line').querySelector('.tc-start').textContent = tc(v);
    rv.pause(); rv.currentTime = v;
    updateLineTc(i);
  }));
  document.querySelectorAll('.ln-end').forEach(el => el.addEventListener('input', e => {
    const i = +e.target.dataset.i; let v = +e.target.value;
    if (v < state.lines[i].start + 0.1) { v = state.lines[i].start + 0.1; e.target.value = v; }
    state.lines[i].end = +v.toFixed(2);
    e.target.closest('.rev-line').querySelector('.tc-end').textContent = tc(v);
    rv.pause(); rv.currentTime = v;
    updateLineTc(i);
  }));

  document.querySelectorAll('.ln-text').forEach(el => el.addEventListener('input', e => state.lines[+e.target.dataset.i].text = e.target.value));
  document.querySelectorAll('.ln-es').forEach(el => el.addEventListener('input', e => state.lines[+e.target.dataset.i].translated = e.target.value));
  document.querySelectorAll('.split-line').forEach(b => b.addEventListener('click', () => {
    const i = +b.dataset.i, input = document.querySelector(`.ln-text[data-i="${i}"]`);
    splitLine(i, input.selectionStart ?? Math.floor((input.value||'').length/2));
  }));
}

// actualiza el timecode "inicio → fin" de una linea sin re-renderizar todo
function updateLineTc(i) {
  const row = document.querySelector(`.rev-line[data-i="${i}"]`);
  if (!row) return;
  const l = state.lines[i];
  const span = row.querySelector('.font-mono.text-slate-400');
  if (span) span.textContent = `${tc(l.start)} → ${tc(l.end)}`;
}

let playIdx = -1, lineStop = null;
function togglePlay(i) {
  const v = $('reviewVideo');
  const btn = document.querySelector(`.play-line[data-i="${i}"]`);
  if (lineStop) { v.removeEventListener('timeupdate', lineStop); lineStop = null; }
  // si esta misma linea esta sonando -> pausar
  if (playIdx === i && !v.paused) {
    v.pause(); if (btn) btn.textContent = '▶'; return;
  }
  playIdx = i;
  document.querySelectorAll('.play-line').forEach(b => b.textContent = '▶');
  document.querySelectorAll('.rev-line').forEach(el => el.classList.toggle('playing', +el.dataset.i === i));
  if (btn) btn.textContent = '⏸';
  const l = state.lines[i];
  v.currentTime = l.start; v.play();
  lineStop = () => {
    if (v.currentTime >= state.lines[i].end) {
      v.pause(); v.removeEventListener('timeupdate', lineStop); lineStop = null;
      if (btn) btn.textContent = '▶';
    }
  };
  v.addEventListener('timeupdate', lineStop);
}

$('addLineBtn').addEventListener('click', () => {
  if (!state.characters.length) state.characters.push({ lid: 'c_'+Date.now(), name: 'Personaje', color: nextColor() });
  const last = state.lines[state.lines.length-1];
  const start = last ? last.end : 0;
  state.lines.push({ text: '', translated: '', start: +start.toFixed(2), end: +(start+2).toFixed(2), charLid: state.characters[0].lid });
  renderCharManager(); renderReviewLines();
});

function splitLine(i, caret) {
  const l = state.lines[i], text = l.text || '';
  caret = Math.max(1, Math.min(caret, text.length - 1));
  const left = text.slice(0, caret).trim(), right = text.slice(caret).trim();
  if (!left || !right) return alert('Coloca el cursor en medio del texto para dividir');
  const ratio = caret / text.length;
  const mid = +(l.start + (l.end - l.start) * ratio).toFixed(2);
  const newLine = { text: right, translated: '', start: mid, end: l.end, charLid: l.charLid };
  l.text = left; l.translated = ''; l.end = mid;
  state.lines.splice(i + 1, 0, newLine);
  renderReviewLines();
}

const STOP = new Set(['I','The','A','An','And','But','So','Oh','Hey','Yes','No','Ok','Okay','Well','Why','What','Who','How','When','Where','Mr','Mrs','God','Hi','Hello']);
$('detectNamesBtn').addEventListener('click', () => {
  const freq = {};
  state.lines.forEach(l => (l.text||'').split(/\s+/).forEach((w, idx) => {
    const clean = w.replace(/[^A-Za-z]/g, '');
    if (idx > 0 && /^[A-Z][a-z]{2,}$/.test(clean) && !STOP.has(clean)) freq[clean] = (freq[clean]||0)+1;
  }));
  const names = Object.entries(freq).sort((a,b)=>b[1]-a[1]).map(x=>x[0]);
  if (!names.length) { $('p2Status').textContent = 'No se detectaron nombres.'; return; }
  state.characters.forEach((c, i) => { if (names[i]) c.name = names[i]; });
  renderCharManager(); renderReviewLines();
  $('p2Status').textContent = `Sugeridos: ${names.slice(0, state.characters.length).join(', ')}`;
});

$('translateBtn').addEventListener('click', async () => {
  const btn = $('translateBtn'); btn.disabled = true;
  const total = state.lines.length;
  for (let i = 0; i < total; i++) {
    const l = state.lines[i]; if (!l.text) continue;
    $('p2Status').textContent = `Traduciendo ${i+1}/${total}...`;
    try {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(l.text)}&langpair=en|es`;
      const data = await (await fetch(url)).json();
      const tr = data?.responseData?.translatedText || '';
      l.translated = (tr && tr.toLowerCase() !== l.text.toLowerCase()) ? tr : (l.translated || '');
    } catch {}
    renderReviewLines();
  }
  $('p2Status').textContent = '✅ Traducido (revisa el español)';
  btn.disabled = false;
});

$('toPhase3').addEventListener('click', () => goPhase(3));

// ============ FASE 3: PUBLICAR ============
$('publishBtn').addEventListener('click', async () => {
  const title = $('sceneTitle').value.trim();
  if (!title) return alert('Ponle título');
  if (!state.sceneVideoUrl) return alert('Falta el video');
  const st = $('publishStatus'); $('publishBtn').disabled = true;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    st.textContent = 'Creando escena...';
    const { data: scene, error: e1 } = await supabase.from('scenes').insert({
      title, source_video_url: state.sceneVideoUrl, duration_seconds: state.duration,
      aspect_ratio: $('aspect').value, status: 'published', created_by: user.id,
    }).select().single();
    if (e1) throw e1;

    st.textContent = 'Guardando personajes...';
    const charRows = state.characters.map(c => ({ scene_id: scene.id, name: c.name.trim() || 'Personaje', color: c.color }));
    const { data: chars, error: e2 } = await supabase.from('characters').insert(charRows).select();
    if (e2) throw e2;
    const lidToId = {};
    state.characters.forEach((c, idx) => { lidToId[c.lid] = chars[idx].id; });

    st.textContent = 'Guardando líneas...';
    const dlgRows = state.lines.map((l, i) => ({
      scene_id: scene.id, character_id: lidToId[l.charLid], line_order: i + 1,
      start_time: l.start, end_time: l.end, original_text: l.text, translated_text: l.translated || '',
    }));
    if (dlgRows.length) { const { error: e3 } = await supabase.from('dialogues').insert(dlgRows); if (e3) throw e3; }

    st.textContent = '✅ ¡Publicada!';
    setTimeout(() => location.href = '/dashboard.html', 900);
  } catch (err) { st.textContent = 'Error: ' + (err.message || err); }
  finally { $('publishBtn').disabled = false; }
});
