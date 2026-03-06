"use client";
import { useEffect, useState, useCallback } from "react";
import {
  getLocation,
  requestLocation,
  type UserLocation,
} from "@/lib/location";
import { getFeatures, type FeatureFlags } from "@/lib/features";
import { logoutUser, type User } from "@/lib/auth";

interface Settings {
  update_enabled: boolean;
  update_day: string;
  update_hour: number;
  agents: string[];
  voice: string;
  email: string;
  auto_voice: boolean;
}

interface Source {
  id: number;
  url: string;
  title: string;
  total_chars: number;
  chunks_count: number;
  created_at: string;
}

interface AgentInfo {
  key: string;
  name: string;
  sources: number;
  chunks: number;
}

interface Props {
  user: User;
  open: boolean;
  onClose: () => void;
  onLogout: () => void;
}

type Tab = "general" | "agents";

export default function SettingsModal({ user, open, onClose, onLogout }: Props) {
  const [tab, setTab] = useState<Tab>("general");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [location, setLocation] = useState<UserLocation | null>(null);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [features, setFeatures] = useState<FeatureFlags>(getFeatures());

  const [agents, setAgents] = useState<Record<string, AgentInfo>>({});
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [addingUrl, setAddingUrl] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch("/api/settings")
      .then((r) => r.json())
      .then(setSettings)
      .catch(() => {});

    fetch("/api/agents")
      .then((r) => r.json())
      .then((data) => {
        const mapped: Record<string, AgentInfo> = {};
        for (const [key, val] of Object.entries(data)) {
          const v = val as AgentInfo;
          mapped[key] = { ...v, key };
        }
        setAgents(mapped);
      })
      .catch(() => {});

    setFeatures(getFeatures());

    getLocation().then((loc) => {
      if (loc) {
        setLocation(loc);
        setFeatures((f) => ({ ...f, locationSharing: true }));
      }
    });
  }, [open]);

  const loadSources = useCallback(async (agentKey: string) => {
    setLoadingSources(true);
    try {
      const res = await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list", agent: agentKey }),
      });
      const data = await res.json();
      setSources(data.sources || []);
    } catch {
      setSources([]);
    } finally {
      setLoadingSources(false);
    }
  }, []);

  useEffect(() => {
    if (selectedAgent) loadSources(selectedAgent);
  }, [selectedAgent, loadSources]);

  const handleDeleteSource = async (sourceId: number) => {
    if (!selectedAgent) return;
    setDeletingId(sourceId);
    try {
      const res = await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", agent: selectedAgent, source_id: sourceId }),
      });
      const data = await res.json();
      if (data.status === "deleted") {
        setSources((prev) => prev.filter((s) => s.id !== sourceId));
        if (data.stats) {
          setAgents((prev) => ({
            ...prev,
            [selectedAgent]: {
              ...prev[selectedAgent],
              sources: data.stats.sources,
              chunks: data.stats.chunks,
            },
          }));
        }
      }
    } finally {
      setDeletingId(null);
    }
  };

  const handleAddUrl = async () => {
    if (!selectedAgent || !newUrl.trim()) return;
    setAddingUrl(true);
    try {
      const res = await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add_url", agent: selectedAgent, url: newUrl.trim() }),
      });
      const data = await res.json();
      if (data.status === "added" || data.status === "skipped") {
        setNewUrl("");
        await loadSources(selectedAgent);
        if (data.stats) {
          setAgents((prev) => ({
            ...prev,
            [selectedAgent]: {
              ...prev[selectedAgent],
              sources: data.stats.sources,
              chunks: data.stats.chunks,
            },
          }));
        }
      }
    } finally {
      setAddingUrl(false);
    }
  };

  const toggleFeature = (key: keyof FeatureFlags) => {
    const updated = { ...features, [key]: !features[key] };
    setFeatures(updated);
    localStorage.setItem("jalza_features", JSON.stringify(updated));
  };

  const handleRequestLocation = async () => {
    setLoadingLocation(true);
    const loc = await requestLocation();
    if (loc) {
      setLocation(loc);
      setFeatures((f) => {
        const updated = { ...f, locationSharing: true };
        localStorage.setItem("jalza_features", JSON.stringify(updated));
        return updated;
      });
    }
    setLoadingLocation(false);
  };

  const clearLocation = () => {
    localStorage.removeItem("jalza_location");
    setLocation(null);
    setFeatures((f) => {
      const updated = { ...f, locationSharing: false };
      localStorage.setItem("jalza_features", JSON.stringify(updated));
      return updated;
    });
  };

  const updateSetting = async (data: Record<string, unknown>) => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const updated = await res.json();
      setSettings((prev) =>
        prev
          ? {
              ...prev,
              update_enabled: updated.enabled ?? prev.update_enabled,
              update_day: updated.day ?? prev.update_day,
              update_hour: updated.hour ?? prev.update_hour,
            }
          : prev
      );
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    await logoutUser();
    onLogout();
  };

  if (!open) return null;

  const days = [
    "pondelok", "utorok", "streda", "štvrtok", "piatok", "sobota", "nedeľa",
  ];

  const featureList: {
    key: keyof FeatureFlags;
    icon: string;
    label: string;
    desc: string;
  }[] = [
    { key: "autoRouting", icon: "🔄", label: "Automatický routing", desc: "Prepínanie modelov podľa kontextu" },
    { key: "webSearch", icon: "🔍", label: "Web Search (Gemini)", desc: "Vyhľadávanie na webe" },
    { key: "emailAccess", icon: "📧", label: "Email prístup", desc: "Čítanie a správa emailov" },
    { key: "voiceInput", icon: "🎤", label: "Hlasový vstup", desc: "Mikrofón" },
    { key: "voiceOutput", icon: "🔊", label: "Hlasový výstup", desc: "Reproduktor / TTS" },
    {
      key: "locationSharing",
      icon: "📍",
      label: "Zdieľanie polohy",
      desc: location ? `${location.city}, ${location.country}` : "Pre počasie a lokálne info",
    },
    { key: "autocorrect", icon: "✏️", label: "Auto-oprava textu", desc: "Opraví preklepy pred odoslaním" },
    { key: "usProxy", icon: "🇺🇸", label: "US Proxy (VPN)", desc: "Obíde EU obmedzenia (obrázky ľudí)" },
  ];

  const Toggle = ({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) => (
    <button
      onClick={onToggle}
      className="rounded-full transition-colors relative flex-shrink-0"
      style={{
        width: 40,
        height: 22,
        backgroundColor: enabled ? "#2563eb" : "#3f3f46",
      }}
    >
      <span
        className="absolute top-0.5 w-[18px] h-[18px] bg-white rounded-full transition-transform"
        style={{ left: enabled ? 20 : 2 }}
      />
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-zinc-800">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold">Nastavenia</h2>
            <div className="flex bg-zinc-800 rounded-lg p-0.5 text-xs">
              <button
                onClick={() => setTab("general")}
                className={`px-3 py-1.5 rounded-md transition-colors ${tab === "general" ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-zinc-300"}`}
              >
                Všeobecné
              </button>
              <button
                onClick={() => setTab("agents")}
                className={`px-3 py-1.5 rounded-md transition-colors ${tab === "agents" ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-zinc-300"}`}
              >
                Znalostné bázy
              </button>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {tab === "general" && (
            <>
              {/* Profil */}
              <section className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-full ${user.color} flex items-center justify-center text-sm font-bold text-white`}
                  >
                    {user.avatar}
                  </div>
                  <div>
                    <div className="font-medium">{user.name}</div>
                    <div className="text-xs text-zinc-500">
                      Role: {user.role || "user"}
                    </div>
                  </div>
                </div>
                <button
                  onClick={handleLogout}
                  className="text-xs px-3 py-1.5 rounded-lg text-red-400 hover:bg-red-500/10 border border-red-500/20 transition-colors"
                >
                  Odhlásiť
                </button>
              </section>

              {/* Funkcie */}
              <section className="space-y-1">
                <h3 className="font-medium text-xs text-zinc-500 uppercase tracking-wider mb-3">
                  Funkcie
                </h3>
                {featureList.map((feat) => (
                  <div
                    key={feat.key}
                    className="flex items-center justify-between py-2.5 border-b border-zinc-800/50 last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-base">{feat.icon}</span>
                      <div>
                        <div className="text-sm font-medium">{feat.label}</div>
                        <div className="text-xs text-zinc-500">{feat.desc}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {feat.key === "locationSharing" && !location && (
                        <button
                          onClick={handleRequestLocation}
                          disabled={loadingLocation}
                          className="text-[10px] px-2.5 py-1 rounded-lg bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 transition-colors"
                        >
                          {loadingLocation ? "..." : "Povoliť"}
                        </button>
                      )}
                      {feat.key === "locationSharing" && location && (
                        <button
                          onClick={clearLocation}
                          className="text-[10px] px-2 py-1 rounded-lg text-zinc-500 hover:text-red-400 transition-colors"
                        >
                          Vymazať
                        </button>
                      )}
                      <Toggle
                        enabled={features[feat.key]}
                        onToggle={() => toggleFeature(feat.key)}
                      />
                    </div>
                  </div>
                ))}
              </section>

              {/* Auto update */}
              {settings && (
                <section className="space-y-3">
                  <h3 className="font-medium text-xs text-zinc-500 uppercase tracking-wider">
                    Automatický update znalostí
                  </h3>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Povolený</span>
                    <Toggle
                      enabled={settings.update_enabled}
                      onToggle={() => updateSetting({ enabled: !settings.update_enabled })}
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <div>
                      <label className="text-xs text-zinc-500 block mb-1">Deň</label>
                      <select
                        value={settings.update_day}
                        onChange={(e) => updateSetting({ day: e.target.value })}
                        disabled={saving}
                        className="bg-zinc-800 rounded-lg px-3 py-1.5 text-sm outline-none"
                      >
                        {days.map((d) => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-zinc-500 block mb-1">Hodina</label>
                      <select
                        value={settings.update_hour}
                        onChange={(e) => updateSetting({ hour: parseInt(e.target.value) })}
                        disabled={saving}
                        className="bg-zinc-800 rounded-lg px-3 py-1.5 text-sm outline-none"
                      >
                        {Array.from({ length: 24 }, (_, i) => (
                          <option key={i} value={i}>{i.toString().padStart(2, "0")}:00</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </section>
              )}

              {/* Integrácie info */}
              {settings && (
                <section className="space-y-2">
                  <h3 className="font-medium text-xs text-zinc-500 uppercase tracking-wider">
                    Pripojené služby
                  </h3>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between py-1.5">
                      <span className="text-zinc-400">Hlas (ElevenLabs)</span>
                      <span className="text-zinc-600">{settings.voice || "—"}</span>
                    </div>
                    <div className="flex justify-between py-1.5">
                      <span className="text-zinc-400">Email (IMAP/SMTP)</span>
                      <span className="text-zinc-600">{settings.email || "—"}</span>
                    </div>
                  </div>
                </section>
              )}
            </>
          )}

          {tab === "agents" && (
            <>
              {/* Zoznam agentov */}
              <div className="grid grid-cols-1 gap-2">
                {Object.entries(agents).map(([key, agent]) => (
                  <button
                    key={key}
                    onClick={() => setSelectedAgent(selectedAgent === key ? null : key)}
                    className={`w-full text-left px-4 py-3 rounded-xl text-sm transition-all ${
                      selectedAgent === key
                        ? "bg-blue-600/15 border border-blue-600/30 text-blue-400"
                        : "bg-zinc-800/50 hover:bg-zinc-800 border border-transparent text-zinc-300"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">{agent.name}</div>
                        <div className="text-xs text-zinc-500 mt-0.5">
                          {agent.sources} zdrojov · {agent.chunks} častí
                        </div>
                      </div>
                      <svg
                        className={`w-4 h-4 text-zinc-500 transition-transform ${selectedAgent === key ? "rotate-180" : ""}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>
                ))}
              </div>

              {/* Detail zdrojov */}
              {selectedAgent && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium text-xs text-zinc-500 uppercase tracking-wider">
                      Zdroje — {agents[selectedAgent]?.name}
                    </h3>
                    <span className="text-xs text-zinc-600">
                      {sources.length} zdrojov
                    </span>
                  </div>

                  {/* Pridať nový URL */}
                  <div className="flex gap-2">
                    <input
                      value={newUrl}
                      onChange={(e) => setNewUrl(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAddUrl()}
                      placeholder="https://... (pridať novú URL)"
                      className="flex-1 bg-zinc-800 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <button
                      onClick={handleAddUrl}
                      disabled={addingUrl || !newUrl.trim()}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-30 text-white text-sm rounded-lg transition-colors"
                    >
                      {addingUrl ? "..." : "+ Pridať"}
                    </button>
                  </div>

                  {/* Zoznam zdrojov */}
                  {loadingSources ? (
                    <div className="text-center text-zinc-600 text-sm py-8">
                      Načítavam zdroje...
                    </div>
                  ) : sources.length === 0 ? (
                    <div className="text-center text-zinc-600 text-sm py-8">
                      Žiadne zdroje. Pridaj URL alebo použi "Učiť sa".
                    </div>
                  ) : (
                    <div className="space-y-1 max-h-[40vh] overflow-y-auto">
                      {sources.map((src) => (
                        <div
                          key={src.id}
                          className="flex items-start gap-3 bg-zinc-800/50 rounded-lg px-3 py-2.5 group hover:bg-zinc-800 transition-colors"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate" title={src.title}>
                              {src.title}
                            </div>
                            <a
                              href={src.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-400/70 hover:text-blue-400 truncate block mt-0.5"
                              title={src.url}
                            >
                              {src.url}
                            </a>
                            <div className="text-[10px] text-zinc-600 mt-1">
                              {src.chunks_count} častí · {Math.round(src.total_chars / 1000)}k znakov
                              {src.created_at && ` · ${new Date(src.created_at).toLocaleDateString("sk-SK")}`}
                            </div>
                          </div>
                          <button
                            onClick={() => handleDeleteSource(src.id)}
                            disabled={deletingId === src.id}
                            className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 p-1 rounded transition-all flex-shrink-0"
                            title="Odstrániť zdroj"
                          >
                            {deletingId === src.id ? (
                              <span className="text-xs">...</span>
                            ) : (
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            )}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
