import { NextRequest } from "next/server";
import { GEMINI_API_KEY, GEMINI_MODEL } from "@/lib/config";

export async function POST(req: NextRequest) {
  const { messages } = await req.json();

  const systemMsg = messages.find((m: { role: string }) => m.role === "system");
  const userMessages = messages
    .filter((m: { role: string }) => m.role !== "system")
    .map((m: { role: string; content: string }) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const contents = [
    {
      role: "user",
      parts: [{ text: systemMsg?.content
        ? `${systemMsg.content}\n\nDôležité: VŽDY odpovedaj po SLOVENSKY.`
        : "Si pomocný asistent J.A.L.Z.A. VŽDY odpovedaj po SLOVENSKY." }],
    },
    { role: "model", parts: [{ text: "Rozumiem, budem odpovedať po slovensky." }] },
    ...userMessages,
  ];

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2048,
        },
      }),
    }
  );

  if (!res.ok || !res.body) {
    const errorText = await res.text().catch(() => "Unknown");
    return new Response(
      JSON.stringify({ error: `Gemini error: ${res.status} ${errorText}` }),
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
              if (!payload || payload === "[DONE]") {
                continue;
              }
              try {
                const data = JSON.parse(payload);
                const parts = data.candidates?.[0]?.content?.parts;
                if (parts) {
                  for (const part of parts) {
                    if (part.text) {
                      controller.enqueue(
                        encoder.encode(
                          `data: ${JSON.stringify({ content: part.text })}\n\n`
                        )
                      );
                    }
                  }
                }
              } catch {
                // skip malformed chunks
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
