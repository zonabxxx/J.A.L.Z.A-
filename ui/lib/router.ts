import { getFeatures } from "./features";

export type RouteType = "text" | "search" | "email" | "knowledge" | "image" | "calendar" | "research" | "agent" | "multi" | "business" | "business_action";

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
          model: "gemini-2.5-flash",
          label: "Web Search",
          icon: "🔍",
        };
      }
      if (data.route === "email" && features.emailAccess) {
        return { type: "email", model: "jalza", label: "Email", icon: "📧" };
      }
      if (data.route === "image") {
        return { type: "image", model: "gemini-image", label: "Obrázok", icon: "🎨" };
      }
      if (data.route === "calendar") {
        return { type: "calendar", model: "gemini-2.5-flash", label: "Kalendár", icon: "📅" };
      }
      if (data.route === "research") {
        return { type: "research", model: "gemini-2.5-flash", label: "Research", icon: "🔬" };
      }
      if (data.route === "agent") {
        return { type: "agent", model: "jalza", label: "Agent", icon: "🤖" };
      }
      if (data.route === "multi") {
        return { type: "multi", model: "jalza", label: "Multi-Agent", icon: "🔗" };
      }
      if (data.route === "business_action") {
        return { type: "business_action", model: "gemini-2.5-flash", label: "Business Agent", icon: "🏗️" };
      }
      if (data.route === "business") {
        return { type: "business", model: "gemini-2.5-flash", label: "Business", icon: "🏢" };
      }
    }
  } catch {
    // fallback to chat
  }

  return FALLBACK;
}
