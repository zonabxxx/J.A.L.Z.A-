import { NextRequest } from "next/server";
import { GEMINI_API_KEY, GEMINI_MODEL } from "@/lib/config";

export async function POST(req: NextRequest) {
  const { prompt, systemPrompt } = await req.json();

  if (!GEMINI_API_KEY) {
    return Response.json({ error: "Gemini API key not configured" }, { status: 500 });
  }

  const contents = [];
  if (systemPrompt) {
    contents.push({ role: "user", parts: [{ text: systemPrompt }] });
    contents.push({ role: "model", parts: [{ text: "Understood." }] });
  }
  contents.push({ role: "user", parts: [{ text: prompt }] });

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 1024,
          },
        }),
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      return Response.json({ error: `Gemini ${res.status}: ${err}` }, { status: 502 });
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return Response.json({ text });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Gemini timeout" },
      { status: 502 }
    );
  }
}
