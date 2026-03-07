"use client";
import { useState } from "react";

export interface PendingEvent {
  subject: string;
  date: string;
  time: string;
  endTime: string;
  durationH: number;
  location: string;
  body: string;
  attendees: string[];
  dayName: string;
}

interface Props {
  event: PendingEvent;
  onConfirm: (event: PendingEvent) => void;
  onCancel: () => void;
  disabled?: boolean;
}

export default function CalendarConfirmCard({ event, onConfirm, onCancel, disabled }: Props) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<PendingEvent>({ ...event });

  const recalcEndTime = (time: string, durationH: number) => {
    const [h, m] = time.split(":").map(Number);
    const totalMin = h * 60 + m + durationH * 60;
    return `${String(Math.floor(totalMin / 60) % 24).padStart(2, "0")}:${String(totalMin % 60).padStart(2, "0")}`;
  };

  const handleTimeChange = (time: string) => {
    setForm(f => ({ ...f, time, endTime: recalcEndTime(time, f.durationH) }));
  };

  const handleDurationChange = (d: number) => {
    setForm(f => ({ ...f, durationH: d, endTime: recalcEndTime(f.time, d) }));
  };

  if (editing) {
    return (
      <div className="bg-zinc-800/80 border border-zinc-700 rounded-xl p-4 space-y-3 max-w-sm">
        <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Upraviť udalosť</div>

        <div>
          <label className="text-[10px] text-zinc-500 block mb-1">Názov</label>
          <input
            value={form.subject}
            onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-zinc-500 block mb-1">Dátum</label>
            <input
              type="date"
              value={form.date}
              onChange={e => {
                const d = new Date(e.target.value);
                const days = ["nedeľa","pondelok","utorok","streda","štvrtok","piatok","sobota"];
                setForm(f => ({ ...f, date: e.target.value, dayName: days[d.getDay()] || "" }));
              }}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="text-[10px] text-zinc-500 block mb-1">Čas</label>
            <input
              type="time"
              value={form.time}
              onChange={e => handleTimeChange(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div>
          <label className="text-[10px] text-zinc-500 block mb-1">Trvanie (hodiny)</label>
          <div className="flex gap-1.5">
            {[0.5, 1, 1.5, 2, 3].map(d => (
              <button
                key={d}
                onClick={() => handleDurationChange(d)}
                className={`flex-1 text-xs py-1.5 rounded-lg transition-colors ${
                  form.durationH === d ? "bg-blue-600 text-white" : "bg-zinc-900 text-zinc-400 hover:bg-zinc-700"
                }`}
              >
                {d}h
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[10px] text-zinc-500 block mb-1">Miesto</label>
          <input
            value={form.location}
            onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
            placeholder="Adresa alebo miesto"
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="text-[10px] text-zinc-500 block mb-1">Poznámka</label>
          <textarea
            value={form.body}
            onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
            rows={2}
            placeholder="Voliteľná poznámka..."
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 resize-none"
          />
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={() => { setEditing(false); onConfirm(form); }}
            disabled={disabled || !form.subject.trim()}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm py-2 rounded-lg transition-colors font-medium"
          >
            ✓ Vytvoriť
          </button>
          <button
            onClick={() => setEditing(false)}
            className="px-4 bg-zinc-700 hover:bg-zinc-600 text-sm py-2 rounded-lg transition-colors"
          >
            Späť
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-zinc-800/80 border border-zinc-700 rounded-xl p-4 space-y-2 max-w-sm">
      <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Nová udalosť</div>

      <div className="text-sm font-medium text-zinc-100">📅 {event.subject}</div>
      <div className="text-sm text-zinc-300">🗓 {event.date} ({event.dayName})</div>
      <div className="text-sm text-zinc-300">🕐 {event.time} – {event.endTime} ({event.durationH}h)</div>
      {event.location && <div className="text-sm text-zinc-300">📍 {event.location}</div>}
      {event.body && <div className="text-sm text-zinc-400">📝 {event.body}</div>}
      {event.attendees.length > 0 && <div className="text-sm text-zinc-400">👥 {event.attendees.join(", ")}</div>}

      <div className="flex gap-2 pt-2">
        <button
          onClick={() => onConfirm(event)}
          disabled={disabled}
          className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white text-sm py-2 rounded-lg transition-colors font-medium"
        >
          ✓ Potvrdiť
        </button>
        <button
          onClick={() => setEditing(true)}
          disabled={disabled}
          className="px-4 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-sm py-2 rounded-lg transition-colors"
        >
          ✏️ Upraviť
        </button>
        <button
          onClick={onCancel}
          disabled={disabled}
          className="px-4 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-red-400 text-sm py-2 rounded-lg transition-colors"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
