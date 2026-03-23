import { KNOWLEDGE_API_URL, JALZA_API_TOKEN } from "./config";

function buildHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("Content-Type", "application/json");
  headers.set("Bypass-Tunnel-Reminder", "yes");
  if (JALZA_API_TOKEN) {
    headers.set("X-API-Token", JALZA_API_TOKEN);
  }
  return headers;
}

export async function backendFetch(
  path: string,
  options: RequestInit = {},
  timeoutMs?: number
): Promise<Response> {
  const url = `${KNOWLEDGE_API_URL}${path}`;
  if (timeoutMs) {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...options,
        headers: buildHeaders(options.headers),
        signal: controller.signal,
      });
      clearTimeout(tid);
      return res;
    } catch (err) {
      clearTimeout(tid);
      throw err;
    }
  }
  return fetch(url, { ...options, headers: buildHeaders(options.headers) });
}

export async function backendPost(
  path: string,
  body: unknown,
  timeoutMs?: number
): Promise<Response> {
  return backendFetch(
    path,
    { method: "POST", body: JSON.stringify(body) },
    timeoutMs
  );
}

export async function backendGet(
  path: string,
  timeoutMs?: number
): Promise<Response> {
  return backendFetch(path, {}, timeoutMs);
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
