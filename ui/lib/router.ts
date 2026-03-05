import { getFeatures } from "./features";

export type RouteType = "text" | "search" | "email" | "knowledge";

export interface RouteResult {
  type: RouteType;
  model: string;
  label: string;
  icon: string;
  agentKey?: string;
  agentName?: string;
}

const FALLBACK: RouteResult = {
  type: "text",
  model: "jalza",
  label: "J.A.L.Z.A.",
  icon: "🧠",
};

export async function detectRoute(
  text: string,
  hasAgent: boolean,
  agentKey?: string,
  agentName?: string
): Promise<RouteResult> {
  const features = getFeatures();
  if (!features.autoRouting) return FALLBACK;

  // If knowledge agent is active, route to it
  if (hasAgent && agentKey && agentName) {
    return {
      type: "knowledge",
      model: "jalza",
      label: agentName,
      icon: "📚",
      agentKey,
      agentName,
    };
  }

  // LLM-based classification (Gemini → Ollama fallback)
  try {
    const res = await fetch("/api/classify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.route === "search" && features.webSearch) {
        return {
          type: "search",
          model: "gemini-2.0-flash",
          label: "Web Search",
          icon: "🔍",
        };
      }
      if (data.route === "email" && features.emailAccess) {
        return { type: "email", model: "jalza", label: "Email", icon: "📧" };
      }
    }
  } catch {
    // fallback to chat
  }

  return FALLBACK;
}
