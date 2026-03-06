import { OLLAMA_URL, JALZA_API_TOKEN, KNOWLEDGE_API_URL } from "./config";

const USE_PROXY = OLLAMA_URL.includes("localhost") === false
  || process.env.OLLAMA_PROXY === "true";

export function getOllamaUrl(path: string): string {
  if (USE_PROXY) {
    return `${KNOWLEDGE_API_URL}/ollama${path}`;
  }
  return `${OLLAMA_URL}${path}`;
}

export function ollamaHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Bypass-Tunnel-Reminder": "yes",
  };
  if (USE_PROXY && JALZA_API_TOKEN) {
    headers["X-API-Token"] = JALZA_API_TOKEN;
  }
  return headers;
}
