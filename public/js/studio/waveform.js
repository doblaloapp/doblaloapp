// js/studio/waveform.js
// Ondas superpuestas: original grande (gris) + tu grabacion (cyan) encima.
export function createOriginalWave(container, videoEl) {
  return WaveSurfer.create({
    container,
    waveColor: '#64748b',      // gris mas visible
    progressColor: '#8b5cf6',
    height: 120,
    cursorColor: '#8b5cf6',
    cursorWidth: 2,
    media: videoEl,            // sincronizada con el video
  });
}

export function createTakeWave(container) {
  return WaveSurfer.create({
    container,
    waveColor: 'rgba(34,211,238,.9)', // cyan translucido para superponer
    progressColor: 'rgba(34,211,238,.9)',
    height: 120,
    cursorWidth: 0,
  });
}
