import { NextRequest } from "next/server";
import { backendPost } from "@/lib/api-client";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
};

/** Transform Ollama stream from JALZA backend to UI format */
function transformOllamaStream(body: ReadableStream): ReadableStream {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = body.getReader();

  return new ReadableStream({
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
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
              }
            } catch { /* skip */ }
          }
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } finally {
        controller.close();
      }
    },
  });
}

export async function POST(req: NextRequest) {
  const { prompt, images } = await req.json();

  try {
    const res = await backendPost("/ai/vision", {
      prompt: prompt || "Čo vidíš na tomto obrázku? Odpovedaj po slovensky. Ak vidíš text, prepíš ho.",
      images,
      stream: true,
    });

    if (!res.ok || !res.body) {
      return new Response(
        JSON.stringify({ error: `Vision model error: ${res.status}` }),
        { status: 502 }
      );
    }

    return new Response(transformOllamaStream(res.body), { headers: SSE_HEADERS });
  } catch {
    return new Response(
      JSON.stringify({ error: "JALZA AI Router nedostupný" }),
      { status: 502 }
    );
  }
}
