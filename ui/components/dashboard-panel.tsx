"use client";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";

interface DashboardData {
  date: string;
  calendar_events: number;
  emails_adsun: number;
  emails_juraj: number;
  active_tasks: number;
  summary: string;
  calendar: { subject?: string; start?: string; end?: string }[];
  emails: {
    adsun: { subject?: string; from?: string; date?: string }[];
    juraj: { subject?: string; from?: string; date?: string }[];
  };
  tasks: { name: string; schedule: string; last_run?: string }[];
}

interface Props {
  onMenuToggle?: () => void;
  onBack?: () => void;
  onNavigate?: (tab: string) => void;
}

export default function DashboardPanel({ onMenuToggle, onBack, onNavigate }: Props) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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
            <button onClick={onBack} className="md:hidden text-zinc-400 hover:text-zinc-200 p-1" title="Späť">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <div>
            <h2 className="font-semibold text-sm">Dashboard</h2>
            <p className="text-[10px] text-zinc-500">{data?.date || "Načítavam..."}</p>
          </div>
        </div>
        <button
          onClick={() => { setLoading(true); fetch("/api/dashboard").then(r => r.json()).then(setData).finally(() => setLoading(false)); }}
          className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
        >
          ↻ Obnoviť
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-zinc-500">
            <div className="animate-spin w-6 h-6 border-2 border-zinc-500 border-t-blue-500 rounded-full mr-3" />
            Načítavam prehľad...
          </div>
        ) : data ? (
          <>
            {/* Stats cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <button
                onClick={() => onNavigate?.("calendar")}
                className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 text-left hover:border-zinc-600 transition-colors"
              >
                <div className="text-2xl font-bold text-blue-400">{data.calendar_events}</div>
                <div className="text-xs text-zinc-500">📅 Dnešné udalosti</div>
              </button>
              <button
                onClick={() => onNavigate?.("email")}
                className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 text-left hover:border-zinc-600 transition-colors"
              >
                <div className="text-2xl font-bold text-amber-400">{data.emails_adsun + data.emails_juraj}</div>
                <div className="text-xs text-zinc-500">📧 Nové emaily</div>
              </button>
              <button
                onClick={() => onNavigate?.("tasks")}
                className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 text-left hover:border-zinc-600 transition-colors"
              >
                <div className="text-2xl font-bold text-green-400">{data.active_tasks}</div>
                <div className="text-xs text-zinc-500">⏰ Aktívne úlohy</div>
              </button>
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                <div className="text-2xl font-bold text-purple-400">🧠</div>
                <div className="text-xs text-zinc-500">J.A.L.Z.A. aktívna</div>
              </div>
            </div>

            {/* AI Summary */}
            {data.summary && (
              <div className="bg-gradient-to-r from-blue-900/20 to-purple-900/20 rounded-xl border border-blue-800/30 p-5">
                <h3 className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-3">
                  🤖 Ranný prehľad od J.A.L.Z.A.
                </h3>
                <div className="text-sm text-zinc-300 prose prose-invert prose-sm max-w-none">
                  <ReactMarkdown>{data.summary}</ReactMarkdown>
                </div>
              </div>
            )}

            {/* Calendar events */}
            {data.calendar.length > 0 && (
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
                <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
                  📅 Dnešné udalosti
                </h3>
                <div className="space-y-2">
                  {data.calendar.slice(0, 5).map((e, i) => (
                    <div key={i} className="flex items-center gap-3 text-sm">
                      <span className="text-xs text-zinc-500 w-12 shrink-0">
                        {e.start ? new Date(e.start).toLocaleTimeString("sk-SK", { hour: "2-digit", minute: "2-digit" }) : "—"}
                      </span>
                      <span className="text-zinc-300">{e.subject || "Bez názvu"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent emails */}
            {(data.emails.adsun.length > 0 || data.emails.juraj.length > 0) && (
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
                <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
                  📧 Posledné emaily
                </h3>
                <div className="space-y-2">
                  {[...data.emails.adsun, ...data.emails.juraj].slice(0, 5).map((e, i) => (
                    <div key={i} className="text-sm border-b border-zinc-800 last:border-0 pb-2 last:pb-0">
                      <div className="text-zinc-300 truncate">{e.subject || "Bez predmetu"}</div>
                      <div className="text-xs text-zinc-500">{e.from}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Active tasks */}
            {data.tasks.length > 0 && (
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
                <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
                  ⏰ Aktívne úlohy
                </h3>
                <div className="space-y-2">
                  {data.tasks.slice(0, 5).map((t, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="text-zinc-300">{t.name}</span>
                      <span className="text-xs text-zinc-600">{t.last_run || "Ešte nebežala"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-12 text-zinc-600">
            <div className="text-3xl mb-3">📊</div>
            <p>Dashboard nie je dostupný</p>
          </div>
        )}
      </div>
    </div>
  );
}
