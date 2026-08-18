// js/studio/voiceProfiles.js
// ============================================================
// Perfiles de voz tipo "filtro". Cada uno describe una cadena
// de efectos que se construye con Web Audio API (buildChain en
// audioEngine.js). Pensados para que cualquiera los aplique con
// un clic, sin saber nada de compresores ni ecualizadores.
//
// Cada perfil puede tener:
//   eq:        [{type, freq, gain, q}]  -> BiquadFilters
//   comp:      {threshold, ratio, attack, release, knee}
//   drive:     0..1 (distorsion/saturacion suave, opcional)
//   delay:     {time, feedback, mix}    (eco/reverb simple, opcional)
//   makeup:    ganancia de compensacion en dB
// ============================================================

export const PROFILES = [
  {
    id: 'natural',
    name: 'Natural',
    emoji: '🎤',
    desc: 'Tu voz, limpia y clara.',
    eq: [{ type: 'highpass', freq: 80, gain: 0, q: 0.7 }],
    comp: { threshold: -20, ratio: 2.5, attack: 0.01, release: 0.2, knee: 24 },
    makeup: 2,
  },
  {
    id: 'cristalino',
    name: 'Cristalino',
    emoji: '✨',
    desc: 'Brillante y con presencia, tipo protagonista.',
    eq: [
      { type: 'highpass', freq: 90, gain: 0, q: 0.7 },
      { type: 'peaking', freq: 3500, gain: 4, q: 1 },
      { type: 'highshelf', freq: 9000, gain: 3, q: 0.7 },
    ],
    comp: { threshold: -22, ratio: 3, attack: 0.006, release: 0.18, knee: 20 },
    makeup: 3,
  },
  {
    id: 'locutor',
    name: 'Locutor',
    emoji: '📻',
    desc: 'Grave y calido, voz de comercial.',
    eq: [
      { type: 'highpass', freq: 70, gain: 0, q: 0.7 },
      { type: 'lowshelf', freq: 200, gain: 4, q: 0.7 },
      { type: 'peaking', freq: 2500, gain: 3, q: 1.2 },
    ],
    comp: { threshold: -26, ratio: 4, attack: 0.004, release: 0.25, knee: 18 },
    makeup: 4,
  },
  {
    id: 'villano',
    name: 'Villano',
    emoji: '💀',
    desc: 'Profunda y amenazante, tipo Puro Hueso.',
    eq: [
      { type: 'lowshelf', freq: 180, gain: 6, q: 0.7 },
      { type: 'peaking', freq: 900, gain: -3, q: 1 },
      { type: 'highshelf', freq: 8000, gain: -4, q: 0.7 },
    ],
    comp: { threshold: -28, ratio: 5, attack: 0.003, release: 0.3, knee: 12 },
    drive: 0.15,
    delay: { time: 0.09, feedback: 0.2, mix: 0.18 },
    makeup: 4,
  },
  {
    id: 'robot',
    name: 'Robot',
    emoji: '🤖',
    desc: 'Metalica y filtrada, tipo maquina.',
    eq: [
      { type: 'bandpass', freq: 1500, gain: 0, q: 1.2 },
      { type: 'peaking', freq: 3000, gain: 6, q: 3 },
    ],
    comp: { threshold: -30, ratio: 8, attack: 0.002, release: 0.1, knee: 6 },
    drive: 0.4,
    makeup: 5,
  },
  {
    id: 'caverna',
    name: 'Caverna',
    emoji: '🕳️',
    desc: 'Con eco, como dentro de una cueva.',
    eq: [{ type: 'highpass', freq: 90, gain: 0, q: 0.7 }],
    comp: { threshold: -22, ratio: 3, attack: 0.01, release: 0.25, knee: 20 },
    delay: { time: 0.22, feedback: 0.45, mix: 0.35 },
    makeup: 3,
  },
  {
    id: 'radio',
    name: 'Radio vieja',
    emoji: '📞',
    desc: 'Sonido de telefono / radio antigua.',
    eq: [
      { type: 'highpass', freq: 400, gain: 0, q: 0.9 },
      { type: 'lowpass', freq: 3000, gain: 0, q: 0.9 },
      { type: 'peaking', freq: 1500, gain: 5, q: 1.5 },
    ],
    comp: { threshold: -24, ratio: 6, attack: 0.003, release: 0.15, knee: 10 },
    drive: 0.2,
    makeup: 4,
  },
];

export const getProfile = (id) => PROFILES.find(p => p.id === id) || PROFILES[0];
