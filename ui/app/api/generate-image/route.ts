import { NextRequest } from "next/server";
import { GEMINI_API_KEY } from "@/lib/config";

const IMAGE_MODEL = "gemini-3.1-flash-image-preview";

export async function POST(req: NextRequest) {
  const { prompt } = await req.json();

  if (!prompt) {
    return Response.json({ error: "Missing prompt" }, { status: 400 });
  }

  if (!GEMINI_API_KEY) {
    return Response.json({ error: "Gemini API key not configured" }, { status: 500 });
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: `Generate an image: ${prompt}. Be creative and produce high quality results.` },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
            temperature: 1,
          },
        }),
        signal: AbortSignal.timeout(60000),
      }
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => "Unknown error");
      return Response.json({ error: `Gemini ${res.status}: ${errText}` }, { status: 502 });
    }

    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts || [];

    let text = "";
    let imageBase64 = "";
    let mimeType = "image/png";

    for (const part of parts) {
      if (part.text) {
        text += part.text;
      }
      if (part.inlineData) {
        imageBase64 = part.inlineData.data;
        mimeType = part.inlineData.mimeType || "image/png";
      }
    }

    if (!imageBase64) {
      return Response.json({
        error: "Gemini nevrátil obrázok. Skús iný prompt.",
        text: text || undefined,
      }, { status: 422 });
    }

    return Response.json({
      image: `data:${mimeType};base64,${imageBase64}`,
      text,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: msg }, { status: 500 });
  }
}
