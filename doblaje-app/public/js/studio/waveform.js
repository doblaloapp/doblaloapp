// js/studio/waveform.js
// Wrapper ligero sobre Wavesurfer.js (cargado por CDN como global WaveSurfer)
export function createOriginalWave(container, videoEl) {
  return WaveSurfer.create({
    container,
    waveColor: '#475569',
    progressColor: '#8b5cf6',
    height: 56,
    cursorColor: '#8b5cf6',
    media: videoEl, // se sincroniza con el video automaticamente
  });
}

export function createTakeWave(container) {
  return WaveSurfer.create({
    container,
    waveColor: '#0e7490',
    progressColor: '#22d3ee',
    height: 56,
    cursorColor: '#22d3ee',
  });
}
