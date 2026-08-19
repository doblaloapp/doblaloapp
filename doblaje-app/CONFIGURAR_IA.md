# 🤖 Configurar el Análisis con IA (Pasos 3-5 del Creador)

El creador ahora transcribe el video y separa a los personajes automáticamente
usando **AssemblyAI** (plan gratis: ~10 h/mes + $50 de crédito inicial, sin
tarjeta). La llamada pasa por una **Edge Function de Supabase** para que tu API
key nunca quede expuesta en el navegador.

## 1 · Crear cuenta y obtener la API key (gratis)

1. Entra a **https://www.assemblyai.com** y crea una cuenta (no pide tarjeta).
2. En el **Dashboard**, copia tu **API Key** (una cadena larga, arriba a la
   derecha o en la sección "API Keys").
3. Guárdala; la usarás en el paso 3.

## 2 · Desplegar la Edge Function

Necesitas el **Supabase CLI**. Si no lo tienes:

```bash
npm install -g supabase
supabase login          # abre el navegador para autenticar
```

Enlaza tu proyecto (el ref lo ves en la URL de tu dashboard o en Settings):

```bash
cd doblaje-app
supabase link --project-ref TU-PROJECT-REF
```

Despliega la función:

```bash
supabase functions deploy transcribe
```

## 3 · Guardar la API key como secreto

Aquí es donde tu key queda segura (en el servidor, no en el frontend):

```bash
supabase secrets set ASSEMBLYAI_API_KEY=tu_api_key_de_assemblyai
```

Listo. La función `transcribe` ya puede llamar a AssemblyAI.

> Alternativa sin CLI: en el Dashboard de Supabase → **Edge Functions** puedes
> crear la función `transcribe`, pegar el contenido de
> `supabase/functions/transcribe/index.ts`, y en **Settings → Edge Functions →
> Secrets** añadir `ASSEMBLYAI_API_KEY`.

## 4 · Probar el flujo

En tu app → **+ Crear escena**:

1. **Sube** un video.
2. **Recorta** (se sube solo a la nube al terminar).
3. **Analizar video** → la IA transcribe y detecta hablantes (tarda ~1-2 min).
4. **Personajes detectados** → ponle nombre a cada hablante (Hablante A = Billy…).
5. Ajusta el texto de las líneas si hace falta, pon título y **Publica**.

---

## ⚠️ Cómo funciona la detección (importante)

La IA separa a los hablantes como **"A", "B", "C"** con sus tiempos y texto, pero
**no sabe sus nombres** — ninguna IA de audio los adivina. Por eso el paso 5
(ponerles nombre) es donde tú, como humano, cierras el círculo. Eso es
exactamente el patrón *human-in-the-loop* que pediste: la IA hace el trabajo
pesado, tú validas.

La precisión de la diarización ronda 85-95% con audio limpio y voces distintas.
Si dos personajes suenan muy parecido, puede mezclarlos; por eso las líneas son
editables antes de publicar.

## 🌐 Idioma
Está en modo `language_detection` (detecta el idioma solo). El texto original
saldrá en el idioma del video (inglés normalmente). Tú luego escribes la
traducción al español en el Estudio, línea por línea.

## 💸 Límite gratis
10 h/mes renovables + $50 inicial. Un video de 5 min gasta ~5 min de cuota, así
que da para cientos de escenas cortas antes de pagar nada.
