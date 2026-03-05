import { NextRequest } from "next/server";
import { DEFAULT_MODEL } from "@/lib/config";
import { backendPost } from "@/lib/api-client";
import { getOllamaUrl, ollamaHeaders } from "@/lib/ollama-client";

export async function POST(req: NextRequest) {
  const { messages, model, agent } = await req.json();

  const useModel = model || DEFAULT_MODEL;
  let finalMessages = [...messages];

  if (agent) {
    try {
      const ctxRes = await backendPost("/context", {
        agent: agent.key,
        question: messages[messages.length - 1]?.content || "",
        top_k: 5,
      });
      if (ctxRes.ok) {
        const ctx = await ctxRes.json();
        if (ctx.context) {
          finalMessages = [
            { role: "system", content: ctx.system_prompt || "" },
            {
              role: "user",
              content: `${ctx.context}\n\nOTÁZKA: ${messages[messages.length - 1]?.content}`,
            },
          ];
        }
      }
    } catch {
      // fallback to regular chat
    }
  }

  const res = await fetch(getOllamaUrl("/api/chat"), {
    method: "POST",
    headers: ollamaHeaders(),
    body: JSON.stringify({
      model: useModel,
      messages: finalMessages,
      stream: true,
    }),
  });

  if (!res.ok || !res.body) {
    return new Response(JSON.stringify({ error: "Ollama nedostupná" }), {
      status: 502,
    });
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
              if (data.done) {
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              }
            } catch {
              // skip malformed lines
            }
          }
        }
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
