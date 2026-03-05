import { NextRequest } from "next/server";
import { backendPost } from "@/lib/api-client";

export async function POST(req: NextRequest) {
  const { text } = await req.json();
  if (!text) {
    return Response.json({ error: "No text" }, { status: 400 });
  }

  try {
    const cfgRes = await backendPost("/integrations", {});
    const cfgData = await cfgRes.json();
    const el = cfgData.integrations?.find(
      (i: { id: string }) => i.id === "elevenlabs"
    );

    if (el?.status === "connected" && el?.config?.voice_id) {
      const apiKeyRes = await backendPost("/integrations/tts", { text });

      if (apiKeyRes.ok) {
        const audioBlob = await apiKeyRes.blob();
        return new Response(audioBlob, {
          headers: { "Content-Type": "audio/mpeg" },
        });
      }
    }
  } catch {
    // ElevenLabs not available
  }

  return Response.json(
    { error: "TTS not configured, using browser fallback" },
    { status: 501 }
  );
}
