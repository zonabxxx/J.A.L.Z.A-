import { NextRequest } from "next/server";
import { DEFAULT_MODEL, GEMINI_API_KEY } from "@/lib/config";
import { backendPost } from "@/lib/api-client";
import { getOllamaUrl, ollamaHeaders } from "@/lib/ollama-client";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
};

function streamOllama(body: ReadableStream) {
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
              if (data.done) {
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              }
            } catch { /* skip */ }
          }
        }
      } finally {
        controller.close();
      }
    },
  });
}

function streamGemini(body: ReadableStream) {
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
            if (line.startsWith("data: ")) {
              const payload = line.slice(6).trim();
              if (!payload || payload === "[DONE]") continue;
              try {
                const data = JSON.parse(payload);
                const parts = data.candidates?.[0]?.content?.parts;
                if (parts) {
                  for (const part of parts) {
                    if (part.text) {
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: part.text })}\n\n`));
                    }
                  }
                }
              } catch { /* skip */ }
            }
          }
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } finally {
        controller.close();
      }
    },
  });
}

async function tryGeminiFallback(messages: { role: string; content: string }[]): Promise<Response | null> {
  if (!GEMINI_API_KEY) return null;

  const contents = [
    { role: "user", parts: [{ text: "Si J.A.L.Z.A., inteligentný osobný asistent. Odpovedáš VŽDY po SLOVENSKY. Si priateľský a stručný." }] },
    { role: "model", parts: [{ text: "Rozumiem, som J.A.L.Z.A. a budem odpovedať po slovensky." }] },
    ...messages
      .filter(m => m.role !== "system")
      .map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
  ];

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents, generationConfig: { temperature: 0.7, maxOutputTokens: 4096 } }),
        signal: AbortSignal.timeout(30000),
      }
    );
    if (!res.ok || !res.body) return null;
    return new Response(streamGemini(res.body), { headers: SSE_HEADERS });
  } catch {
    return null;
  }
}

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
    } catch { /* fallback to regular chat */ }
  }

  try {
    const res = await fetch(getOllamaUrl("/api/chat"), {
      method: "POST",
      headers: ollamaHeaders(),
      body: JSON.stringify({ model: useModel, messages: finalMessages, stream: true }),
      signal: AbortSignal.timeout(30000),
    });

    if (res.ok && res.body) {
      return new Response(streamOllama(res.body), { headers: SSE_HEADERS });
    }
  } catch { /* Ollama failed — try Gemini */ }

  const geminiRes = await tryGeminiFallback(finalMessages);
  if (geminiRes) return geminiRes;

  return new Response(
    JSON.stringify({ error: "Ollama aj Gemini sú nedostupné. Skontroluj pripojenie." }),
    { status: 502 }
  );
}
