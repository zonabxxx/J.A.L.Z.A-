import { NextRequest } from "next/server";
import { GEMINI_API_KEY } from "@/lib/config";
import { getOllamaUrl, ollamaHeaders } from "@/lib/ollama-client";

const GEMINI_MODEL = "gemini-2.0-flash";
const OLLAMA_MODEL = "jalza";

async function tryGemini(
  prompt: string,
  systemPrompt?: string
): Promise<string | null> {
  if (!GEMINI_API_KEY) return null;

  const contents = [];
  if (systemPrompt) {
    contents.push({ role: "user", parts: [{ text: systemPrompt }] });
    contents.push({ role: "model", parts: [{ text: "Understood." }] });
  }
  contents.push({ role: "user", parts: [{ text: prompt }] });

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
        }),
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch {
    return null;
  }
}

async function tryOllama(
  prompt: string,
  systemPrompt?: string
): Promise<string | null> {
  const messages = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  try {
    const res = await fetch(getOllamaUrl("/api/chat"), {
      method: "POST",
      headers: ollamaHeaders(),
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages,
        stream: false,
        options: { temperature: 0.3 },
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.message?.content || null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const { prompt, systemPrompt } = await req.json();

  // Try Gemini first, fall back to Ollama
  let text = await tryGemini(prompt, systemPrompt);

  if (!text) {
    text = await tryOllama(prompt, systemPrompt);
  }

  if (!text) {
    return Response.json(
      { error: "Ani Gemini ani Ollama nie sú dostupné" },
      { status: 502 }
    );
  }

  return Response.json({ text });
}
