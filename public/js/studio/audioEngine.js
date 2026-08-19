// js/studio/audioEngine.js
// ============================================================
// Construye la cadena de efectos de un perfil de voz usando
// Web Audio API. La MISMA funcion sirve para:
//   - Previsualizar en tiempo real (AudioContext normal)
//   - Renderizar el mix final (OfflineAudioContext)
// Devuelve { input, output } para conectar en el grafo.
// ============================================================
import { getProfile } from './voiceProfiles.js';

const dbToGain = (db) => Math.pow(10, db / 20);

// Curva de saturacion suave para "drive"
function makeDriveCurve(amount) {
  const n = 44100, curve = new Float32Array(n), k = amount * 100;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + k) * x * 20 * Math.PI / 180) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

/**
 * Construye la cadena de efectos.
 * @param {BaseAudioContext} ctx  AudioContext u OfflineAudioContext
 * @param {string} profileId
 * @returns {{input: AudioNode, output: AudioNode}}
 */
export function buildChain(ctx, profileId) {
  const p = getProfile(profileId);
  const input = ctx.createGain();
  let node = input;

  // 1) EQ en cadena
  (p.eq || []).forEach(band => {
    const f = ctx.createBiquadFilter();
    f.type = band.type;
    f.frequency.value = band.freq;
    if (band.gain != null && ['peaking','lowshelf','highshelf'].includes(band.type)) f.gain.value = band.gain;
    if (band.q != null) f.Q.value = band.q;
    node.connect(f);
    node = f;
  });

  // 2) Drive / saturacion (opcional)
  if (p.drive) {
    const shaper = ctx.createWaveShaper();
    shaper.curve = makeDriveCurve(p.drive);
    shaper.oversample = '2x';
    node.connect(shaper);
    node = shaper;
  }

  // 3) Compresor
  if (p.comp) {
    const c = ctx.createDynamicsCompressor();
    c.threshold.value = p.comp.threshold;
    c.ratio.value = p.comp.ratio;
    c.attack.value = p.comp.attack;
    c.release.value = p.comp.release;
    c.knee.value = p.comp.knee;
    node.connect(c);
    node = c;
  }

  // 4) Makeup gain
  const makeup = ctx.createGain();
  makeup.gain.value = dbToGain(p.makeup || 0);
  node.connect(makeup);
  node = makeup;

  // 5) Delay/eco en paralelo (opcional): mezcla dry + wet
  const output = ctx.createGain();
  if (p.delay) {
    const dry = ctx.createGain(); dry.gain.value = 1 - p.delay.mix;
    const wet = ctx.createGain(); wet.gain.value = p.delay.mix;
    const delay = ctx.createDelay(2.0); delay.delayTime.value = p.delay.time;
    const fb = ctx.createGain(); fb.gain.value = p.delay.feedback;

    node.connect(dry).connect(output);
    node.connect(delay);
    delay.connect(fb).connect(delay); // feedback loop
    delay.connect(wet).connect(output);
  } else {
    node.connect(output);
  }

  return { input, output };
}

// ---- Reproductor de preview en tiempo real ----
export class PreviewPlayer {
  constructor() { this.ctx = null; this.src = null; }

  /** Reproduce un Blob de audio aplicando el perfil. */
  async play(blob, profileId, gainDb = 0) {
    this.stop();
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuf = await blob.arrayBuffer();
    const audioBuf = await this.ctx.decodeAudioData(arrayBuf);

    this.src = this.ctx.createBufferSource();
    this.src.buffer = audioBuf;

    const { input, output } = buildChain(this.ctx, profileId);
    const userGain = this.ctx.createGain();
    userGain.gain.value = dbToGain(gainDb);

    this.src.connect(input);
    output.connect(userGain).connect(this.ctx.destination);
    this.src.start();
    return new Promise(res => { this.src.onended = res; });
  }

  stop() {
    try { this.src?.stop(); } catch {}
    try { this.ctx?.close(); } catch {}
    this.src = null; this.ctx = null;
  }
}
