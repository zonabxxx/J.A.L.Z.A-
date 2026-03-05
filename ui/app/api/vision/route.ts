import { NextRequest } from "next/server";
import { VISION_MODEL } from "@/lib/config";
import { getOllamaUrl, ollamaHeaders } from "@/lib/ollama-client";

export async function POST(req: NextRequest) {
  const { prompt, images } = await req.json();

  const res = await fetch(getOllamaUrl("/api/chat"), {
    method: "POST",
    headers: ollamaHeaders(),
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [
        {
          role: "user",
          content: prompt || "Čo vidíš na tomto obrázku? Odpovedaj po slovensky. Ak vidíš text, prepíš ho.",
          images: images,
        },
      ],
      stream: true,
    }),
  });

  if (!res.ok || !res.body) {
    return new Response(
      JSON.stringify({ error: `Vision model error: ${res.status}` }),
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
            if (!line.trim()) continue;
            try {
              const data = JSON.parse(line);
              const content = data.message?.content || "";
              if (content) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ content })}\n\n`)
                );
              }
            } catch {
              // skip
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
