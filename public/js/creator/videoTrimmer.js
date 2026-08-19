// js/creator/videoTrimmer.js
// Recorte (in/out) y ajuste de aspecto con FFmpeg.wasm.
// FIX worker cross-origin: se carga classWorkerURL como blob URL.
let ff = null;

async function loadFF(onLog) {
  if (ff) return ff;
  const { FFmpeg } = await import('https://esm.sh/@ffmpeg/ffmpeg@0.12.10');
  const { toBlobURL } = await import('https://esm.sh/@ffmpeg/util@0.12.1');
  const f = new FFmpeg();
  if (onLog) f.on('log', ({ message }) => onLog(message));

  const coreBase = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
  await f.load({
    // <- clave: el worker debe venir como blob del mismo origen
    classWorkerURL: await toBlobURL(
      'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/worker.js', 'text/javascript'),
    coreURL: await toBlobURL(`${coreBase}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${coreBase}/ffmpeg-core.wasm`, 'application/wasm'),
  });
  ff = f;
  return f;
}

/**
 * Recorta el video de startSec a endSec.
 * aspect: '16:9' | '9:16' | '1:1' | 'original'
 */
export async function trimVideo(file, startSec, endSec, aspect = 'original', onProgress) {
  const f = await loadFF();
  onProgress?.('Cargando video...');
  await f.writeFile('src.mp4', new Uint8Array(await file.arrayBuffer()));

  const dur = Math.max(0.1, endSec - startSec);
  const args = ['-ss', String(startSec), '-i', 'src.mp4', '-t', String(dur)];

  if (aspect === 'original') {
    args.push('-c', 'copy'); // corte rapido sin recodificar
  } else {
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
