import { NextRequest } from "next/server";
import { KNOWLEDGE_API_URL, JALZA_API_TOKEN } from "@/lib/config";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return Response.json({ error: "No file" }, { status: 400 });
  }

  try {
    const proxyForm = new FormData();
    proxyForm.append("file", file, "recording.webm");

    const res = await fetch(`${KNOWLEDGE_API_URL}/transcribe`, {
      method: "POST",
      headers: { "X-API-Token": JALZA_API_TOKEN },
      body: proxyForm,
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return Response.json(
        { error: err.error || "Transcription failed" },
        { status: res.status }
      );
    }

    const data = await res.json();
    return Response.json({ text: data.text || "" });
  } catch (e) {
    return Response.json(
      { error: `Whisper unavailable: ${e instanceof Error ? e.message : "timeout"}` },
      { status: 502 }
    );
  }
}
