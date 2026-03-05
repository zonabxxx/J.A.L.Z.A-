import { GEMINI_API_KEY, KNOWLEDGE_API_URL, JALZA_API_TOKEN } from "@/lib/config";
import { getOllamaUrl, ollamaHeaders } from "@/lib/ollama-client";

interface ServiceStatus {
  id: string;
  name: string;
  status: "online" | "offline";
  latency?: number;
  details?: string;
}

async function checkService(
  name: string,
  fn: () => Promise<{ ok: boolean; details?: string }>
): Promise<Omit<ServiceStatus, "id" | "name">> {
  const start = Date.now();
  try {
    const result = await fn();
    return {
      status: result.ok ? "online" : "offline",
      latency: Date.now() - start,
      details: result.details,
    };
  } catch {
    return { status: "offline", latency: Date.now() - start };
  }
}

export async function GET() {
  const checks = await Promise.all([
    checkService("ollama", async () => {
      const res = await fetch(getOllamaUrl("/api/tags"), {
        headers: ollamaHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return { ok: false };
      const data = await res.json();
      const models = (data.models || []).map((m: { name: string }) => m.name);
      return { ok: true, details: models.join(", ") };
    }),

    checkService("knowledge_api", async () => {
      const headers: Record<string, string> = {};
      if (JALZA_API_TOKEN) headers["X-API-Token"] = JALZA_API_TOKEN;
      const res = await fetch(`${KNOWLEDGE_API_URL}/agents`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });
      return { ok: res.ok };
    }),

    checkService("gemini", async () => {
      if (!GEMINI_API_KEY) return { ok: false, details: "No API key" };
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`,
        { signal: AbortSignal.timeout(5000) }
      );
      return { ok: res.ok, details: res.ok ? undefined : `HTTP ${res.status}` };
    }),
  ]);

  const services: ServiceStatus[] = [
    { id: "ollama", name: "Ollama (LLM)", ...checks[0] },
    { id: "knowledge_api", name: "Knowledge API", ...checks[1] },
    { id: "gemini", name: "Google Gemini", ...checks[2] },
  ];

  return Response.json({ services });
}
