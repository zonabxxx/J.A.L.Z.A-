import { KNOWLEDGE_API_URL, JALZA_API_TOKEN } from "./config";

export async function backendFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  headers.set("Bypass-Tunnel-Reminder", "yes");
  if (JALZA_API_TOKEN) {
    headers.set("X-API-Token", JALZA_API_TOKEN);
  }
  return fetch(`${KNOWLEDGE_API_URL}${path}`, { ...options, headers });
}

export async function backendPost(
  path: string,
  body: unknown
): Promise<Response> {
  return backendFetch(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function backendGet(path: string): Promise<Response> {
  const headers: Record<string, string> = {
    "Bypass-Tunnel-Reminder": "yes",
  };
  if (JALZA_API_TOKEN) {
    headers["X-API-Token"] = JALZA_API_TOKEN;
  }
  return fetch(`${KNOWLEDGE_API_URL}${path}`, { headers });
}

export interface JalzaAIOptions {
  messages: { role: string; content: string }[];
  task_type?: string;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

/**
 * All AI calls go through JALZA's AI Router.
 * The router decides which model (Ollama/Gemini) to use.
 */
export async function jalzaAI(options: JalzaAIOptions): Promise<Response> {
  const payload: Record<string, unknown> = {
    messages: options.messages,
    model: options.model || "jalza",
    stream: options.stream ?? false,
  };
  if (options.task_type) payload.task_type = options.task_type;
  if (options.temperature !== undefined) payload.temperature = options.temperature;
  if (options.max_tokens !== undefined) payload.max_tokens = options.max_tokens;

  return backendPost("/ai-router/v1/chat/completions", payload);
}

/** Extract text from OpenAI-compatible (non-streaming) response */
export async function jalzaAIText(options: JalzaAIOptions): Promise<string> {
  const res = await jalzaAI({ ...options, stream: false });
  if (!res.ok) return "";
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}
