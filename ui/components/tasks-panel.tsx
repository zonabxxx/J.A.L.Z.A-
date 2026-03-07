"use client";
import { useEffect, useState } from "react";

interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  schedule: string;
  agent?: string;
  enabled: boolean;
  last_run?: string;
  notify: boolean;
}

interface TaskResult {
  id: number;
  task_id: string;
  task_name: string;
  result: string;
  status: string;
  created_at: string;
}

const SCHEDULE_OPTIONS = [
  { value: "hourly", label: "Každú hodinu" },
  { value: "daily_morning", label: "Denne ráno (7:00)" },
  { value: "daily_evening", label: "Denne večer (19:00)" },
  { value: "weekly", label: "Raz týždenne (pondelok)" },
  { value: "monthly", label: "Raz mesačne (1.)" },
  { value: "custom", label: "Vlastný..." },
];

interface Props {
  onMenuToggle?: () => void;
  onBack?: () => void;
}

export default function TasksPanel({ onMenuToggle, onBack }: Props) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [agents, setAgents] = useState<Record<string, { name: string }>>({});
  const [results, setResults] = useState<TaskResult[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [schedulerActive, setSchedulerActive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [newTask, setNewTask] = useState({
    name: "",
    prompt: "",
    schedule: "daily_morning",
    agent: "",
    notify: true,
  });

  const load = async () => {
    try {
      const [tasksRes, agentsRes] = await Promise.all([
        fetch("/api/tasks"),
        fetch("/api/agents"),
      ]);
      const tasksData = await tasksRes.json();
      const agentsData = await agentsRes.json();
      if (tasksData.tasks) setTasks(tasksData.tasks);
      if (tasksData.scheduler_active) setSchedulerActive(true);
      setAgents(agentsData);
    } catch {
      // error
    }
  };

  const loadResults = async () => {
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "results", limit: 10 }),
      });
      const data = await res.json();
      if (data.results) setResults(data.results);
    } catch {
      // error
    }
  };

  useEffect(() => {
    load();
  }, []);

  const createTask = async () => {
    if (!newTask.name || !newTask.prompt) return;
    setSaving(true);
    try {
      await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", ...newTask }),
      });
      setShowCreate(false);
      setNewTask({ name: "", prompt: "", schedule: "daily_morning", agent: "", notify: true });
      load();
    } finally {
      setSaving(false);
    }
  };

  const toggleTask = async (id: string, enabled: boolean) => {
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle", id, enabled }),
    });
    load();
  };

  const deleteTask = async (id: string) => {
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id }),
    });
    load();
  };

  const runNow = async (id: string) => {
    setRunningId(id);
    try {
      await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run", id }),
      });
      await load();
      await loadResults();
    } finally {
      setRunningId(null);
    }
  };

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
            <h2 className="font-semibold text-sm">Plánované úlohy</h2>
            <p className="text-[10px] text-zinc-500">
              {schedulerActive ? (
                <span className="text-green-400">● Scheduler aktívny</span>
              ) : (
                <span className="text-red-400">● Scheduler neaktívny</span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setShowResults(!showResults); if (!showResults) loadResults(); }}
            className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
          >
            {showResults ? "Skryť históriu" : "História"}
          </button>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors"
          >
            + Nová
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">

      {showCreate && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-700 p-5 space-y-3">
          <input
            placeholder="Názov úlohy (napr. Kontrola emailov)"
            value={newTask.name}
            onChange={(e) => setNewTask({ ...newTask, name: e.target.value })}
            className="w-full bg-zinc-800 rounded-lg px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-blue-500"
          />
          <textarea
            placeholder="Prompt — čo má agent urobiť (napr. Skontroluj emaily a napíš mi zhrnutie dôležitých)"
            value={newTask.prompt}
            onChange={(e) => setNewTask({ ...newTask, prompt: e.target.value })}
            rows={3}
            className="w-full bg-zinc-800 rounded-lg px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-blue-500 resize-none"
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-500 block mb-1">
                Opakovanie
              </label>
              <select
                value={newTask.schedule}
                onChange={(e) =>
                  setNewTask({ ...newTask, schedule: e.target.value })
                }
                className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm outline-none"
              >
                {SCHEDULE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">
                Agent (voliteľné)
              </label>
              <select
                value={newTask.agent}
                onChange={(e) =>
                  setNewTask({ ...newTask, agent: e.target.value })
                }
                className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm outline-none"
              >
                <option value="">Žiadny (všeobecný)</option>
                {Object.entries(agents).map(([key, val]) => (
                  <option key={key} value={key}>
                    {val.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={newTask.notify}
                onChange={(e) =>
                  setNewTask({ ...newTask, notify: e.target.checked })
                }
                className="rounded"
              />
              Notifikovať cez Telegram
            </label>
          </div>
          <div className="flex gap-2">
            <button
              onClick={createTask}
              disabled={saving || !newTask.name || !newTask.prompt}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm px-5 py-2 rounded-lg transition-colors"
            >
              {saving ? "Ukladám..." : "Vytvoriť"}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="bg-zinc-800 hover:bg-zinc-700 text-sm px-5 py-2 rounded-lg transition-colors"
            >
              Zrušiť
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {tasks.length === 0 && !showCreate && (
          <div className="text-center py-12 text-zinc-600">
            <div className="text-3xl mb-3">⏰</div>
            <p>Žiadne plánované úlohy</p>
            <p className="text-sm mt-1">
              Vytvor úlohu a agent ju bude vykonávať pravidelne
            </p>
          </div>
        )}

        {tasks.map((task) => (
          <div
            key={task.id}
            className={`bg-zinc-900 rounded-xl border p-4 transition-colors ${
              task.enabled ? "border-zinc-800" : "border-zinc-800/50 opacity-60"
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{task.name}</span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full ${
                      task.enabled
                        ? "bg-green-600/20 text-green-400"
                        : "bg-zinc-700 text-zinc-500"
                    }`}
                  >
                    {task.enabled ? "Aktívna" : "Pozastavená"}
                  </span>
                  {task.agent && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-600/20 text-amber-400">
                      📚 {task.agent}
                    </span>
                  )}
                </div>
                <p className="text-xs text-zinc-500 mt-1">
                  {SCHEDULE_OPTIONS.find((o) => o.value === task.schedule)?.label ||
                    task.schedule}
                  {task.last_run && ` · Posledné: ${task.last_run}`}
                </p>
                <p className="text-sm text-zinc-400 mt-2 bg-zinc-800 rounded-lg px-3 py-2">
                  {task.prompt}
                </p>
              </div>
              <div className="flex items-center gap-1 ml-3">
                <button
                  onClick={() => runNow(task.id)}
                  disabled={runningId === task.id}
                  className="text-xs px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors disabled:opacity-50"
                  title="Spustiť teraz"
                >
                  {runningId === task.id ? "⏳" : "▶"}
                </button>
                <button
                  onClick={() => toggleTask(task.id, !task.enabled)}
                  className="text-xs px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors"
                >
                  {task.enabled ? "⏸" : "▶"}
                </button>
                <button
                  onClick={() => deleteTask(task.id)}
                  className="text-xs px-2.5 py-1 rounded bg-zinc-800 hover:bg-red-900/50 text-zinc-400 hover:text-red-400 transition-colors"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {showResults && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
            História výsledkov
          </h3>
          {results.length === 0 ? (
            <p className="text-sm text-zinc-600 text-center py-4">Žiadne výsledky</p>
          ) : (
            results.map((r) => (
              <div key={r.id} className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-sm">{r.task_name || r.task_id}</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                      r.status === "completed" ? "bg-green-600/20 text-green-400" : "bg-red-600/20 text-red-400"
                    }`}>
                      {r.status === "completed" ? "OK" : "Chyba"}
                    </span>
                    <span className="text-[10px] text-zinc-600">{r.created_at}</span>
                  </div>
                </div>
                <p className="text-xs text-zinc-400 bg-zinc-800 rounded-lg px-3 py-2 whitespace-pre-wrap max-h-32 overflow-y-auto">
                  {r.result}
                </p>
              </div>
            ))
          )}
        </div>
      )}

      <div className="bg-zinc-900/50 rounded-xl p-4 border border-zinc-800/50">
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
          Príklady úloh
        </h3>
        <div className="space-y-1.5 text-sm text-zinc-500">
          <p>
            📧 <em>&quot;Skontroluj emaily a pošli mi zhrnutie dôležitých cez Telegram&quot;</em>{" "}
            — denne ráno
          </p>
          <p>
            📚 <em>&quot;Skontroluj či sa nezmenili daňové zákony na slov-lex.sk&quot;</em>{" "}
            — raz týždenne
          </p>
          <p>
            🔍 <em>&quot;Nájdi nové 3D modely na Printables pre ADSUN&quot;</em>{" "}
            — denne
          </p>
          <p>
            💰 <em>&quot;Zhrň aktuálne ceny kryptomien BTC, ETH, SOL&quot;</em>{" "}
            — každú hodinu
          </p>
        </div>
      </div>
      </div>
    </div>
  );
}
