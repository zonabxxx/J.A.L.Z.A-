import { getFeatures } from "./features";

const MAIL_WORDS = [
  "mail", "email", "e-mail", "maily", "emaily", "mailbox", "dorucen",
  "posli", "posli mail", "odosli", "schrank", "inbox",
  "spam", "cleanup", "vymaz", "precitaj", "odpoved",
  "adsun.sk", "juraj@", "info@",
  "adresu.sk", "adresu sk", "poslat mail", "poslať mail",
  "potvrd", "potvrdzujem",
];

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

  const lower = text.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

  if (features.emailAccess && MAIL_WORDS.some((w) => lower.includes(w))) {
    return { type: "email", model: "jalza", label: "Email", icon: "📧" };
  }

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

  if (features.webSearch) {
    try {
      const res = await fetch("/api/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.route === "search") {
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
      // fallback to chat on classify error
    }
  }

  return FALLBACK;
}
