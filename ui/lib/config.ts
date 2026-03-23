export const KNOWLEDGE_API_URL = process.env.KNOWLEDGE_API_URL || "http://localhost:8765";
export const KNOWLEDGE_API_FALLBACK = process.env.KNOWLEDGE_API_FALLBACK || "";
export const DEFAULT_MODEL = "jalza";
export const JALZA_API_TOKEN = process.env.JALZA_API_TOKEN || "";
export const SESSION_SECRET = process.env.JALZA_SESSION_SECRET || "fallback-change-me";

export interface ModelOption {
  id: string;
  name: string;
  provider: "ollama" | "gemini";
  model: string;
  description: string;
  icon: string;
}

export const AVAILABLE_MODELS: ModelOption[] = [
  { id: "jalza", name: "J.A.L.Z.A.", provider: "ollama", model: "jalza", description: "Lokálny · qwen2.5:72b", icon: "🧠" },
  { id: "gemini-flash", name: "Gemini 2.5 Flash", provider: "gemini", model: "gemini-2.5-flash", description: "Rýchly + thinking", icon: "⚡" },
  { id: "gemini-pro", name: "Gemini 2.5 Pro", provider: "gemini", model: "gemini-2.5-pro", description: "Najsilnejší reasoning", icon: "💎" },
];
