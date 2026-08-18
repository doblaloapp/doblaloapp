// js/postproduction/exporter.js
// ============================================================
// RENDER FINAL - ruta rapida que conserva calidad:
//   FFmpeg copia el stream de video (-c:v copy) sin recodificar
//   y solo codifica el audio mezclado a AAC. Muxeo = segundos,
//   no minutos, porque el video (lo pesado) nunca se re-encodea.
//
// Usa el core single-thread de FFmpeg.wasm para NO depender de
// SharedArrayBuffer (que requeriria headers COOP/COEP y romperia
// la carga de recursos cross-origin de Supabase/CDN).
// ============================================================
import { renderMix } from './mixer.js';

let ffmpegInstance = null;

async function getFFmpeg(onProgress) {
  if (ffmpegInstance) return ffmpegInstance;
  onProgress?.(2, 'Cargando motor de render...');

  const { FFmpeg } = await import('https://esm.sh/@ffmpeg/ffmpeg@0.12.10');
  const { toBlobURL } = await import('https://esm.sh/@ffmpeg/util@0.12.1');

  const ffmpeg = new FFmpeg();
  const base = 'https://esm.sh/@ffmpeg/core@0.12.6/dist/esm';
  await ffmpeg.load({
    coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
  });
  ffmpegInstance = ffmpeg;
  return ffmpeg;
}

/**
 * Exporta el proyecto a MP4 y devuelve un object URL descargable.
 */
export async function exportProject({ scene, dialogues, takes, projectId, onProgress }) {
  // 1) Mezcla de audio (rapida, en el navegador)
  const wavBlob = await renderMix({ scene, dialogues, takes, onProgress });

  // 2) Cargar FFmpeg y archivos
  const ffmpeg = await getFFmpeg(onProgress);
  onProgress?.(72, 'Descargando video base...');

  const videoData = new Uint8Array(await (await fetch(scene.source_video_url)).arrayBuffer());
  const wavData = new Uint8Array(await wavBlob.arrayBuffer());

  await ffmpeg.writeFile('in.mp4', videoData);
  await ffmpeg.writeFile('mix.wav', wavData);

  onProgress?.(82, 'Uniendo video + audio (sin recodificar video)...');

  // -c:v copy => NO recodifica video (rapido, calidad intacta)
  // -map 0:v:0 (video original) + -map 1:a:0 (nuestro audio mezclado)
  await ffmpeg.exec([
    '-i', 'in.mp4',
    '-i', 'mix.wav',
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    'out.mp4',
  ]);

  onProgress?.(95, 'Finalizando...');
  const out = await ffmpeg.readFile('out.mp4');
  const blob = new Blob([out.buffer], { type: 'video/mp4' });
  const url = URL.createObjectURL(blob);
  onProgress?.(100, '¡Listo!');
  return url;
}
