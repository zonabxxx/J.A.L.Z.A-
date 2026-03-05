"use client";

import type { RouteResult } from "./router";

export interface StoredMessage {
  role: "user" | "assistant" | "system";
  content: string;
  route?: RouteResult;
}

export interface Conversation {
  id: string;
  title: string;
  agentKey: string | null;
  agentName: string | null;
  messages: StoredMessage[];
  createdAt: string;
  updatedAt: string;
}

interface ConversationListItem {
  id: string;
  title: string;
  agent_key: string | null;
  agent_name: string | null;
  created_at: string;
  updated_at: string;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function extractTitle(messages: StoredMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return "Nová konverzácia";
  const text = firstUser.content.trim();
  return text.length > 60 ? text.slice(0, 60) + "…" : text;
}

export async function loadConversations(): Promise<Conversation[]> {
  try {
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list", limit: 100 }),
    });
    if (res.status === 401) return [];
    const data = await res.json();
    const items: ConversationListItem[] = data.conversations || [];
    return items.map((c) => ({
      id: c.id,
      title: c.title,
      agentKey: c.agent_key,
      agentName: c.agent_name,
      messages: [],
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    }));
  } catch {
    return [];
  }
}

export async function saveConversation(
  id: string | null,
  messages: StoredMessage[],
  agentKey: string | null,
  agentName: string | null
): Promise<string> {
  if (messages.length === 0) return id || "";
  const convId = id || generateId();
  const now = new Date().toISOString();
  const title = extractTitle(messages);

  try {
    await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save",
        id: convId,
        title,
        agent_key: agentKey,
        agent_name: agentName,
        messages,
        updated_at: now,
      }),
    });
  } catch {
    // silent fail
  }

  return convId;
}

export async function deleteConversation(id: string): Promise<void> {
  try {
    await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id }),
    });
  } catch {
    // ignore
  }
}

export async function getConversation(id: string): Promise<Conversation | null> {
  try {
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "get", id }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.error) return null;
    return {
      id: data.id,
      title: data.title,
      agentKey: data.agent_key,
      agentName: data.agent_name,
      messages: data.messages || [],
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  } catch {
    return null;
  }
}
