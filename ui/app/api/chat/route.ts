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
    { role: "user", parts: [{ text: "Si J.A.L.Z.A., inteligentný AI asistent. Odpovedáš VŽDY po SLOVENSKY. Buď stručný, vecný a presný." }] },
    { role: "model", parts: [{ text: "Rozumiem, budem odpovedať po slovensky." }] },
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
        signal: AbortSignal.timeout(60000),
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
  let finalMessages = messages
    .filter((m: { role: string }) => m.role !== "system")
    .slice(-20);

  // Inject persistent facts into context
  if (!agent) {
    try {
      const factsRes = await backendPost("/facts", { action: "list", limit: 30 });
      if (factsRes.ok) {
        const factsData = await factsRes.json();
        const factsList = factsData.facts;
        if (factsList && factsList.length > 0) {
          const factsBlock = factsList.map((f: { fact: string }) => `- ${f.fact}`).join("\n");
          finalMessages = [
            { role: "user", content: `Dodatočné fakty z pamäte (použi ich ak sú relevantné):\n${factsBlock}` },
            { role: "assistant", content: "Rozumiem, mám tieto fakty na pamäti." },
            ...finalMessages,
          ];
        }
      }
    } catch { /* no facts available */ }
  }

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

  let ollamaError = "";
  try {
    const ollamaUrl = getOllamaUrl("/api/chat");
    console.log(`[chat] Ollama request to: ${ollamaUrl}`);
    const res = await fetch(ollamaUrl, {
      method: "POST",
      headers: ollamaHeaders(),
      body: JSON.stringify({ model: useModel, messages: finalMessages, stream: true }),
      signal: AbortSignal.timeout(180000),
    });

    if (res.ok && res.body) {
      return new Response(streamOllama(res.body), { headers: SSE_HEADERS });
    }
    ollamaError = `HTTP ${res.status}`;
    console.log(`[chat] Ollama error: ${ollamaError}`);
  } catch (err) {
    ollamaError = err instanceof Error ? err.message : "unknown";
    console.log(`[chat] Ollama exception: ${ollamaError}`);
  }

  const geminiRes = await tryGeminiFallback(finalMessages);
  if (geminiRes) {
    const encoder = new TextEncoder();
    const notice = `⚠️ *Lokálny model nedostupný (${ollamaError}), odpovedá Gemini — bez osobných dát.*\n\n`;
    const combined = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: notice })}\n\n`));
        if (geminiRes.body) {
          const reader = geminiRes.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        }
        controller.close();
      },
    });
    return new Response(combined, { headers: SSE_HEADERS });
  }

  return new Response(
    JSON.stringify({ error: "Ollama aj Gemini sú nedostupné. Skontroluj pripojenie." }),
    { status: 502 }
  );
}
