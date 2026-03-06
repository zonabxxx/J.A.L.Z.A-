import { NextRequest } from "next/server";
import { GEMINI_API_KEY } from "@/lib/config";

const IMAGE_MODEL = "gemini-3.1-flash-image-preview";

export async function POST(req: NextRequest) {
  const { prompt, image: inputImage, useProxy } = await req.json();

  if (useProxy && process.env.US_PROXY_URL) {
    try {
      const proxyRes = await fetch(`${process.env.US_PROXY_URL}/api/generate-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, image: inputImage }),
        signal: AbortSignal.timeout(90000),
      });
      const proxyData = await proxyRes.json();
      return Response.json(proxyData, { status: proxyRes.status });
    } catch {
      // proxy failed, continue with direct call
    }
  }

  if (!prompt) {
    return Response.json({ error: "Missing prompt" }, { status: 400 });
  }

  if (!GEMINI_API_KEY) {
    return Response.json({ error: "Gemini API key not configured" }, { status: 500 });
  }

  const parts: Record<string, unknown>[] = [];

  if (inputImage) {
    const base64 = inputImage.replace(/^data:[^;]+;base64,/, "");
    const mimeMatch = inputImage.match(/^data:([^;]+);base64,/);
    const inputMime = mimeMatch?.[1] || "image/png";
    parts.push({ inlineData: { mimeType: inputMime, data: base64 } });
    parts.push({ text: `Edit this image: ${prompt}` });
  } else {
    parts.push({ text: `Generate an image: ${prompt}. Be creative and produce high quality results.` });
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
            temperature: 1,
          },
        }),
        signal: AbortSignal.timeout(90000),
      }
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => "Unknown error");
      return Response.json({ error: `Gemini ${res.status}: ${errText}` }, { status: 502 });
    }

    const data = await res.json();
    const responseParts = data.candidates?.[0]?.content?.parts || [];

    let text = "";
    let imageBase64 = "";
    let mimeType = "image/png";

    for (const part of responseParts) {
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
