"use client";
import { useEffect, useState, useCallback } from "react";
import { getUsageSummary, type UsageSummary } from "@/lib/usage-tracker";

type Period = "day" | "week" | "month";

const PERIOD_LABELS: Record<Period, string> = {
  day: "Dnes",
  week: "Týždeň",
  month: "Mesiac",
};

const MODEL_COLORS: Record<string, string> = {
  "jalza": "bg-purple-500",
  "gemini-2.0-flash": "bg-emerald-500",
  "gemini-2.5-flash-preview-05-20": "bg-cyan-500",
  "gemini-2.5-pro-preview-05-06": "bg-violet-500",
  "llama3.2-vision:11b": "bg-orange-500",
};

const MODEL_NAMES: Record<string, string> = {
  "jalza": "J.A.L.Z.A.",
  "gemini-2.0-flash": "Gemini 2.0 Flash",
  "gemini-2.5-flash-preview-05-20": "Gemini 2.5 Flash",
  "gemini-2.5-pro-preview-05-06": "Gemini 2.5 Pro",
  "llama3.2-vision:11b": "Vision (llama3.2)",
};

function formatTokens(n: number): string {
  if (!n) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatCost(usd: number): string {
  if (!usd) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

interface Props {
  onMenuToggle?: () => void;
  onBack?: () => void;
}

export default function UsagePanel({ onMenuToggle, onBack }: Props) {
  const [period, setPeriod] = useState<Period>("month");
  const [data, setData] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const summary = await getUsageSummary(period);
    setData(summary);
    setLoading(false);
  }, [period]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-500">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-zinc-600 border-t-blue-500 rounded-full mx-auto mb-3" />
          <p>Načítavam štatistiky...</p>
        </div>
      </div>
    );
  }

  const totals = data?.totals || { requests: 0, total_input: 0, total_output: 0, total_cost: 0 };
  const byModel = data?.by_model || [];
  const daily = data?.daily || [];

  const maxCostModel = byModel.length > 0 ? Math.max(...byModel.map(m => m.total_cost)) : 1;
  const maxRequestsModel = byModel.length > 0 ? Math.max(...byModel.map(m => m.requests)) : 1;

  const dailyByDate: Record<string, { requests: number; cost: number; tokens: number }> = {};
  for (const d of daily) {
    if (!dailyByDate[d.day]) dailyByDate[d.day] = { requests: 0, cost: 0, tokens: 0 };
    dailyByDate[d.day].requests += d.requests;
    dailyByDate[d.day].cost += d.total_cost;
    dailyByDate[d.day].tokens += (d.total_input || 0) + (d.total_output || 0);
  }
  const days = Object.entries(dailyByDate).sort(([a], [b]) => a.localeCompare(b));
  const maxDayCost = days.length > 0 ? Math.max(...days.map(([, v]) => v.cost), 0.001) : 1;

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
            <h2 className="font-semibold text-sm">Spotreba & Náklady</h2>
            <p className="text-[10px] text-zinc-500">Prehľad používania modelov</p>
          </div>
        </div>
        <div className="flex bg-zinc-800 rounded-lg p-0.5">
          {(["day", "week", "month"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                period === p ? "bg-blue-600 text-white" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Požiadavky</div>
          <div className="text-2xl font-bold mt-1">{totals.requests || 0}</div>
        </div>
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Vstupné tokeny</div>
          <div className="text-2xl font-bold mt-1">{formatTokens(totals.total_input || 0)}</div>
        </div>
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Výstupné tokeny</div>
          <div className="text-2xl font-bold mt-1">{formatTokens(totals.total_output || 0)}</div>
        </div>
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Celkový náklad</div>
          <div className="text-2xl font-bold mt-1 text-green-400">{formatCost(totals.total_cost || 0)}</div>
        </div>
      </div>

      {/* By model breakdown */}
      <section>
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
          Podľa modelu
        </h3>
        <div className="space-y-2">
          {byModel.length === 0 ? (
            <p className="text-sm text-zinc-600">Zatiaľ žiadne dáta</p>
          ) : (
            byModel.map((m) => (
              <div key={m.model} className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${MODEL_COLORS[m.model] || "bg-zinc-500"}`} />
                    <span className="text-sm font-medium">{MODEL_NAMES[m.model] || m.model}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">
                      {m.provider}
                    </span>
                  </div>
                  <span className="text-sm font-medium text-green-400">{formatCost(m.total_cost)}</span>
                </div>
                <div className="flex gap-4 text-[11px] text-zinc-500 mb-2">
                  <span>{m.requests} požiadaviek</span>
                  <span>{formatTokens(m.total_input || 0)} vstup</span>
                  <span>{formatTokens(m.total_output || 0)} výstup</span>
                </div>
                <div className="flex gap-1 h-1.5">
                  <div
                    className={`rounded-full ${MODEL_COLORS[m.model] || "bg-zinc-500"} opacity-60`}
                    style={{ width: `${(m.requests / maxRequestsModel) * 60}%` }}
                    title="Požiadavky"
                  />
                  <div
                    className="rounded-full bg-green-500 opacity-60"
                    style={{ width: `${(m.total_cost / maxCostModel) * 40}%` }}
                    title="Náklad"
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Daily chart */}
      {days.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
            Denný prehľad
          </h3>
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-end gap-1 h-32">
              {days.map(([day, val]) => (
                <div key={day} className="flex-1 flex flex-col items-center gap-1">
                  <div className="text-[9px] text-green-400">{formatCost(val.cost)}</div>
                  <div
                    className="w-full bg-blue-500/60 rounded-t min-h-[2px] transition-all"
                    style={{ height: `${Math.max((val.cost / maxDayCost) * 100, 2)}%` }}
                    title={`${val.requests} req, ${formatTokens(val.tokens)} tokens`}
                  />
                  <div className="text-[9px] text-zinc-600 -rotate-45 origin-top-left mt-1 whitespace-nowrap">
                    {day.slice(5)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
      </div>
    </div>
  );
}
