"use client";
import { useEffect, useState, useCallback } from "react";

interface CalendarEvent {
  id: string;
  subject: string;
  start: string;
  end: string;
  location: string;
  is_all_day: boolean;
  organizer: string;
  preview?: string;
  attendees?: { name: string; email: string; status: string }[];
  web_link?: string;
}

type View = "today" | "week";

interface Props {
  onMenuToggle?: () => void;
  onBack?: () => void;
}

export default function CalendarPanel({ onMenuToggle, onBack }: Props) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("week");
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/calendar?view=${view}&account=juraj`);
      const text = await res.text();
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(text);
      } catch {
        setError("Neplatná odpoveď z backendu.");
        setEvents([]);
        return;
      }
      if (data.error) {
        setError(data.error as string);
        setEvents([]);
      } else if (Array.isArray(data)) {
        setEvents(data as CalendarEvent[]);
      } else if (data.events && Array.isArray(data.events)) {
        setEvents(data.events as CalendarEvent[]);
      } else {
        setEvents([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nepodarilo sa načítať kalendár");
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [view]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const formatTime = (dateStr: string) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    const days = ["Ne", "Po", "Ut", "St", "Št", "Pi", "So"];
    return `${days[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`;
  };

  const groupByDate = (evts: CalendarEvent[]) => {
    const groups: Record<string, CalendarEvent[]> = {};
    for (const evt of evts) {
      const dateKey = evt.start?.slice(0, 10) || "unknown";
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(evt);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  };

  const isToday = (dateKey: string) => {
    return dateKey === new Date().toISOString().slice(0, 10);
  };

  if (selectedEvent) {
    return (
      <div className="flex-1 flex flex-col h-[100dvh] md:h-full overflow-hidden">
        <header className="flex items-center gap-3 px-4 md:px-6 py-3 border-b bg-zinc-900/50 safe-top">
          <button
            onClick={() => setSelectedEvent(null)}
            className="text-zinc-400 hover:text-zinc-200 p-1 -ml-1"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-sm truncate">{selectedEvent.subject}</h2>
            <p className="text-xs text-zinc-500">
              {formatDate(selectedEvent.start)} · {formatTime(selectedEvent.start)} – {formatTime(selectedEvent.end)}
            </p>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-4">
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <span className="text-zinc-500 mt-0.5">📅</span>
              <div>
                <div className="text-sm font-medium">{selectedEvent.subject}</div>
                <div className="text-xs text-zinc-500">{selectedEvent.is_all_day ? "Celý deň" : `${formatTime(selectedEvent.start)} – ${formatTime(selectedEvent.end)}`}</div>
              </div>
            </div>
            {selectedEvent.location && (
              <div className="flex items-start gap-3">
                <span className="text-zinc-500 mt-0.5">📍</span>
                <div className="text-sm text-zinc-300">{selectedEvent.location}</div>
              </div>
            )}
            {selectedEvent.organizer && (
              <div className="flex items-start gap-3">
                <span className="text-zinc-500 mt-0.5">👤</span>
                <div className="text-sm text-zinc-300">{selectedEvent.organizer}</div>
              </div>
            )}
            {selectedEvent.attendees && selectedEvent.attendees.length > 0 && (
              <div className="flex items-start gap-3">
                <span className="text-zinc-500 mt-0.5">👥</span>
                <div className="space-y-1">
                  {selectedEvent.attendees.map((a, i) => (
                    <div key={i} className="text-sm text-zinc-300">
                      {a.name || a.email}
                      <span className="text-[10px] text-zinc-500 ml-1.5">
                        {a.status === "accepted" ? "✓" : a.status === "declined" ? "✕" : "?"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {selectedEvent.preview && (
              <div className="flex items-start gap-3">
                <span className="text-zinc-500 mt-0.5">📝</span>
                <div className="text-sm text-zinc-400 whitespace-pre-wrap">{selectedEvent.preview}</div>
              </div>
            )}
          </div>
          {selectedEvent.web_link && (
            <a
              href={selectedEvent.web_link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-xs text-blue-400 hover:text-blue-300 mt-4"
            >
              Otvoriť v Outlooku →
            </a>
          )}
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
            <h2 className="font-semibold text-sm">Kalendár</h2>
            <p className="text-[10px] text-zinc-500">{events.length} udalostí · juraj@adsun.sk</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex bg-zinc-800 rounded-lg p-0.5">
            {(["today", "week"] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                  view === v ? "bg-blue-600 text-white" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {v === "today" ? "Dnes" : "Týždeň"}
              </button>
            ))}
          </div>
          <button
            onClick={loadEvents}
            disabled={loading}
            className="text-zinc-500 hover:text-zinc-300 transition-colors text-sm p-1.5"
            title="Obnoviť"
          >
            ↻
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-red-600/10 border border-red-600/20 text-red-400 text-xs">
            {error}
          </div>
        )}
        {loading && events.length === 0 ? (
          <div className="flex items-center justify-center h-full text-zinc-500">
            <div className="text-center">
              <div className="animate-spin w-8 h-8 border-2 border-zinc-600 border-t-blue-500 rounded-full mx-auto mb-3" />
              <p className="text-sm">Načítavam kalendár...</p>
            </div>
          </div>
        ) : events.length === 0 && !error ? (
          <div className="flex items-center justify-center h-full text-zinc-500">
            <div className="text-center">
              <div className="text-3xl mb-3">📅</div>
              <p className="text-sm">Žiadne udalosti</p>
              <p className="text-xs text-zinc-600 mt-1">{view === "today" ? "Dnes nemáš nič v kalendári" : "Tento týždeň je voľno"}</p>
            </div>
          </div>
        ) : (
          <div className="py-2">
            {groupByDate(events).map(([dateKey, dayEvents]) => (
              <div key={dateKey} className="mb-1">
                <div className={`sticky top-0 z-10 px-4 md:px-6 py-1.5 text-xs font-semibold uppercase tracking-wider ${
                  isToday(dateKey)
                    ? "text-blue-400 bg-blue-600/5"
                    : "text-zinc-500 bg-zinc-900/80"
                }`}>
                  {isToday(dateKey) ? `Dnes · ${formatDate(dateKey)}` : formatDate(dateKey)}
                </div>
                {dayEvents.map((evt) => (
                  <button
                    key={evt.id}
                    onClick={() => setSelectedEvent(evt)}
                    className="w-full text-left px-4 md:px-6 py-3 hover:bg-zinc-800/40 transition-colors active:bg-zinc-800/60 border-l-2 border-transparent hover:border-blue-500"
                  >
                    <div className="flex items-start gap-3">
                      <div className="text-xs text-zinc-500 font-mono w-12 flex-shrink-0 pt-0.5">
                        {evt.is_all_day ? "celý" : formatTime(evt.start)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-zinc-200 truncate">{evt.subject}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {!evt.is_all_day && (
                            <span className="text-[10px] text-zinc-500">
                              {formatTime(evt.start)} – {formatTime(evt.end)}
                            </span>
                          )}
                          {evt.location && (
                            <span className="text-[10px] text-zinc-500 truncate">📍 {evt.location}</span>
                          )}
                        </div>
                      </div>
                      <svg className="w-4 h-4 text-zinc-600 flex-shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
