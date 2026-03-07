"use client";
import { useEffect, useState, useCallback } from "react";
import type { Agent } from "@/lib/types";
import type { User } from "@/lib/auth";
import type { ServiceHealth } from "@/lib/use-health";
import {
  loadConversations,
  deleteConversation as deleteConvo,
  type Conversation,
} from "@/lib/chat-storage";

interface Props {
  user: User;
  activeAgent: Agent | null;
  onSelectAgent: (agent: Agent | null) => void;
  activeTab: string;
  onTabChange: (tab: string) => void;
  onOpenSettings: () => void;
  onNewChat: () => void;
  onLoadConversation: (id: string, agentKey: string | null) => void;
  activeConversationId: string | null;
  health: {
    services: ServiceHealth[];
    check: () => void;
    isOnline: (id: string) => boolean;
  };
}

export default function Sidebar({
  user,
  activeAgent,
  onSelectAgent,
  activeTab,
  onTabChange,
  onOpenSettings,
  onNewChat,
  onLoadConversation,
  activeConversationId,
  health,
}: Props) {
  const [agents, setAgents] = useState<Record<string, Agent>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [newAgent, setNewAgent] = useState({
    key: "",
    name: "",
    description: "",
    queries: "",
    priority_domains: "",
  });
  const [creating, setCreating] = useState(false);

  const refreshConversations = useCallback(async () => {
    const convos = await loadConversations();
    setConversations(convos);
  }, []);

  const loadAgents = async () => {
    try {
      const res = await fetch("/api/agents");
      const data = await res.json();
      const mapped: Record<string, Agent> = {};
      for (const [key, val] of Object.entries(data)) {
        const v = val as Agent;
        mapped[key] = { ...v, key };
      }
      setAgents(mapped);
    } catch {
      // silently fail
    }
  };

  useEffect(() => {
    loadAgents();
    refreshConversations();
  }, [refreshConversations]);

  useEffect(() => {
    if (activeTab === "chat") {
      const interval = setInterval(refreshConversations, 2000);
      return () => clearInterval(interval);
    }
  }, [activeTab, refreshConversations]);

  const handleCreate = async () => {
    if (!newAgent.key || !newAgent.name || !newAgent.queries) return;
    setCreating(true);
    try {
      await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          key: newAgent.key,
          name: newAgent.name,
          description: newAgent.description,
          queries: newAgent.queries.split("\n").filter((q) => q.trim()),
          priority_domains: newAgent.priority_domains
            .split("\n")
            .filter((d) => d.trim()),
        }),
      });
      setShowCreate(false);
      setNewAgent({
        key: "",
        name: "",
        description: "",
        queries: "",
        priority_domains: "",
      });
      loadAgents();
    } catch {
      // error
    } finally {
      setCreating(false);
    }
  };

  const handleLearn = async (key: string) => {
    await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "learn", agent: key }),
    });
    loadAgents();
  };

  const handleDeleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteConvo(id);
    refreshConversations();
    if (activeConversationId === id) {
      onNewChat();
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "teraz";
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d`;
    return date.toLocaleDateString("sk-SK", { day: "numeric", month: "short" });
  };

  const todayConvos = conversations.filter((c) => {
    const d = new Date(c.updatedAt);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  });
  const olderConvos = conversations.filter((c) => {
    const d = new Date(c.updatedAt);
    const now = new Date();
    return d.toDateString() !== now.toDateString();
  });

  return (
    <aside className="w-72 bg-zinc-900 border-r border-zinc-800 flex flex-col h-full">
      <div className="p-4 border-b border-zinc-800">
        <h1 className="text-xl font-bold tracking-tight">J.A.L.Z.A.</h1>
        <p className="text-xs text-zinc-500 mt-1">Lokálny AI asistent</p>
      </div>

      <nav className="border-b border-zinc-800 px-2 py-2">
        <div className="grid grid-cols-4 gap-1">
          {[
            { id: "dashboard", label: "Prehľad", icon: "📊" },
            { id: "chat", label: "Chat", icon: "💬" },
            { id: "email", label: "Email", icon: "📧" },
            { id: "calendar", label: "Kalendár", icon: "📅" },
            { id: "business", label: "Business", icon: "🏢" },
            { id: "integrations", label: "MCP", icon: "🔗" },
            { id: "usage", label: "Spotreba", icon: "📈" },
            { id: "tasks", label: "Úlohy", icon: "✅" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex flex-col items-center justify-center gap-0.5 rounded-lg py-1.5 text-[10px] font-medium transition-colors ${
                activeTab === tab.id
                  ? "text-blue-400 bg-blue-500/15 ring-1 ring-blue-500/30"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              <span className="text-base leading-none">{tab.icon}</span>
              <span className="leading-tight">{tab.label}</span>
            </button>
          ))}
        </div>
      </nav>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {activeTab === "chat" ? (
          <>
            {/* Agenti */}
            <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
              Agenti
            </div>

            <button
              onClick={() => onSelectAgent(null)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                !activeAgent
                  ? "bg-blue-600/20 text-blue-400 border border-blue-600/30"
                  : "hover:bg-zinc-800 text-zinc-300"
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    health.isOnline("ollama") ? "bg-green-500" : "bg-red-500"
                  }`}
                  title={health.isOnline("ollama") ? "Online" : "Offline"}
                />
                <span className="font-medium">J.A.L.Z.A. (všeobecný)</span>
              </div>
              <div className="text-xs text-zinc-500 mt-0.5 ml-4">
                jalza — hlavný model
              </div>
            </button>

            {Object.entries(agents).map(([key, agent]) => {
              const agentOnline = health.isOnline("ollama") && health.isOnline("knowledge_api");
              return (
                <div
                  key={key}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectAgent(agent)}
                  onKeyDown={(e) => e.key === "Enter" && onSelectAgent(agent)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer ${
                    activeAgent?.key === key
                      ? "bg-blue-600/20 text-blue-400 border border-blue-600/30"
                      : "hover:bg-zinc-800 text-zinc-300"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        agentOnline ? "bg-green-500" : "bg-red-500"
                      }`}
                      title={agentOnline ? "Online" : "Offline"}
                    />
                    <span className="font-medium">{agent.name}</span>
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5 ml-4">
                    {agent.sources} zdrojov · {agent.chunks} častí
                  </div>
                  <div className="flex gap-1.5 mt-1 ml-4">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleLearn(key);
                      }}
                      className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400"
                    >
                      Učiť sa
                    </button>
                  </div>
                </div>
              );
            })}

            {!showCreate ? (
              <button
                onClick={() => setShowCreate(true)}
                className="w-full text-left px-3 py-2 rounded-lg text-sm text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 border border-dashed border-zinc-700 transition-colors"
              >
                + Nový agent
              </button>
            ) : (
              <div className="border border-zinc-700 rounded-lg p-3 space-y-2">
                <input
                  placeholder="Kľúč (napr. pravo)"
                  value={newAgent.key}
                  onChange={(e) =>
                    setNewAgent({ ...newAgent, key: e.target.value })
                  }
                  className="w-full bg-zinc-800 rounded px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-500"
                />
                <input
                  placeholder="Názov (napr. Slovenské právo)"
                  value={newAgent.name}
                  onChange={(e) =>
                    setNewAgent({ ...newAgent, name: e.target.value })
                  }
                  className="w-full bg-zinc-800 rounded px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-500"
                />
                <input
                  placeholder="Popis"
                  value={newAgent.description}
                  onChange={(e) =>
                    setNewAgent({ ...newAgent, description: e.target.value })
                  }
                  className="w-full bg-zinc-800 rounded px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-500"
                />
                <textarea
                  placeholder="Vyhľadávacie frázy (1 na riadok)"
                  value={newAgent.queries}
                  onChange={(e) =>
                    setNewAgent({ ...newAgent, queries: e.target.value })
                  }
                  rows={3}
                  className="w-full bg-zinc-800 rounded px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                />
                <textarea
                  placeholder="Prioritné domény (1 na riadok, voliteľné)"
                  value={newAgent.priority_domains}
                  onChange={(e) =>
                    setNewAgent({
                      ...newAgent,
                      priority_domains: e.target.value,
                    })
                  }
                  rows={2}
                  className="w-full bg-zinc-800 rounded px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleCreate}
                    disabled={creating}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm py-1.5 rounded transition-colors"
                  >
                    {creating ? "Vytváranie..." : "Vytvoriť"}
                  </button>
                  <button
                    onClick={() => setShowCreate(false)}
                    className="px-3 bg-zinc-800 hover:bg-zinc-700 text-sm py-1.5 rounded transition-colors"
                  >
                    Zrušiť
                  </button>
                </div>
              </div>
            )}

            {/* História konverzácií */}
            {conversations.length > 0 && (
              <>
                <div className="pt-3 border-t border-zinc-800 mt-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                      Konverzácie
                    </div>
                    <button
                      onClick={onNewChat}
                      className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors"
                    >
                      + Nový
                    </button>
                  </div>

                  {todayConvos.length > 0 && (
                    <>
                      <div className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1 mt-2">
                        Dnes
                      </div>
                      {todayConvos.map((convo) => (
                        <button
                          key={convo.id}
                          onClick={() =>
                            onLoadConversation(convo.id, convo.agentKey)
                          }
                          className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors group mb-1 ${
                            activeConversationId === convo.id
                              ? "bg-zinc-800 text-zinc-200"
                              : "hover:bg-zinc-800/50 text-zinc-400"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs">
                              {convo.title}
                            </span>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <span className="text-[10px] text-zinc-600">
                                {formatDate(convo.updatedAt)}
                              </span>
                              <span
                                role="button"
                                tabIndex={0}
                                onClick={(e) =>
                                  handleDeleteConversation(convo.id, e)
                                }
                                onKeyDown={(e) =>
                                  e.key === "Enter" &&
                                  handleDeleteConversation(
                                    convo.id,
                                    e as unknown as React.MouseEvent
                                  )
                                }
                                className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-all"
                              >
                                ✕
                              </span>
                            </div>
                          </div>
                          {convo.agentName && (
                            <div className="text-[10px] text-zinc-600 mt-0.5">
                              {convo.agentName}
                            </div>
                          )}
                        </button>
                      ))}
                    </>
                  )}

                  {olderConvos.length > 0 && (
                    <>
                      <div className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1 mt-2">
                        Staršie
                      </div>
                      {olderConvos.slice(0, 20).map((convo) => (
                        <button
                          key={convo.id}
                          onClick={() =>
                            onLoadConversation(convo.id, convo.agentKey)
                          }
                          className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors group mb-1 ${
                            activeConversationId === convo.id
                              ? "bg-zinc-800 text-zinc-200"
                              : "hover:bg-zinc-800/50 text-zinc-400"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs">
                              {convo.title}
                            </span>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <span className="text-[10px] text-zinc-600">
                                {formatDate(convo.updatedAt)}
                              </span>
                              <span
                                role="button"
                                tabIndex={0}
                                onClick={(e) =>
                                  handleDeleteConversation(convo.id, e)
                                }
                                onKeyDown={(e) =>
                                  e.key === "Enter" &&
                                  handleDeleteConversation(
                                    convo.id,
                                    e as unknown as React.MouseEvent
                                  )
                                }
                                className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-all"
                              >
                                ✕
                              </span>
                            </div>
                          </div>
                          {convo.agentName && (
                            <div className="text-[10px] text-zinc-600 mt-0.5">
                              {convo.agentName}
                            </div>
                          )}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              </>
            )}
          </>
        ) : (
          <>
            {/* Non-chat tabs: show agents only */}
            <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
              Agenti
            </div>
            <button
              onClick={() => {
                onSelectAgent(null);
                onTabChange("chat");
              }}
              className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-zinc-800 text-zinc-300 transition-colors"
            >
              <div className="font-medium">J.A.L.Z.A. (všeobecný)</div>
            </button>
            {Object.entries(agents).map(([key, agent]) => (
              <button
                key={key}
                onClick={() => {
                  onSelectAgent(agent);
                  onTabChange("chat");
                }}
                className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-zinc-800 text-zinc-300 transition-colors"
              >
                <div className="font-medium">{agent.name}</div>
                <div className="text-xs text-zinc-500 mt-0.5">
                  {agent.sources} zdrojov
                </div>
              </button>
            ))}
          </>
        )}
      </div>

      {/* Service status */}
      <div className="border-t border-zinc-800 px-3 py-2">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
            Služby
          </span>
          <button
            onClick={health.check}
            className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
            title="Obnoviť stav"
          >
            ↻
          </button>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {health.services.map((s) => (
            <span key={s.id} className="flex items-center gap-1.5 text-[10px] text-zinc-400">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  s.status === "online"
                    ? "bg-green-500"
                    : s.status === "checking"
                    ? "bg-yellow-500 animate-pulse"
                    : "bg-red-500"
                }`}
              />
              {s.name}
              {s.latency != null && s.status === "online" && (
                <span className="text-zinc-600">{s.latency}ms</span>
              )}
            </span>
          ))}
        </div>
      </div>

      {/* User profile + settings */}
      <div className="border-t border-zinc-800 p-3">
        <div className="flex items-center gap-3">
          <div
            className={`w-8 h-8 rounded-full ${user.color} flex items-center justify-center text-xs font-bold text-white flex-shrink-0`}
          >
            {user.avatar}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{user.name}</div>
          </div>
          <button
            onClick={onOpenSettings}
            className="w-8 h-8 rounded-lg hover:bg-zinc-800 flex items-center justify-center text-zinc-500 hover:text-zinc-300 transition-colors flex-shrink-0"
            title="Nastavenia"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
              />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  );
}
