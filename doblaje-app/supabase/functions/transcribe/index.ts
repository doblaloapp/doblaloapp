// supabase/functions/transcribe/index.ts
// ============================================================
// Edge Function: transcribe
// Transcribe + diariza (separa hablantes) con AssemblyAI.
// La API key vive como SECRETO del servidor (ASSEMBLYAI_API_KEY),
// nunca llega al navegador.
//
//   { action: 'start',  audioUrl }      -> { id, status }
//   { action: 'status', transcriptId }  -> { status, utterances? }
// ============================================================

const ASSEMBLY = "https://api.assemblyai.com/v2";
const KEY = Deno.env.get("ASSEMBLYAI_API_KEY") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!KEY) return json({ error: "Falta el secreto ASSEMBLYAI_API_KEY" }, 500);

  try {
    const { action, audioUrl, transcriptId } = await req.json();

    // ---- Iniciar transcripcion ----
    if (action === "start") {
      if (!audioUrl) throw new Error("Falta audioUrl");
      const r = await fetch(`${ASSEMBLY}/transcript`, {
        method: "POST",
        headers: { authorization: KEY, "content-type": "application/json" },
        body: JSON.stringify({
          audio_url: audioUrl,
          speaker_labels: true,      // diarizacion (separar personajes)
          language_detection: true,  // detecta idioma solo
        }),
      });
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      return json({ id: data.id, status: data.status });
    }

    // ---- Consultar estado ----
    if (action === "status") {
      if (!transcriptId) throw new Error("Falta transcriptId");
      const r = await fetch(`${ASSEMBLY}/transcript/${transcriptId}`, {
        headers: { authorization: KEY },
      });
      const data = await r.json();

      if (data.status === "error") throw new Error(data.error || "Error de transcripcion");

      if (data.status === "completed") {
        const utterances = (data.utterances ?? []).map((u: any) => ({
          speaker: u.speaker,
          text: u.text,
          start: u.start, // ms
          end: u.end,     // ms
        }));
        return json({ status: "completed", text: data.text, utterances });
      }

      return json({ status: data.status }); // queued | processing
    }

    throw new Error("Accion desconocida (usa 'start' o 'status')");
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 400);
  }
});
