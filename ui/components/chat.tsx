"use client";
import { useRef, useEffect, useState } from "react";
import type { Agent } from "@/lib/types";
import type { ChatMessage } from "@/lib/hooks";
import type { RouteResult } from "@/lib/router";
import { getFeatures } from "@/lib/features";
import { AVAILABLE_MODELS, type ModelOption } from "@/lib/config";
import VoiceButton from "./voice-button";
import SpeakButton from "./speak-button";
import EmailCards from "./email-cards";

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
}

function RouteBadge({ route }: { route: RouteResult }) {
  const colors: Record<string, string> = {
    text: "bg-purple-600/20 text-purple-400",
    search: "bg-emerald-600/20 text-emerald-400",
    knowledge: "bg-amber-600/20 text-amber-400",
    email: "bg-blue-600/20 text-blue-400",
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
}: Props) {
  const [input, setInput] = useState("");
  const [interimText, setInterimText] = useState("");
  const [features, setFeatures] = useState(getFeatures());
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [showModelPicker, setShowModelPicker] = useState(false);
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
    inputRef.current?.focus();
  }, [activeAgent]);

  const handleSubmit = () => {
    if (isStreaming) return;
    if (imageBase64 && onSendVision) {
      onSendVision(input.trim(), imageBase64);
      setInput("");
      setImagePreview(null);
      setImageBase64(null);
      return;
    }
    const trimmed = input.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setInput("");
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setImagePreview(result);
      const base64 = result.split(",")[1];
      setImageBase64(base64);
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
    <div className="flex-1 flex flex-col h-full">
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
          <div className="flex items-center justify-center h-full text-zinc-600">
            <div className="text-center max-w-md px-4">
              <div className="text-4xl mb-4">🤖</div>
              <p className="text-base md:text-lg font-medium">
                {activeAgent
                  ? `Opýtaj sa na ${activeAgent.name}`
                  : "Ahoj, som J.A.L.Z.A."}
              </p>
              <p className="text-xs md:text-sm mt-2 text-zinc-500">
                Model sa prepína automaticky podľa kontextu:
              </p>
              <div className="flex flex-wrap justify-center gap-1.5 md:gap-2 mt-3">
                <span className="text-[10px] md:text-[11px] px-2 py-1 rounded-full bg-purple-600/10 text-purple-400">
                  🧠 jalza — lokálny
                </span>
                <span className="text-[10px] md:text-[11px] px-2 py-1 rounded-full bg-cyan-600/10 text-cyan-400">
                  ⚡ Gemini Flash — rýchly
                </span>
                <span className="text-[10px] md:text-[11px] px-2 py-1 rounded-full bg-violet-600/10 text-violet-400">
                  💎 Gemini Pro — premium
                </span>
                <span className="text-[10px] md:text-[11px] px-2 py-1 rounded-full bg-emerald-600/10 text-emerald-400">
                  🔍 Web Search
                </span>
                <span className="text-[10px] md:text-[11px] px-2 py-1 rounded-full bg-amber-600/10 text-amber-400">
                  📚 RAG agenti
                </span>
                <span className="text-[10px] md:text-[11px] px-2 py-1 rounded-full bg-blue-600/10 text-blue-400">
                  📧 Email
                </span>
              </div>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div className={`max-w-[85%] md:max-w-[75%] ${msg.role === "user" ? "" : "space-y-1"}`}>
              {msg.role === "assistant" && msg.route && (
                <div className="flex items-center gap-1.5">
                  <RouteBadge route={msg.route} />
                  {msg.content && features.voiceOutput && <SpeakButton text={msg.content} />}
                </div>
              )}
              {msg.emails && msg.emails.length > 0 ? (
                <div className="rounded-2xl px-3 md:px-4 py-3 bg-zinc-800/50 text-zinc-200 border border-zinc-700/50 space-y-3">
                  {msg.content && (
                    <div className="text-xs text-zinc-400 font-medium">{msg.content.length > 200 ? "" : msg.content}</div>
                  )}
                  <EmailCards emails={msg.emails} mailbox={msg.mailbox} />
                  {msg.content && msg.content.length > 200 && (
                    <div className="mt-3 pt-3 border-t border-zinc-700/50 text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">
                      {msg.content}
                    </div>
                  )}
                </div>
              ) : (
                <div
                  className={`rounded-2xl px-3.5 md:px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-blue-600 text-white"
                      : "bg-zinc-800 text-zinc-200"
                  }`}
                >
                  {msg.content || (
                    <span className="inline-flex gap-1">
                      <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" />
                      <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce [animation-delay:0.1s]" />
                      <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce [animation-delay:0.2s]" />
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="px-3 md:px-6 pb-safe pt-2">
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
        <div className="flex items-end gap-2 bg-zinc-900 border rounded-2xl px-3 md:px-4 py-2">
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
              <div className="absolute -top-12 left-0 right-0 bg-zinc-800/95 backdrop-blur border border-red-500/30 rounded-lg px-3 py-2 text-sm text-zinc-200 shadow-lg z-10">
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
              className={`w-full bg-transparent outline-none resize-none text-sm py-1.5 max-h-32 ${interimText ? "text-red-300/80 italic" : ""}`}
              readOnly={!!interimText}
            />
          </div>
          <button
            onClick={handleSubmit}
            disabled={isStreaming || !input.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-30 text-white p-2 rounded-xl transition-colors flex-shrink-0"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 12h14M12 5l7 7-7 7"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
