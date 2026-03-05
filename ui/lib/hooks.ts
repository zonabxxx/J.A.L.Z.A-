"use client";
import { useState, useCallback, useRef, useEffect } from "react";
import type { Message, Agent } from "./types";
import { detectRoute, type RouteResult } from "./router";
import { getLocation } from "./location";
import {
  saveConversation,
  getConversation,
  type StoredMessage,
} from "./chat-storage";

export interface ChatMessage extends Message {
  route?: RouteResult;
}

export function useChat(activeAgent: Agent | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentRoute, setCurrentRoute] = useState<RouteResult | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const debouncedSave = useCallback(
    (msgs: ChatMessage[], convId: string | null) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(async () => {
        if (msgs.length === 0) return;
        const stored: StoredMessage[] = msgs.map((m) => ({
          role: m.role,
          content: m.content,
          route: m.route,
        }));
        const id = await saveConversation(
          convId,
          stored,
          activeAgent?.key || null,
          activeAgent?.name || null
        );
        setConversationId(id);
      }, 500);
    },
    [activeAgent]
  );

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  const streamResponse = async (
    url: string,
    body: Record<string, unknown>,
    route: RouteResult,
    updatedMessages: ChatMessage[],
    convId: string | null
  ) => {
    const assistantMsg: ChatMessage = { role: "assistant", content: "", route };
    setMessages([...updatedMessages, assistantMsg]);

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok || !res.body) throw new Error("Request failed");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const payload = line.slice(6);
          if (payload === "[DONE]") continue;
          try {
            const data = JSON.parse(payload);
            if (data.content) {
              fullContent += data.content;
              setMessages((prev) => {
                const copy = [...prev];
                copy[copy.length - 1] = {
                  role: "assistant",
                  content: fullContent,
                  route,
                };
                return copy;
              });
            }
          } catch {
            // skip
          }
        }
      }
    }

    const finalMessages: ChatMessage[] = [
      ...updatedMessages,
      { role: "assistant", content: fullContent, route },
    ];
    setMessages(finalMessages);
    debouncedSave(finalMessages, convId);
  };

  const sendMessage = useCallback(
    async (content: string) => {
      const userMsg: ChatMessage = { role: "user", content };
      const updated = [...messages, userMsg];
      setMessages(updated);
      setIsStreaming(true);

      const route = await detectRoute(
        content,
        !!activeAgent,
        activeAgent?.key,
        activeAgent?.name
      );
      setCurrentRoute(route);

      try {
        let plainMessages = updated.map(({ role, content: c }) => ({
          role,
          content: c,
        }));

        if (route.type === "search") {
          const loc = await getLocation();
          const now = new Date();
          const dateStr = now.toLocaleDateString("sk-SK", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          });
          const timeStr = now.toLocaleTimeString("sk-SK", {
            hour: "2-digit",
            minute: "2-digit",
          });

          let context = `[Dátum: ${dateStr}, Čas: ${timeStr}]`;
          if (loc) {
            context += ` [Poloha používateľa: ${loc.city}, ${loc.country}]`;
          }

          const lastIdx = plainMessages.length - 1;
          const lastMsg = plainMessages[lastIdx];
          plainMessages[lastIdx] = {
            ...lastMsg,
            content: `${context}\n\n${lastMsg.content}`,
          };
          await streamResponse("/api/search", { messages: plainMessages }, route, updated, conversationId);
        } else if (route.type === "knowledge" && route.agentKey) {
          await streamResponse(
            "/api/chat",
            {
              messages: plainMessages,
              agent: { key: route.agentKey, name: route.agentName },
            },
            route,
            updated,
            conversationId
          );
        } else {
          await streamResponse("/api/chat", { messages: plainMessages }, route, updated, conversationId);
        }
      } catch (err) {
        const errorMessages: ChatMessage[] = [
          ...updated,
          {
            role: "assistant",
            content: `Chyba: ${err instanceof Error ? err.message : "Unknown"}`,
            route,
          },
        ];
        setMessages(errorMessages);
        debouncedSave(errorMessages, conversationId);
      } finally {
        setIsStreaming(false);
      }
    },
    [messages, activeAgent, conversationId, debouncedSave]
  );

  const sendVisionMessage = useCallback(
    async (content: string, imageBase64: string) => {
      const route: RouteResult = {
        type: "text",
        model: "qwen2.5vl:3b",
        label: "Vision",
        icon: "👁",
      };
      setCurrentRoute(route);

      const displayContent = content || "Analyzuj tento obrázok";
      const userMsg: ChatMessage = {
        role: "user",
        content: `📷 ${displayContent}`,
        route,
      };
      const updated = [...messages, userMsg];
      setMessages(updated);
      setIsStreaming(true);

      try {
        await streamResponse(
          "/api/vision",
          { prompt: content, images: [imageBase64] },
          route,
          updated,
          conversationId
        );
      } catch (err) {
        const errorMessages: ChatMessage[] = [
          ...updated,
          {
            role: "assistant",
            content: `Chyba: ${err instanceof Error ? err.message : "Unknown"}`,
            route,
          },
        ];
        setMessages(errorMessages);
        debouncedSave(errorMessages, conversationId);
      } finally {
        setIsStreaming(false);
      }
    },
    [messages, conversationId, debouncedSave]
  );

  const clearChat = useCallback(() => {
    setMessages([]);
    setCurrentRoute(null);
    setConversationId(null);
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    const convo = await getConversation(id);
    if (convo) {
      setMessages(
        convo.messages.map((m) => ({
          role: m.role,
          content: m.content,
          route: m.route,
        }))
      );
      setConversationId(convo.id);
      setCurrentRoute(null);
    }
  }, []);

  return {
    messages,
    isStreaming,
    sendMessage,
    sendVisionMessage,
    clearChat,
    currentRoute,
    conversationId,
    loadConversation,
  };
}
