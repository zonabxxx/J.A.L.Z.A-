"use client";

export interface CalendarEvent {
  id: string;
  subject: string;
  start: string;
  end: string;
  is_all_day: boolean;
  location: string;
  organizer: string;
  organizer_email: string;
  attendees?: { name: string; email: string; status: string }[];
  preview?: string;
  body?: string;
  web_link?: string;
}

interface Props {
  events: CalendarEvent[];
  title?: string;
}

function formatTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleTimeString("sk-SK", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return dateStr?.slice(11, 16) || "";
  }
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return "dnes";
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (d.toDateString() === tomorrow.toDateString()) return "zajtra";
    return d.toLocaleDateString("sk-SK", { weekday: "short", day: "numeric", month: "short" });
  } catch {
    return dateStr?.slice(0, 10) || "";
  }
}

function getDayKey(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toISOString().slice(0, 10);
  } catch {
    return dateStr?.slice(0, 10) || "unknown";
  }
}

function getDayLabel(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return "Dnes";
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (d.toDateString() === tomorrow.toDateString()) return "Zajtra";
    return d.toLocaleDateString("sk-SK", { weekday: "long", day: "numeric", month: "long" });
  } catch {
    return dateStr || "";
  }
}

function getTimeColor(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    if (d < now) return "text-zinc-600";
    const diffH = (d.getTime() - now.getTime()) / 3600000;
    if (diffH < 1) return "text-red-400";
    if (diffH < 3) return "text-amber-400";
    return "text-blue-400";
  } catch {
    return "text-zinc-400";
  }
}

const EVENT_COLORS = [
  "border-l-blue-500", "border-l-emerald-500", "border-l-violet-500",
  "border-l-rose-500", "border-l-amber-500", "border-l-cyan-500",
];

function getEventColor(idx: number): string {
  return EVENT_COLORS[idx % EVENT_COLORS.length];
}

export default function CalendarCards({ events, title }: Props) {
  const grouped = new Map<string, CalendarEvent[]>();
  for (const ev of events) {
    const key = getDayKey(ev.start);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(ev);
  }

  return (
    <div className="space-y-3 w-full">
      {title && (
        <div className="text-[11px] text-zinc-500 font-medium flex items-center gap-1.5">
          <span>📅</span> {title} — {events.length} {events.length === 1 ? "udalosť" : "udalostí"}
        </div>
      )}

      {events.length === 0 ? (
        <div className="text-center py-6 text-zinc-500 text-sm">
          Žiadne udalosti v tomto období
        </div>
      ) : (
        Array.from(grouped.entries()).map(([dayKey, dayEvents]) => (
          <div key={dayKey} className="space-y-1.5">
            <div className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
              {getDayLabel(dayEvents[0].start)}
            </div>

            {dayEvents.map((ev, i) => (
              <div
                key={ev.id || i}
                className={`flex gap-3 p-3 rounded-xl bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-700/50 border-l-2 ${getEventColor(i)} transition-colors group`}
              >
                <div className="flex flex-col items-center min-w-[40px] flex-shrink-0">
                  {ev.is_all_day ? (
                    <span className="text-[11px] font-medium text-purple-400">
                      celý deň
                    </span>
                  ) : (
                    <>
                      <span className={`text-[13px] font-bold ${getTimeColor(ev.start)}`}>
                        {formatTime(ev.start)}
                      </span>
                      <span className="text-[10px] text-zinc-600">
                        {formatTime(ev.end)}
                      </span>
                    </>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-zinc-200 truncate">
                    {ev.subject}
                  </div>

                  {ev.location && (
                    <div className="text-[11px] text-zinc-500 flex items-center gap-1 mt-0.5">
                      <span>📍</span> {ev.location}
                    </div>
                  )}

                  {ev.attendees && ev.attendees.length > 0 && (
                    <div className="text-[10px] text-zinc-600 mt-0.5">
                      👥 {ev.attendees.map(a => a.name || a.email).join(", ")}
                    </div>
                  )}

                  {ev.preview && (
                    <div className="text-[10px] text-zinc-600 mt-0.5 truncate">
                      {ev.preview.slice(0, 100)}
                    </div>
                  )}
                </div>

                <div className="flex items-center">
                  <span className="text-[10px] text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity">
                    {formatDate(ev.start)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ))
      )}

      <div className="text-[10px] text-zinc-600 mt-2">
        <span className="text-zinc-400">&quot;vytvor stretnutie zajtra o 10:00&quot;</span> · <span className="text-zinc-400">&quot;čo mám dnes&quot;</span> · <span className="text-zinc-400">&quot;zruš stretnutie&quot;</span>
      </div>
    </div>
  );
}
