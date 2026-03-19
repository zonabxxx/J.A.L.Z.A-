import { NextRequest } from "next/server";
import { DEFAULT_MODEL } from "@/lib/config";
import { backendPost, jalzaAI } from "@/lib/api-client";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
};

/** Convert OpenAI SSE stream to UI format: data: {"content":"..."} */
function transformStream(body: ReadableStream): ReadableStream {
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
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6).trim();
            if (payload === "[DONE]") {
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              continue;
            }
            try {
              const data = JSON.parse(payload);
              const content = data.choices?.[0]?.delta?.content;
              if (content) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
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

export async function POST(req: NextRequest) {
  const { messages, model, agent } = await req.json();

  const useModel = model || DEFAULT_MODEL;
  let finalMessages = messages
    .filter((m: { role: string }) => m.role !== "system")
    .slice(-20);

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

  try {
    const res = await jalzaAI({
      messages: finalMessages,
      model: useModel,
      stream: true,
      task_type: "chat",
    });

    if (!res.ok || !res.body) {
      return new Response(
        JSON.stringify({ error: "JALZA AI Router nedostupný" }),
        { status: 502 }
      );
    }

    return new Response(transformStream(res.body), { headers: SSE_HEADERS });
  } catch {
    return new Response(
      JSON.stringify({ error: "JALZA AI Router nedostupný. Skontroluj pripojenie." }),
      { status: 502 }
    );
  }
}
