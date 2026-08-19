// js/creator/videoTrimmer.js
// Recorte con FFmpeg.wasm.
// FIX definitivo del cuelgue: el worker se sirve desde TU dominio
// (/ffmpeg/worker.js) para que sus imports relativos (const.js,
// errors.js) resuelvan bien. Cargarlo como blob los rompia y load()
// se colgaba sin error.
let ff = null;
let progressCb = null;

async function loadFF() {
  if (ff) return ff;
  const { FFmpeg } = await import('https://esm.sh/@ffmpeg/ffmpeg@0.12.10');
  const { toBlobURL } = await import('https://esm.sh/@ffmpeg/util@0.12.1');
  const f = new FFmpeg();

  f.on('log', ({ message }) => {
    if (/error|invalid|failed/i.test(message)) console.warn('[ffmpeg]', message);
  });
  f.on('progress', ({ progress }) => {
    if (progressCb) progressCb(`Recortando... ${Math.round((progress || 0) * 100)}%`);
  });

  const coreBase = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
  await f.load({
    // worker desde el MISMO origen (archivos en public/ffmpeg/)
    classWorkerURL: new URL('/ffmpeg/worker.js', location.origin).href,
    coreURL: await toBlobURL(`${coreBase}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${coreBase}/ffmpeg-core.wasm`, 'application/wasm'),
  });
  ff = f;
  return f;
}

export async function trimVideo(file, startSec, endSec, aspect = 'original', onProgress) {
  progressCb = onProgress;
  onProgress?.('Cargando motor (primera vez ~15s)...');
  const f = await loadFF();

  onProgress?.('Leyendo video...');
  await f.writeFile('src.mp4', new Uint8Array(await file.arrayBuffer()));

  const dur = Math.max(0.1, endSec - startSec);
  const args = ['-ss', String(startSec), '-i', 'src.mp4', '-t', String(dur)];

  if (aspect === 'original') {
    args.push('-c', 'copy', '-avoid_negative_ts', 'make_zero');
  } else {
    const cropMap = {
      '16:9': 'crop=iw:iw*9/16',
      '9:16': 'crop=ih*9/16:ih',
      '1:1':  'crop=min(iw\\,ih):min(iw\\,ih)',
    };
    args.push('-vf', cropMap[aspect] || 'null', '-c:a', 'copy');
  }
  args.push('out.mp4');

  onProgress?.('Recortando... 0%');
  await f.exec(args);

  const out = await f.readFile('out.mp4');
  progressCb = null;
  return new Blob([out.buffer], { type: 'video/mp4' });
}
