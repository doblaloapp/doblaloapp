// js/creator/videoTrimmer.js
// Recorte (in/out) y ajuste de aspecto con FFmpeg.wasm.
let ff = null;

async function loadFF(onLog) {
  if (ff) return ff;
  const { FFmpeg } = await import('https://esm.sh/@ffmpeg/ffmpeg@0.12.10');
  const { toBlobURL } = await import('https://esm.sh/@ffmpeg/util@0.12.1');
  const f = new FFmpeg();
  if (onLog) f.on('log', ({ message }) => onLog(message));
  const base = 'https://esm.sh/@ffmpeg/core@0.12.6/dist/esm';
  await f.load({
    coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
  });
  ff = f; return f;
}

/**
 * Recorta el video de startSec a endSec.
 * @param {File} file
 * @param {number} startSec
 * @param {number} endSec
 * @param {string} aspect  '16:9' | '9:16' | '1:1' | 'original'
 * @param {function} onProgress
 * @returns {Promise<Blob>} mp4 recortado
 */
export async function trimVideo(file, startSec, endSec, aspect = 'original', onProgress) {
  const f = await loadFF();
  onProgress?.('Cargando video...');
  await f.writeFile('src.mp4', new Uint8Array(await file.arrayBuffer()));

  const dur = Math.max(0.1, endSec - startSec);
  const args = ['-ss', String(startSec), '-i', 'src.mp4', '-t', String(dur)];

  if (aspect === 'original') {
    // Corte rapido sin recodificar (cae al keyframe mas cercano)
    args.push('-c', 'copy');
  } else {
    // Ajuste de aspecto: recorte central + escalado (requiere recodificar)
    const cropMap = {
      '16:9': 'crop=iw:iw*9/16',
      '9:16': 'crop=ih*9/16:ih',
      '1:1':  'crop=min(iw\\,ih):min(iw\\,ih)',
    };
    args.push('-vf', cropMap[aspect] || 'null', '-c:a', 'copy');
  }
  args.push('out.mp4');

  onProgress?.('Recortando...');
  await f.exec(args);
  const out = await f.readFile('out.mp4');
  return new Blob([out.buffer], { type: 'video/mp4' });
}
