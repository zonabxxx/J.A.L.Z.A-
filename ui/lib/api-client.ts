import { KNOWLEDGE_API_URL, JALZA_API_TOKEN } from "./config";

const BACKEND_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1_000;

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = MAX_RETRIES
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return res;
    } catch (err) {
      const isLast = attempt === retries;
      if (isLast) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Backend unreachable after ${retries + 1} attempts (${url}): ${reason}`
        );
      }
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
    }
  }
  throw new Error("Unreachable");
}

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
  return fetchWithRetry(`${KNOWLEDGE_API_URL}${path}`, { ...options, headers });
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
    "Content-Type": "application/json",
    "Bypass-Tunnel-Reminder": "yes",
  };
  if (JALZA_API_TOKEN) {
    headers["X-API-Token"] = JALZA_API_TOKEN;
  }
  return fetchWithRetry(`${KNOWLEDGE_API_URL}${path}`, { headers });
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
