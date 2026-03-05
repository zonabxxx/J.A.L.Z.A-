import { NextRequest } from "next/server";
import { GEMINI_API_KEY } from "@/lib/config";

export async function POST(req: NextRequest) {
  const { messages, model } = await req.json();

  if (!GEMINI_API_KEY) {
    return new Response(JSON.stringify({ error: "Gemini API key not configured" }), { status: 500 });
  }

  const geminiModel = model || "gemini-2.5-flash-preview-05-20";

  const contents = [];
  for (const msg of messages) {
    if (msg.role === "system") {
      contents.push({ role: "user", parts: [{ text: msg.content }] });
      contents.push({ role: "model", parts: [{ text: "Rozumiem, budem sa riadiť týmito inštrukciami." }] });
    } else {
      contents.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      });
    }
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        systemInstruction: {
          parts: [{ text: "Si J.A.L.Z.A. — inteligentný osobný AI asistent. VŽDY odpovedaj po SLOVENSKY, pokiaľ používateľ výslovne nepožiada o iný jazyk. Buď presný, stručný a užitočný." }],
        },
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 4096,
        },
      }),
    }
  );

  if (!res.ok || !res.body) {
    const errorText = await res.text().catch(() => "Unknown");
    return new Response(
      JSON.stringify({ error: `Gemini ${res.status}: ${errorText}` }),
      { status: 502 }
    );
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = res.body.getReader();

  const stream = new ReadableStream({
    async start(controller) {
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const payload = line.slice(6).trim();
              if (!payload || payload === "[DONE]") continue;
              try {
                const data = JSON.parse(payload);
                const parts = data.candidates?.[0]?.content?.parts;
                if (parts) {
                  for (const part of parts) {
                    if (part.text) {
                      controller.enqueue(
                        encoder.encode(`data: ${JSON.stringify({ content: part.text })}\n\n`)
                      );
                    }
                  }
                }
              } catch {
                // skip
              }
            }
          }
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
