import {
  KNOWLEDGE_API_URL,
  KNOWLEDGE_API_FALLBACK,
  JALZA_API_TOKEN,
} from "./config";

const BACKEND_TIMEOUT_MS = 10_000;

function buildHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("Content-Type", "application/json");
  headers.set("Bypass-Tunnel-Reminder", "yes");
  if (JALZA_API_TOKEN) {
    headers.set("X-API-Token", JALZA_API_TOKEN);
  }
  return headers;
}

async function timedFetch(
  url: string,
  options: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return res;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

async function fetchWithFallback(
  path: string,
  options: RequestInit
): Promise<Response> {
  const urls: string[] = [];
  if (KNOWLEDGE_API_FALLBACK) urls.push(KNOWLEDGE_API_FALLBACK);
  urls.push(KNOWLEDGE_API_URL);

  let lastError: Error | null = null;
  for (const base of urls) {
    try {
      return await timedFetch(`${base}${path}`, options);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(
        `[backendFetch] ${base}${path} failed: ${lastError.message}`
      );
    }
  }
  throw new Error(
    `Backend unreachable on all URLs (${urls.join(", ")}): ${lastError?.message}`
  );
}

export async function backendFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  return fetchWithFallback(path, { ...options, headers: buildHeaders(options.headers) });
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
  return fetchWithFallback(path, { headers: buildHeaders() });
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
