// js/postproduction/mixer.js
// ============================================================
// Mezcla offline (rapida) de:
//   - Cama de fondo (M&E si existe, si no el audio original ducked)
//   - Cada toma de voz con su filtro, ganancia y offset de lip-sync
// Devuelve un Blob WAV listo para muxear con el video.
// ============================================================
import { buildChain } from '../studio/audioEngine.js';

const dbToGain = (db) => Math.pow(10, db / 20);

async function fetchAudioBuffer(ctx, url) {
  const res = await fetch(url);
  const arr = await res.arrayBuffer();
  return ctx.decodeAudioData(arr);
}

/**
 * @param {object} opts
 *   scene, dialogues, takes, onProgress
 * @returns {Promise<Blob>} WAV
 */
export async function renderMix({ scene, dialogues, takes, onProgress }) {
  const sampleRate = 48000;
  const duration = Math.max(scene.duration_seconds || 0, 1) + 1;
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);

  onProgress?.(10, 'Cargando cama de sonido...');

  // 1) Cama de fondo
  let bed, bedGain;
  if (scene.me_track_url) {
    bed = await fetchAudioBuffer(ctx, scene.me_track_url);
    bedGain = 1.0; // M&E ya viene sin voces
  } else {
    // Fallback: audio original del video, ducked para que no tape las voces
    try { bed = await fetchAudioBuffer(ctx, scene.source_video_url); bedGain = 0.22; }
    catch { bed = null; }
  }
  if (bed) {
    const src = ctx.createBufferSource(); src.buffer = bed;
    const g = ctx.createGain(); g.gain.value = bedGain;
    src.connect(g).connect(ctx.destination); src.start(0);
  }

  // 2) Voces
  const entries = dialogues.filter(d => takes[d.id]);
  let i = 0;
  for (const d of entries) {
    const t = takes[d.id];
    let blob = t.blob;
    if (!blob && t.url) blob = await (await fetch(t.url)).blob();
    const arr = await blob.arrayBuffer();
    const buf = await ctx.decodeAudioData(arr);

    const src = ctx.createBufferSource(); src.buffer = buf;
    const { input, output } = buildChain(ctx, t.voice_profile || 'natural');
    const userGain = ctx.createGain(); userGain.gain.value = dbToGain(t.gain_db || 0);

    src.connect(input);
    output.connect(userGain).connect(ctx.destination);

    const when = Math.max(0, d.start_time + (t.offset_ms || 0) / 1000);
    src.start(when);

    i++;
    onProgress?.(10 + Math.round((i / entries.length) * 40), `Mezclando voces (${i}/${entries.length})...`);
  }

  onProgress?.(55, 'Renderizando mezcla...');
  const rendered = await ctx.startRendering();
  onProgress?.(65, 'Codificando audio...');
  return encodeWAV(rendered);
}

// ---- AudioBuffer -> WAV (PCM 16-bit) ----
function encodeWAV(buffer) {
  const numCh = buffer.numberOfChannels;
  const len = buffer.length * numCh * 2 + 44;
  const ab = new ArrayBuffer(len);
  const view = new DataView(ab);
  const channels = [];
  let offset = 0, pos = 0;

  const writeStr = (s) => { for (let i=0;i<s.length;i++) view.setUint8(pos++, s.charCodeAt(i)); };
  const write16 = (v) => { view.setUint16(pos, v, true); pos += 2; };
  const write32 = (v) => { view.setUint32(pos, v, true); pos += 4; };

  writeStr('RIFF'); write32(len - 8); writeStr('WAVE');
  writeStr('fmt '); write32(16); write16(1); write16(numCh);
  write32(buffer.sampleRate); write32(buffer.sampleRate * numCh * 2);
  write16(numCh * 2); write16(16);
  writeStr('data'); write32(buffer.length * numCh * 2);

  for (let c = 0; c < numCh; c++) channels.push(buffer.getChannelData(c));
  while (offset < buffer.length) {
    for (let c = 0; c < numCh; c++) {
      let s = Math.max(-1, Math.min(1, channels[c][offset]));
      view.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      pos += 2;
    }
    offset++;
  }
  return new Blob([ab], { type: 'audio/wav' });
}
