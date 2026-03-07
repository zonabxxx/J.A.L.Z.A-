"use client";
import { useEffect, useState } from "react";
import type { ServiceHealth } from "@/lib/use-health";

interface Integration {
  id: string;
  name: string;
  type: string;
  icon: string;
  status: "connected" | "disconnected" | "empty";
  provider: string;
  account: string;
  capabilities: string[];
  config: Record<string, unknown>;
}

interface Props {
  health: {
    services: ServiceHealth[];
    check: () => void;
    isOnline: (id: string) => boolean;
  };
  onMenuToggle?: () => void;
  onBack?: () => void;
}

export default function IntegrationsPanel({ health, onMenuToggle, onBack }: Props) {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations");
      const text = await res.text();
      try {
        const data = JSON.parse(text);
        if (data.integrations) setIntegrations(data.integrations);
        else if (data.error) setError(data.error);
      } catch {
        setError("Backend vrátil neplatnú odpoveď – tunnel pravdepodobne nebeží.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nepodarilo sa načítať integrácie");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const healthMap: Record<string, string> = {
    ollama: "ollama",
    gemini: "gemini",
    knowledge_api: "knowledge_api",
  };

  const getLiveStatus = (integration: Integration): "connected" | "disconnected" | "empty" => {
    const healthId = healthMap[integration.id];
    if (healthId) {
      return health.isOnline(healthId) ? "connected" : "disconnected";
    }
    return integration.status;
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "connected":
        return "bg-green-500";
      case "disconnected":
        return "bg-red-500";
      case "empty":
        return "bg-yellow-500";
      default:
        return "bg-zinc-500";
    }
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case "connected":
        return "Pripojené";
      case "disconnected":
        return "Odpojené";
      case "empty":
        return "Prázdne";
      default:
        return status;
    }
  };

  const startEdit = (integration: Integration) => {
    if (integration.id === "email") {
      setEditForm({
        username: (integration.config.username as string) || "",
        password: "",
        imap_server: (integration.config.imap_server as string) || "imap.gmail.com",
        smtp_server: (integration.config.smtp_server as string) || "smtp.gmail.com",
      });
      setEditingId("email");
    } else if (integration.id === "elevenlabs") {
      setEditForm({
        api_key: "",
        voice_id: (integration.config.voice_id as string) || "",
      });
      setEditingId("elevenlabs");
    }
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { id: editingId };
      for (const [k, v] of Object.entries(editForm)) {
        if (v) payload[k] = v;
      }
      await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setEditingId(null);
      load();
    } finally {
      setSaving(false);
    }
  };

  const typeGroups = [
    { label: "Komunikácia", types: ["email", "messaging"] },
    { label: "AI & Modely", types: ["llm", "search"] },
    { label: "Znalostné databázy", types: ["knowledge"] },
    { label: "Médiá", types: ["voice"] },
  ];

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-500">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-zinc-600 border-t-blue-500 rounded-full mx-auto mb-3" />
          <p>Načítavam integrácie...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-[100dvh] md:h-full overflow-hidden">
      <header className="flex items-center justify-between px-4 md:px-6 py-3 border-b bg-zinc-900/50 safe-top">
        <div className="flex items-center gap-3">
          {onMenuToggle && (
            <button onClick={onMenuToggle} className="md:hidden text-zinc-400 hover:text-zinc-200 p-1 -ml-1">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </button>
          )}
          {onBack && (
            <button onClick={onBack} className="md:hidden text-zinc-400 hover:text-zinc-200 p-1" title="Späť na chat">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <div>
            <h2 className="font-semibold text-sm">Integrácie (MCP)</h2>
            <p className="text-[10px] text-zinc-500">Pripojenia agenta k externým službám</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            {integrations.filter((i) => getLiveStatus(i) === "connected").length}
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
            {integrations.filter((i) => getLiveStatus(i) === "disconnected").length}
          </span>
          <button onClick={() => { health.check(); load(); }} className="text-zinc-500 hover:text-zinc-300 transition-colors text-sm" title="Obnoviť">↻</button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5">
      {error && (
        <div className="px-3 py-2 rounded-lg bg-red-600/10 border border-red-600/20 text-red-400 text-xs">
          {error}
        </div>
      )}

      {typeGroups.map((group) => {
        const items = integrations.filter((i) =>
          group.types.includes(i.type)
        );
        if (items.length === 0) return null;
        return (
          <section key={group.label}>
            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
              {group.label}
            </h3>
            <div className="space-y-2">
              {items.map((integration) => (
                <div
                  key={integration.id}
                  className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden"
                >
                  <div className="flex items-center gap-4 px-5 py-4">
                    <span className="text-2xl">{integration.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">
                          {integration.name}
                        </span>
                        <span
                          className={`w-2 h-2 rounded-full ${statusColor(getLiveStatus(integration))}`}
                        />
                        <span className="text-[10px] text-zinc-500">
                          {statusLabel(getLiveStatus(integration))}
                        </span>
                      </div>
                      <div className="text-xs text-zinc-500 mt-0.5">
                        {integration.provider} · {integration.account}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {integration.capabilities.map((cap) => (
                          <span
                            key={cap}
                            className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400"
                          >
                            {cap}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      {(integration.id === "email" ||
                        integration.id === "elevenlabs") && (
                        <button
                          onClick={() => startEdit(integration)}
                          className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
                        >
                          Nastaviť
                        </button>
                      )}
                      {integration.type === "knowledge" && (
                        <button
                          onClick={async () => {
                            const key = integration.config.agent_key as string;
                            await fetch("/api/agents", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ action: "learn", agent: key }),
                            });
                            load();
                          }}
                          className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
                        >
                          Aktualizovať
                        </button>
                      )}
                    </div>
                  </div>

                  {integration.id === "ollama" &&
                    Array.isArray(integration.config.models) && (
                      <div className="px-5 pb-4 pt-0">
                        <div className="flex flex-wrap gap-1">
                          {(integration.config.models as string[]).map((m) => (
                            <span
                              key={m}
                              className="text-[10px] px-2 py-0.5 rounded bg-blue-600/20 text-blue-400"
                            >
                              {m}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                  {editingId === integration.id && (
                    <div className="px-5 pb-4 pt-2 border-t border-zinc-800 space-y-2">
                      {integration.id === "email" && (
                        <>
                          <input
                            placeholder="Email adresa"
                            value={editForm.username || ""}
                            onChange={(e) =>
                              setEditForm({ ...editForm, username: e.target.value })
                            }
                            className="w-full bg-zinc-800 rounded px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500"
                          />
                          <input
                            placeholder="App heslo (Gmail app password)"
                            type="password"
                            value={editForm.password || ""}
                            onChange={(e) =>
                              setEditForm({ ...editForm, password: e.target.value })
                            }
                            className="w-full bg-zinc-800 rounded px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500"
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              placeholder="IMAP server"
                              value={editForm.imap_server || ""}
                              onChange={(e) =>
                                setEditForm({ ...editForm, imap_server: e.target.value })
                              }
                              className="bg-zinc-800 rounded px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500"
                            />
                            <input
                              placeholder="SMTP server"
                              value={editForm.smtp_server || ""}
                              onChange={(e) =>
                                setEditForm({ ...editForm, smtp_server: e.target.value })
                              }
                              className="bg-zinc-800 rounded px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </div>
                        </>
                      )}
                      {integration.id === "elevenlabs" && (
                        <>
                          <input
                            placeholder="ElevenLabs API Key"
                            type="password"
                            value={editForm.api_key || ""}
                            onChange={(e) =>
                              setEditForm({ ...editForm, api_key: e.target.value })
                            }
                            className="w-full bg-zinc-800 rounded px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500"
                          />
                          <input
                            placeholder="Voice ID"
                            value={editForm.voice_id || ""}
                            onChange={(e) =>
                              setEditForm({ ...editForm, voice_id: e.target.value })
                            }
                            className="w-full bg-zinc-800 rounded px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={saveEdit}
                          disabled={saving}
                          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded-lg transition-colors"
                        >
                          {saving ? "Ukladám..." : "Uložiť"}
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="bg-zinc-800 hover:bg-zinc-700 text-sm px-4 py-1.5 rounded-lg transition-colors"
                        >
                          Zrušiť
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        );
      })}
      </div>
    </div>
  );
}
