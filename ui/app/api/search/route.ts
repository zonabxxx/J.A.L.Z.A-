import { NextRequest } from "next/server";
import { backendPost } from "@/lib/api-client";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
};

/** Transform Gemini native SSE to UI format */
function transformGeminiStream(body: ReadableStream): ReadableStream {
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

export async function POST(req: NextRequest) {
  const { messages } = await req.json();

  const systemMsg = messages.find((m: { role: string }) => m.role === "system");
  const userMessages = messages.filter((m: { role: string }) => m.role !== "system");

  const allMessages = [
    {
      role: "system",
      content: systemMsg?.content
        ? `${systemMsg.content}\n\nDôležité: VŽDY odpovedaj po SLOVENSKY.`
        : "Si pomocný asistent J.A.L.Z.A. VŽDY odpovedaj po SLOVENSKY.",
    },
    ...userMessages,
  ];

  try {
    const res = await backendPost("/ai/web-search", {
      messages: allMessages,
      temperature: 0.7,
      max_tokens: 2048,
      stream: true,
    });

    if (!res.ok || !res.body) {
      const errorText = await res.text().catch(() => "Unknown");
      return new Response(
        JSON.stringify({ error: `JALZA AI error: ${res.status} ${errorText}` }),
        { status: 502 }
      );
    }

    return new Response(transformGeminiStream(res.body), { headers: SSE_HEADERS });
  } catch {
    return new Response(
      JSON.stringify({ error: "JALZA AI Router nedostupný" }),
      { status: 502 }
    );
  }
}
