import { NextRequest } from "next/server";
import { jalzaAI } from "@/lib/api-client";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
};

/** Convert OpenAI SSE stream to UI format */
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
  const { messages, model } = await req.json();

  const systemMessages = messages.filter((m: { role: string }) => m.role === "system");
  const otherMessages = messages.filter((m: { role: string }) => m.role !== "system");

  const finalMessages = [
    {
      role: "system",
      content: systemMessages.length > 0
        ? systemMessages.map((m: { content: string }) => m.content).join("\n")
        : "Si J.A.L.Z.A. — inteligentný osobný AI asistent. VŽDY odpovedaj po SLOVENSKY.",
    },
    ...otherMessages,
  ];

  try {
    const res = await jalzaAI({
      messages: finalMessages,
      model: model || undefined,
      stream: true,
    });

    if (!res.ok || !res.body) {
      const errorText = await res.text().catch(() => "Unknown");
      return new Response(
        JSON.stringify({ error: `JALZA AI error: ${res.status} ${errorText}` }),
        { status: 502 }
      );
    }

    return new Response(transformStream(res.body), { headers: SSE_HEADERS });
  } catch {
    return new Response(
      JSON.stringify({ error: "JALZA AI Router nedostupný" }),
      { status: 502 }
    );
  }
}
