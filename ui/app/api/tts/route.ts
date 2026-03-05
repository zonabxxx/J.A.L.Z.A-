import { NextRequest } from "next/server";
import { KNOWLEDGE_API_URL } from "@/lib/config";

export async function POST(req: NextRequest) {
  const { text } = await req.json();
  if (!text) {
    return Response.json({ error: "No text" }, { status: 400 });
  }

  // Check if ElevenLabs is configured
  try {
    const cfgRes = await fetch(`${KNOWLEDGE_API_URL}/integrations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const cfgData = await cfgRes.json();
    const el = cfgData.integrations?.find(
      (i: { id: string }) => i.id === "elevenlabs"
    );

    if (el?.status === "connected" && el?.config?.voice_id) {
      // Get full config from settings
      const settingsRes = await fetch(`${KNOWLEDGE_API_URL}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const settings = await settingsRes.json();

      // We need API key - fetch from config.json via a new endpoint
      // For now, use the integration config
      const apiKeyRes = await fetch(`${KNOWLEDGE_API_URL}/integrations/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

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

  // Signal client to use browser TTS
  return Response.json(
    { error: "TTS not configured, using browser fallback" },
    { status: 501 }
  );
}
