# 🎙️ Doblaje Latino Studio

Aplicación web de doblaje al español latino con grabación **guiada tipo juego**, filtros de voz en tiempo real (Web Audio API) y exportación **rápida** a MP4 (FFmpeg copia el video sin recodificar).

## ✨ Módulos

- **Login / Dashboard** — auth con Supabase, escenas disponibles y tus proyectos con barra de progreso.
- **Dubbing Studio** — selección de personajes, video sincronizado, libreto con timecodes, grabación guiada (cuenta regresiva 3-2-1, auto-stop al final de la línea, recompensas), ondas con Wavesurfer.js.
- **Filtros de voz** — 7 perfiles (Natural, Cristalino, Locutor, Villano, Robot, Caverna, Radio vieja) con compresión, EQ, saturación y delay. Se aplican con un clic.
- **Creador de escenas** — subida, recorte in/out, ajuste de aspecto y mockup de detección de diálogos.
- **Exportación** — mezcla offline (voces + fondo) + muxeo `-c:v copy` = rápido y sin pérdida de calidad.

## 🗂️ Estructura

```
doblaje-app/
├── public/                  # todo lo que se sirve (raíz en Vercel)
│   ├── index.html           # login
│   ├── dashboard.html
│   ├── studio.html          # estudio guiado
│   ├── creator.html
│   ├── assets/styles.css
│   └── js/
│       ├── lib/             # config + cliente supabase
│       ├── auth/
│       ├── studio/          # recorder, waveform, audioEngine, voiceProfiles, studio
│       ├── creator/         # videoTrimmer, creator
│       └── postproduction/  # mixer (OfflineAudioContext) + exporter (FFmpeg)
├── supabase/
│   ├── migrations/001_initial_schema.sql
│   └── seed.sql             # escena demo (opcional)
├── vercel.json
└── package.json
```

No hay paso de build: HTML + módulos ES + Tailwind por CDN. Las dependencias (Supabase, FFmpeg.wasm, Wavesurfer) se cargan por CDN/esm.sh.

---

## 1️⃣ Configurar Supabase

1. Crea un proyecto en https://supabase.com
2. **SQL Editor** → pega y ejecuta `supabase/migrations/001_initial_schema.sql`.
   Crea tablas, RLS, buckets y políticas de Storage.
3. (Opcional) Ejecuta `supabase/seed.sql` para tener una escena de prueba.
4. **Project Settings → API**: copia `Project URL` y la `anon public key`.
5. Pégalas en `public/js/lib/config.js`:
   ```js
   export const SUPABASE_URL = 'https://xxxx.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJhbGci...';
   ```
6. **Authentication → Providers → Email**: para probar rápido, desactiva
   "Confirm email" (así entras sin verificar el correo).
7. Para ser **creador**: regístrate, ve a **Table Editor → profiles** y cambia tu
   `role` a `creator`.

---

## 2️⃣ Correr en local

Necesitas servir por HTTP (los módulos ES y el micrófono no funcionan con `file://`).

```bash
cd doblaje-app
npm install        # instala 'serve'
npm run dev        # sirve public/ en http://localhost:3000
```

O sin instalar nada:
```bash
npx serve public -l 3000
# o
python3 -m http.server 3000 --directory public
```

Abre http://localhost:3000 → regístrate → entra a la escena demo → dobla → exporta.

> El micrófono requiere `localhost` o HTTPS. `localhost` ya cuenta como seguro.

---

## 3️⃣ Desplegar en Vercel

```bash
npm i -g vercel
vercel            # sigue el asistente
vercel --prod     # despliegue de producción
```

`vercel.json` ya apunta a `public/` como raíz. No hay build.

En Supabase, agrega tu dominio de Vercel en **Authentication → URL Configuration →
Redirect URLs / Site URL** (p. ej. `https://tu-app.vercel.app`).

---

## ⚡ Sobre el render (por qué es rápido)

El video **nunca se recodifica**. El flujo:

1. `OfflineAudioContext` mezcla en el navegador todas las tomas de voz (con su
   filtro, ganancia y offset de lip-sync) sobre la cama de fondo → WAV.
2. FFmpeg.wasm hace `-c:v copy -c:a aac`: copia el stream de video tal cual y solo
   codifica el audio nuevo. El muxeo tarda segundos porque lo pesado (encodear
   video) se salta por completo, y la calidad de imagen queda intacta.

Se usa el **core single-thread** de FFmpeg.wasm para no depender de
`SharedArrayBuffer` (que exigiría headers COOP/COEP y rompería la carga de
recursos de Supabase/CDN).

### Escalar a videos largos
Para películas/capítulos completos, mueve el muxeo a un worker serverless con
FFmpeg nativo (Supabase Edge Function, Fly.io, un contenedor, etc.) usando el
mismo comando `-c:v copy`. El WAV mezclado se sube y el server solo muxea.

## 🔌 Detección real de diálogos
El creador incluye un **mockup** que segmenta por intervalos. Para producción,
sube el audio a un servicio de STT + diarización (Whisper, AssemblyAI, Google
Speech-to-Text) que devuelva `{start, end, speaker, text}` y mapéalo a la tabla
`dialogues`. Ideal como Edge Function para no exponer llaves.

## 🧱 Base de datos (resumen)
`scenes` → `characters` → `dialogues` (líneas con timecodes)
`projects` (sesión de un usuario) → `project_characters` + `takes` (grabaciones).
RLS: cada quien solo ve/edita sus propios proyectos y tomas; escenas publicadas
son de lectura para todos.
