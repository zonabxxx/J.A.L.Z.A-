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
