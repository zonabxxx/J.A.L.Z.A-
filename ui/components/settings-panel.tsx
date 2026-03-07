"use client";
import { useEffect, useState } from "react";
import { getLocation, requestLocation, type UserLocation } from "@/lib/location";
import { subscribeToPush, unsubscribeFromPush, isPushSupported, isPushSubscribed } from "@/lib/push-notifications";

interface Settings {
  update_enabled: boolean;
  update_day: string;
  update_hour: number;
  agents: string[];
  voice: string;
  email: string;
  auto_voice: boolean;
}

export default function SettingsPanel() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [location, setLocation] = useState<UserLocation | null>(null);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);

  const [features, setFeatures] = useState({
    webSearch: true,
    emailAccess: true,
    voiceInput: true,
    voiceOutput: true,
    autoRouting: true,
    locationSharing: false,
  });

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then(setSettings)
      .catch(() => {});

    setPushSupported(isPushSupported());
    isPushSubscribed().then(setPushEnabled);

    getLocation().then((loc) => {
      if (loc) {
        setLocation(loc);
        setFeatures((f) => ({ ...f, locationSharing: true }));
      }
    });

    const stored = localStorage.getItem("jalza_features");
    if (stored) {
      try {
        setFeatures((prev) => ({ ...prev, ...JSON.parse(stored) }));
      } catch {
        // ignore
      }
    }
  }, []);

  const toggleFeature = (key: keyof typeof features) => {
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

  const days = [
    "pondelok", "utorok", "streda", "štvrtok", "piatok", "sobota", "nedeľa",
  ];

  const featureList: {
    key: keyof typeof features;
    icon: string;
    label: string;
    desc: string;
  }[] = [
    {
      key: "autoRouting",
      icon: "🔄",
      label: "Automatický routing",
      desc: "Prepínanie modelov podľa kontextu správy",
    },
    {
      key: "webSearch",
      icon: "🔍",
      label: "Web Search (Gemini)",
      desc: "Vyhľadávanie na webe pre aktuálne informácie",
    },
    {
      key: "emailAccess",
      icon: "📧",
      label: "Email prístup",
      desc: "Čítanie a správa emailov cez IMAP",
    },
    {
      key: "voiceInput",
      icon: "🎤",
      label: "Hlasový vstup",
      desc: "Zadávanie správ cez mikrofón",
    },
    {
      key: "voiceOutput",
      icon: "🔊",
      label: "Hlasový výstup",
      desc: "Prehrávanie odpovedí cez reproduktor",
    },
    {
      key: "locationSharing",
      icon: "📍",
      label: "Zdieľanie polohy",
      desc: location
        ? `${location.city}, ${location.country}`
        : "Pre počasie a lokálne info",
    },
  ];

  const handlePushToggle = async () => {
    if (pushEnabled) {
      await unsubscribeFromPush();
      setPushEnabled(false);
    } else {
      const ok = await subscribeToPush();
      setPushEnabled(ok);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <h2 className="text-lg font-semibold">Nastavenia</h2>

      {pushSupported && (
        <section className="bg-zinc-900 rounded-xl p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-lg">🔔</span>
              <div>
                <div className="text-sm font-medium">Push notifikácie</div>
                <div className="text-xs text-zinc-500">
                  {pushEnabled ? "Aktívne — budeš dostávať upozornenia" : "Povoľ pre pripomienky a úlohy"}
                </div>
              </div>
            </div>
            <button
              onClick={handlePushToggle}
              className={`w-11 h-6 rounded-full transition-colors relative ${
                pushEnabled ? "bg-blue-600" : "bg-zinc-700"
              }`}
            >
              <span
                className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                  pushEnabled ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
        </section>
      )}

      <section className="bg-zinc-900 rounded-xl p-5 space-y-1">
        <h3 className="font-medium text-sm text-zinc-400 uppercase tracking-wider mb-3">
          Funkcie
        </h3>
        {featureList.map((feat) => (
          <div
            key={feat.key}
            className="flex items-center justify-between py-2.5 border-b border-zinc-800 last:border-0"
          >
            <div className="flex items-center gap-3">
              <span className="text-lg">{feat.icon}</span>
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
                  className="text-xs px-3 py-1 rounded-lg bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 transition-colors"
                >
                  {loadingLocation ? "Zisťujem..." : "Povoliť"}
                </button>
              )}
              {feat.key === "locationSharing" && location && (
                <button
                  onClick={clearLocation}
                  className="text-xs px-2 py-1 rounded-lg text-zinc-500 hover:text-red-400 transition-colors"
                >
                  Vymazať
                </button>
              )}
              <button
                onClick={() => toggleFeature(feat.key)}
                className={`w-11 h-6 rounded-full transition-colors relative ${
                  features[feat.key] ? "bg-blue-600" : "bg-zinc-700"
                }`}
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                    features[feat.key] ? "left-[22px]" : "left-0.5"
                  }`}
                />
              </button>
            </div>
          </div>
        ))}
      </section>

      {settings && (
        <section className="bg-zinc-900 rounded-xl p-5 space-y-4">
          <h3 className="font-medium text-sm text-zinc-400 uppercase tracking-wider">
            Automatický update znalostí
          </h3>
          <div className="flex items-center justify-between">
            <span className="text-sm">Povolený</span>
            <button
              onClick={() =>
                updateSetting({ enabled: !settings.update_enabled })
              }
              className={`w-11 h-6 rounded-full transition-colors relative ${
                settings.update_enabled ? "bg-blue-600" : "bg-zinc-700"
              }`}
            >
              <span
                className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                  settings.update_enabled ? "left-[22px]" : "left-0.5"
                }`}
              />
            </button>
          </div>
          <div className="flex items-center gap-4">
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Deň</label>
              <select
                value={settings.update_day}
                onChange={(e) => updateSetting({ day: e.target.value })}
                disabled={saving}
                className="bg-zinc-800 rounded px-3 py-1.5 text-sm outline-none"
              >
                {days.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Hodina</label>
              <select
                value={settings.update_hour}
                onChange={(e) =>
                  updateSetting({ hour: parseInt(e.target.value) })
                }
                disabled={saving}
                className="bg-zinc-800 rounded px-3 py-1.5 text-sm outline-none"
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>
                    {i.toString().padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>
      )}

      {settings && (
        <section className="bg-zinc-900 rounded-xl p-5 space-y-3">
          <h3 className="font-medium text-sm text-zinc-400 uppercase tracking-wider">
            Integrácie
          </h3>
          <div className="flex items-center justify-between text-sm">
            <span>Hlas (ElevenLabs)</span>
            <span className="text-zinc-500">{settings.voice}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span>Email (IMAP/SMTP)</span>
            <span className="text-zinc-500">{settings.email}</span>
          </div>
          {settings.agents.map((agent, i) => (
            <div
              key={i}
              className="text-sm text-zinc-300 bg-zinc-800 rounded-lg px-3 py-2"
            >
              {agent}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
