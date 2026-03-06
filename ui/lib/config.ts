export const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
export const KNOWLEDGE_API_URL = process.env.KNOWLEDGE_API_URL || "http://localhost:8765";
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
export const GEMINI_FLASH = "gemini-2.0-flash";
export const GEMINI_FLASH_25 = "gemini-2.5-flash";
export const GEMINI_PRO = "gemini-2.5-pro";
export const GEMINI_MODEL = GEMINI_FLASH;
export const DEFAULT_MODEL = "jalza";
export const VISION_MODEL = "qwen2.5vl:3b";
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
  { id: "gemini-flash", name: "Gemini 2.5 Flash", provider: "gemini", model: GEMINI_FLASH_25, description: "Rýchly + thinking", icon: "⚡" },
  { id: "gemini-pro", name: "Gemini 2.5 Pro", provider: "gemini", model: GEMINI_PRO, description: "Najsilnejší reasoning", icon: "💎" },
];
