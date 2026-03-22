"use client";
import { useRef, useEffect, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import type { Agent } from "@/lib/types";
import type { ChatMessage } from "@/lib/hooks";
import type { RouteResult } from "@/lib/router";
import { getFeatures } from "@/lib/features";
import { AVAILABLE_MODELS, type ModelOption } from "@/lib/config";
import VoiceButton from "./voice-button";
import SpeakButton from "./speak-button";
import EmailCards from "./email-cards";
import CalendarCards from "./calendar-cards";
import CalendarConfirmCard from "./calendar-confirm-card";
import type { PendingCalendarEvent } from "@/lib/hooks";

const SUGGESTED_PROMPTS = [
  { icon: "📧", text: "Ukáž mi nové emaily", category: "email" },
  { icon: "📅", text: "Čo mám dnes v kalendári?", category: "calendar" },
  { icon: "🔍", text: "Vyhľadaj na webe", category: "search" },
  { icon: "📊", text: "Aké sú dnešné správy z biznisu?", category: "business" },
  { icon: "🏢", text: "Adsun maily", category: "email" },
  { icon: "📝", text: "Napíš email", category: "email" },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);
  return (
    <button
      onClick={handleCopy}
      className="opacity-0 group-hover:opacity-100 transition-all duration-200 text-zinc-500 hover:text-zinc-300 p-1 rounded-md hover:bg-zinc-700/50"
      title="Kopírovať"
    >
      {copied ? (
        <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
        </svg>
      )}
    </button>
  );
}

function CodeBlock({ children, className }: { children: React.ReactNode; className?: string }) {
  const [copied, setCopied] = useState(false);
  const isBlock = className?.includes("language-");
  const lang = className?.replace("language-", "") || "";
  const code = String(children).replace(/\n$/, "");

  if (!isBlock) {
    return <code className="bg-zinc-700/60 px-1.5 py-0.5 rounded text-xs font-mono text-emerald-400">{children}</code>;
  }

  return (
    <div className="relative group/code my-2">
      <div className="flex items-center justify-between bg-zinc-950 rounded-t-lg px-3 py-1.5 border border-zinc-700/50 border-b-0">
        <span className="text-[10px] text-zinc-500 font-mono uppercase">{lang || "code"}</span>
        <button
          onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1"
        >
          {copied ? (
            <><svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg> Skopírované</>
          ) : (
            <><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" /></svg> Kopírovať</>
          )}
        </button>
      </div>
      <code className="block bg-zinc-950 rounded-b-lg px-3 py-2.5 text-xs font-mono overflow-x-auto text-emerald-400 border border-zinc-700/50 border-t-0">{children}</code>
    </div>
  );
}

interface Props {
  messages: ChatMessage[];
  isStreaming: boolean;
  onSend: (content: string) => void;
  onSendVision?: (content: string, imageBase64: string) => void;
  onClear: () => void;
  activeAgent: Agent | null;
  currentRoute: RouteResult | null;
  onMenuToggle?: () => void;
  selectedModel: ModelOption;
  onModelChange: (model: ModelOption) => void;
  onReadEmail?: (emailId: string, mailbox: string) => void;
  onStop?: () => void;
  onConfirmCalendar?: (event: PendingCalendarEvent) => void;
  onCancelCalendar?: () => void;
}

function formatEmailBody(text: string): string {
  let cleaned = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  // Insert line breaks before common email markers that got concatenated
  cleaned = cleaned
    .replace(/(S pozdravom|Best regards|Kind regards|Regards|Ďakujem|Dakujem|Thanks),?\s*/gi, "\n\n$1,\n")
    .replace(/(Od:|From:|Odoslané:|Sent:|Dátum:|Date:|Komu:|To:|Predmet:|Subject:|Cc:)\s*/gi, "\n$1 ")
    .replace(/(\S)(Od:\s)/g, "$1\n\n$2")
    .replace(/(\S)(From:\s)/g, "$1\n\n$2")
    .replace(/(_{3,}|-{3,}|={3,})/g, "\n$1\n");

  // Collapse 3+ consecutive newlines to 2
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");

  return cleaned.trim();
}

function RouteBadge({ route }: { route: RouteResult }) {
  const colors: Record<string, string> = {
    text: "bg-purple-600/20 text-purple-400",
    search: "bg-emerald-600/20 text-emerald-400",
    knowledge: "bg-amber-600/20 text-amber-400",
    email: "bg-blue-600/20 text-blue-400",
    image: "bg-pink-600/20 text-pink-400",
    calendar: "bg-teal-600/20 text-teal-400",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full ${colors[route.type] || "bg-zinc-700 text-zinc-400"}`}
    >
      {route.icon} {route.label} · {route.model}
    </span>
  );
}

export default function Chat({
  messages,
  isStreaming,
  onSend,
  onSendVision,
  onClear,
  activeAgent,
  currentRoute,
  onMenuToggle,
  selectedModel,
  onModelChange,
  onReadEmail,
  onStop,
  onConfirmCalendar,
  onCancelCalendar,
}: Props) {
  const [input, setInput] = useState("");
  const [interimText, setInterimText] = useState("");
  const [features, setFeatures] = useState(getFeatures());
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [isAutocorrecting, setIsAutocorrecting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const sync = () => setFeatures(getFeatures());
    window.addEventListener("storage", sync);
    const interval = setInterval(sync, 2000);
    return () => {
      window.removeEventListener("storage", sync);
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, [activeAgent]);

  const autocorrect = async (text: string): Promise<string> => {
    try {
      setIsAutocorrecting(true);
      const res = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: text,
          systemPrompt: "Oprav preklepy a gramatiku v nasledujúcom texte. Zachovaj pôvodný význam, jazyk a štýl. Vráť IBA opravený text, nič iné. Ak je text správny, vráť ho bez zmeny. Nemeň slová, iba oprav zjavné preklepy.",
        }),
      });
      const data = await res.json();
      return data.text || text;
    } catch {
      return text;
    } finally {
      setIsAutocorrecting(false);
    }
  };

  const handleSubmit = async () => {
    if (isStreaming || isAutocorrecting) return;
    if (imageBase64 && onSendVision) {
      onSendVision(input.trim(), imageBase64);
      setInput("");
      setImagePreview(null);
      setImageBase64(null);
      return;
    }
    const trimmed = input.trim();
    if (!trimmed) return;

    const corrected = features.autocorrect ? await autocorrect(trimmed) : trimmed;

    if (editingIdx !== null) {
      onSend(corrected);
      setEditingIdx(null);
    } else {
      onSend(corrected);
    }
    setInput("");
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setImagePreview(result);
      setImageBase64(result);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex-1 flex flex-col h-[100dvh] md:h-full overflow-hidden">
      <header className="flex items-center justify-between px-4 md:px-6 py-3 border-b bg-zinc-900/50 safe-top">
        <div className="flex items-center gap-3">
          {/* Hamburger for mobile */}
          {onMenuToggle && (
            <button
              onClick={onMenuToggle}
              className="md:hidden w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-800 text-zinc-400"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </button>
          )}
          <div>
            <h2 className="font-semibold text-sm md:text-base">
              {activeAgent ? activeAgent.name : "J.A.L.Z.A."}
            </h2>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-[10px] md:text-xs text-zinc-500 hidden sm:block">
                {activeAgent
                  ? `Znalostný agent · ${activeAgent.sources} zdrojov`
                  : "Automatický routing podľa kontextu"}
              </p>
              {currentRoute && <RouteBadge route={currentRoute} />}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setShowModelPicker(!showModelPicker)}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors border border-zinc-700"
            >
              <span>{selectedModel.icon}</span>
              <span className="hidden sm:inline">{selectedModel.name}</span>
              <svg className="w-3 h-3 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
            {showModelPicker && (
              <div className="absolute right-0 top-full mt-1 w-64 bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl z-50 overflow-hidden">
                {AVAILABLE_MODELS.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => { onModelChange(m); setShowModelPicker(false); }}
                    className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors ${
                      selectedModel.id === m.id
                        ? "bg-blue-600/20 text-blue-400"
                        : "hover:bg-zinc-800 text-zinc-300"
                    }`}
                  >
                    <span className="text-lg">{m.icon}</span>
                    <div>
                      <div className="text-sm font-medium">{m.name}</div>
                      <div className="text-[10px] text-zinc-500">{m.description}</div>
                    </div>
                    {selectedModel.id === m.id && (
                      <span className="ml-auto text-blue-400 text-sm">✓</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={onClear}
            className="text-xs text-zinc-500 hover:text-zinc-300 px-2 md:px-3 py-1.5 rounded hover:bg-zinc-800 transition-colors"
          >
            Nový chat
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-zinc-600 animate-fade-in">
            <div className="text-center max-w-lg px-4">
              <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-gradient-to-br from-blue-600/20 to-purple-600/20 border border-zinc-700/50 flex items-center justify-center">
                <span className="text-3xl">J</span>
              </div>
              <p className="text-lg md:text-xl font-semibold text-zinc-200">
                {activeAgent
                  ? activeAgent.name
                  : "Ahoj, Juraj"}
              </p>
              <p className="text-sm mt-1.5 text-zinc-500">
                {activeAgent
                  ? `${activeAgent.sources} zdrojov v znalostnej databáze`
                  : "Ako ti dnes pomozem?"}
              </p>

              <div className="grid grid-cols-2 gap-2 mt-6">
                {SUGGESTED_PROMPTS.map((prompt, idx) => (
                  <button
                    key={idx}
                    onClick={() => onSend(prompt.text)}
                    className="text-left px-3 py-2.5 rounded-xl border border-zinc-700/50 bg-zinc-800/30 hover:bg-zinc-800 hover:border-zinc-600 transition-all duration-200 group/prompt"
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-base mt-0.5 shrink-0">{prompt.icon}</span>
                      <span className="text-xs text-zinc-400 group-hover/prompt:text-zinc-200 transition-colors leading-relaxed">{prompt.text}</span>
                    </div>
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap justify-center gap-1.5 mt-5">
                {[
                  { label: "jalza", color: "purple" },
                  { label: "Gemini Flash", color: "cyan" },
                  { label: "Web Search", color: "emerald" },
                  { label: "Email", color: "blue" },
                  { label: "Kalendar", color: "teal" },
                  { label: "RAG", color: "amber" },
                ].map((tag) => (
                  <span key={tag.label} className={`text-[10px] px-2 py-0.5 rounded-full bg-${tag.color}-600/10 text-${tag.color}-400`}>
                    {tag.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex animate-msg-in ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            style={{ animationDelay: `${Math.min(i * 30, 200)}ms` }}
          >
            <div className={`max-w-[85%] md:max-w-[75%] ${msg.role === "user" ? "" : "space-y-1"}`}>
              {msg.role === "assistant" && msg.route && (
                <div className="flex items-center gap-1.5">
                  <RouteBadge route={msg.route} />
                  {msg.content && features.voiceOutput && <SpeakButton text={msg.content} />}
                </div>
              )}
              {msg.pendingCalendarEvent ? (
                <div className="space-y-2">
                  {msg.content && (
                    <div className="rounded-2xl px-3.5 md:px-4 py-2.5 text-sm leading-relaxed bg-zinc-800 text-zinc-200">
                      {msg.content}
                    </div>
                  )}
                  <CalendarConfirmCard
                    event={msg.pendingCalendarEvent}
                    onConfirm={(ev) => onConfirmCalendar?.(ev)}
                    onCancel={() => onCancelCalendar?.()}
                    disabled={isStreaming}
                  />
                </div>
              ) : msg.calendarEvents && msg.calendarEvents.length > 0 ? (
                <div className="rounded-2xl px-3 md:px-4 py-3 bg-zinc-800/50 text-zinc-200 border border-zinc-700/50 space-y-2">
                  {msg.content && (
                    <div className="text-xs text-zinc-400 font-medium">{msg.content}</div>
                  )}
                  <CalendarCards events={msg.calendarEvents} />
                </div>
              ) : msg.generatedImage ? (
                <div className="rounded-2xl overflow-hidden bg-zinc-800/50 border border-zinc-700/50">
                  <img
                    src={msg.generatedImage}
                    alt={msg.content || "Generated image"}
                    className="w-full max-w-md rounded-t-2xl"
                  />
                  {msg.content && (
                    <div className="px-3 py-2 text-sm text-zinc-300">
                      {msg.content}
                    </div>
                  )}
                  <div className="px-3 pb-2 flex gap-2">
                    <a
                      href={msg.generatedImage}
                      download="jalza-image.png"
                      className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      Stiahnuť
                    </a>
                  </div>
                </div>
              ) : msg.emails && msg.emails.length > 0 ? (
                <div className="rounded-2xl px-3 md:px-4 py-3 bg-zinc-800/50 text-zinc-200 border border-zinc-700/50 space-y-3">
                  {msg.content && (
                    <div className="text-xs text-zinc-400 font-medium">{msg.content.length > 200 ? "" : msg.content}</div>
                  )}
                  <EmailCards
                    emails={msg.emails}
                    mailbox={msg.mailbox}
                    todayFilter={msg.todayFilter}
                    onMailboxChange={() => {}}
                    onReadEmail={(idx) => {
                      const email = msg.emails![idx - 1];
                      if (email?.id && msg.mailbox && onReadEmail) {
                        onReadEmail(email.id, msg.mailbox);
                      }
                    }}
                  />
                  {msg.content && msg.content.length > 200 && (
                    <div className="mt-3 pt-3 border-t border-zinc-700/50 text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto break-words overflow-wrap-anywhere">
                      {formatEmailBody(msg.content)}
                    </div>
                  )}
                </div>
              ) : (
                <div className="group relative">
                  <div
                    className={`rounded-2xl px-3.5 md:px-4 py-2.5 text-sm leading-relaxed ${
                      msg.role === "user"
                        ? "bg-blue-600 text-white whitespace-pre-wrap"
                        : "bg-zinc-800/80 text-zinc-200 border border-zinc-700/30"
                    }`}
                  >
                    {!msg.content ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="inline-flex items-center gap-1">
                          <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse-dot" />
                          <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse-dot [animation-delay:0.15s]" />
                          <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse-dot [animation-delay:0.3s]" />
                        </span>
                        <span className="text-xs text-zinc-400">
                          {msg.route?.type === "email" ? "📧 Načítavam emaily…"
                            : msg.route?.type === "calendar" ? "📅 Kontrolujem kalendár…"
                            : msg.route?.type === "search" ? "🔍 Hľadám na webe…"
                            : msg.route?.type === "business" ? "🏢 Načítavam business dáta…"
                            : msg.route?.type === "business_action" ? "🏗️ Spracovávam požiadavku…"
                            : msg.route?.type === "image" ? "🎨 Generujem obrázok…"
                            : msg.route?.type === "research" ? "🔬 Robím research…"
                            : "Premýšľam…"}
                        </span>
                      </span>
                    ) : msg.role === "user" ? (
                      msg.content
                    ) : (
                      <ReactMarkdown
                        components={{
                          a: ({ href, children }) => (
                            <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline underline-offset-2 decoration-blue-400/30 hover:decoration-blue-300 break-all transition-colors">
                              {children}
                            </a>
                          ),
                          p: ({ children }) => <p className="mb-2.5 last:mb-0 leading-relaxed">{children}</p>,
                          ul: ({ children }) => <ul className="list-disc pl-4 mb-2.5 space-y-1.5">{children}</ul>,
                          ol: ({ children }) => <ol className="list-decimal pl-4 mb-2.5 space-y-1.5">{children}</ol>,
                          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                          strong: ({ children }) => <strong className="font-semibold text-zinc-50">{children}</strong>,
                          em: ({ children }) => <em className="italic text-zinc-300">{children}</em>,
                          code: ({ children, className: cn }) => <CodeBlock className={cn}>{children}</CodeBlock>,
                          pre: ({ children }) => <>{children}</>,
                          h1: ({ children }) => <h1 className="text-base font-bold mb-2 mt-3 first:mt-0 text-zinc-50 border-b border-zinc-700/50 pb-1">{children}</h1>,
                          h2: ({ children }) => <h2 className="text-sm font-bold mb-1.5 mt-2.5 first:mt-0 text-zinc-100">{children}</h2>,
                          h3: ({ children }) => <h3 className="text-sm font-semibold mb-1 mt-2 first:mt-0 text-zinc-200">{children}</h3>,
                          blockquote: ({ children }) => <blockquote className="border-l-2 border-blue-500/40 pl-3 my-2 text-zinc-400 italic">{children}</blockquote>,
                          hr: () => <hr className="border-zinc-700/50 my-3" />,
                          table: ({ children }) => <div className="overflow-x-auto my-2"><table className="min-w-full text-xs border border-zinc-700/50 rounded-lg overflow-hidden">{children}</table></div>,
                          thead: ({ children }) => <thead className="bg-zinc-800/80">{children}</thead>,
                          th: ({ children }) => <th className="px-3 py-1.5 text-left font-semibold text-zinc-300 border-b border-zinc-700/50">{children}</th>,
                          td: ({ children }) => <td className="px-3 py-1.5 border-b border-zinc-800/50 text-zinc-400">{children}</td>,
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    )}
                  </div>
                  {msg.role === "assistant" && msg.content && !isStreaming && (
                    <div className="absolute -bottom-1 -right-1 flex items-center gap-0.5">
                      <CopyButton text={msg.content} />
                    </div>
                  )}
                  {msg.role === "user" && !isStreaming && (
                    <button
                      onClick={() => {
                        setInput(msg.content);
                        setEditingIdx(i);
                        inputRef.current?.focus();
                      }}
                      className="absolute -bottom-1 -left-1 opacity-0 group-hover:opacity-100 transition-all duration-200 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-full p-1"
                      title="Upraviť prompt"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
                      </svg>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="px-3 md:px-6 pb-safe pt-2 sticky bottom-0 bg-zinc-900 z-20 border-t border-zinc-800/60">
        {/* Image preview */}
        {imagePreview && (
          <div className="mb-2 relative inline-block">
            <img
              src={imagePreview}
              alt="Preview"
              className="h-20 rounded-lg border border-zinc-700"
            />
            <button
              onClick={() => {
                setImagePreview(null);
                setImageBase64(null);
              }}
              className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-zinc-800 border border-zinc-600 rounded-full flex items-center justify-center text-[10px] text-zinc-400 hover:text-red-400"
            >
              ✕
            </button>
          </div>
        )}
        {editingIdx !== null && (
          <div className="flex items-center gap-2 mb-1 px-1">
            <span className="text-[10px] text-amber-400">✏️ Upravuješ prompt</span>
            <button
              onClick={() => { setEditingIdx(null); setInput(""); }}
              className="text-[10px] text-zinc-500 hover:text-zinc-300"
            >
              Zrušiť
            </button>
          </div>
        )}
        {isAutocorrecting && (
          <div className="flex items-center gap-2 mb-1 px-1">
            <span className="text-[10px] text-blue-400 animate-pulse">✏️ Opravujem preklepy…</span>
          </div>
        )}
        <div className="flex items-end gap-2 bg-zinc-800/50 border border-zinc-700/50 rounded-2xl px-3 md:px-4 py-2 focus-within:border-zinc-600 focus-within:bg-zinc-800/80 transition-all duration-200">
          {/* Image upload */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageSelect}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isStreaming}
            className="text-zinc-500 hover:text-zinc-300 disabled:opacity-30 p-1 transition-colors flex-shrink-0"
            title="Pridať obrázok"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
            </svg>
          </button>
          {features.voiceInput && (
            <VoiceButton
              onTranscript={(text) => {
                setInterimText("");
                setInput((prev) => (prev ? prev + " " + text : text));
              }}
              onInterim={(text) => setInterimText(text)}
              disabled={isStreaming}
            />
          )}
          <div className="flex-1 relative">
            {interimText && (
              <div className="absolute bottom-full mb-2 left-0 right-0 bg-zinc-800/95 backdrop-blur border border-red-500/30 rounded-lg px-3 py-2 text-sm text-zinc-200 shadow-lg z-30">
                <span className="text-red-400 mr-1.5 animate-pulse">●</span>
                {interimText}
              </div>
            )}
            <textarea
              ref={inputRef}
              value={interimText || input}
              onChange={(e) => { if (!interimText) setInput(e.target.value); }}
              onKeyDown={handleKeyDown}
              placeholder={
                activeAgent
                  ? `Opýtaj sa na ${activeAgent.name}...`
                  : "Napíš správu..."
              }
              rows={1}
              className={`w-full bg-transparent outline-none resize-none text-base md:text-sm py-2 md:py-1.5 max-h-40 md:max-h-32 ${interimText ? "text-red-300/80 italic" : ""}`}
              readOnly={!!interimText}
            />
          </div>
          {isStreaming ? (
            <button
              onClick={onStop}
              className="bg-red-600 hover:bg-red-700 text-white p-2 rounded-xl transition-colors flex-shrink-0"
              title="Zastaviť"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={isAutocorrecting || !input.trim()}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-30 text-white p-2 rounded-xl transition-colors flex-shrink-0"
            >
              {isAutocorrecting ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
