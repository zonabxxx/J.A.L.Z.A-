import { NextRequest } from "next/server";
import { OLLAMA_URL } from "@/lib/config";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return Response.json({ error: "No file" }, { status: 400 });
  }

  // Try Whisper via Ollama (if available)
  try {
    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");

    // Use Ollama's whisper endpoint if available
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "jalza",
        messages: [
          {
            role: "system",
            content:
              "Prepíš nasledujúci hlasový vstup do textu. Odpovedz IBA prepísaným textom, nič iné nepridávaj.",
          },
          {
            role: "user",
            content: `[Hlasový vstup - audio base64: ${base64.substring(0, 100)}...]`,
          },
        ],
        stream: false,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (res.ok) {
      const data = await res.json();
      const text = data.message?.content || "";
      if (text) return Response.json({ text });
    }
  } catch {
    // Ollama whisper not available, fallback
  }

  // Fallback: signal to client to use Web Speech API
  return Response.json(
    { error: "Whisper not available, use browser speech recognition" },
    { status: 501 }
  );
}
