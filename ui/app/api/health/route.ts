import { KNOWLEDGE_API_URL, JALZA_API_TOKEN } from "@/lib/config";

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
  const apiHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "Bypass-Tunnel-Reminder": "yes",
  };
  if (JALZA_API_TOKEN) apiHeaders["X-API-Token"] = JALZA_API_TOKEN;

  const checks = await Promise.all([
    checkService("ollama", async () => {
      const res = await fetch(`${KNOWLEDGE_API_URL}/ai-router/models`, {
        headers: apiHeaders,
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return { ok: false };
      const data = await res.json();
      const models = (data.ollama || []).join(", ");
      return { ok: data.ollama?.length > 0, details: models };
    }),

    checkService("knowledge_api", async () => {
      const res = await fetch(`${KNOWLEDGE_API_URL}/agents`, {
        headers: apiHeaders,
        signal: AbortSignal.timeout(5000),
      });
      return { ok: res.ok };
    }),

    checkService("gemini", async () => {
      const res = await fetch(`${KNOWLEDGE_API_URL}/ai-router/models`, {
        headers: apiHeaders,
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return { ok: false };
      const data = await res.json();
      return { ok: data.gemini?.length > 0, details: data.gemini?.join(", ") };
    }),
  ]);

  const services: ServiceStatus[] = [
    { id: "ollama", name: "Ollama (LLM)", ...checks[0] },
    { id: "knowledge_api", name: "Knowledge API", ...checks[1] },
    { id: "gemini", name: "Google Gemini", ...checks[2] },
  ];

  return Response.json({ services });
}
