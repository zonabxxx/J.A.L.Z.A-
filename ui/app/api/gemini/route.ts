import { NextRequest } from "next/server";
import { jalzaAIText } from "@/lib/api-client";

export async function POST(req: NextRequest) {
  const { prompt, systemPrompt } = await req.json();

  const messages: { role: string; content: string }[] = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const text = await jalzaAIText({
    messages,
    temperature: 0.3,
    max_tokens: 1024,
  });

  if (!text) {
    return Response.json(
      { error: "JALZA AI Router nedostupný" },
      { status: 502 }
    );
  }

  return Response.json({ text });
}
