"use client";
import { useState } from "react";
import type { EmailData } from "@/lib/hooks";
import { useMailboxes } from "@/lib/mailboxes";

interface Props {
  emails: EmailData[];
  mailbox?: string;
  onMailboxChange?: (mailbox: string) => void;
  onReadEmail?: (index: number) => void;
}

function getInitials(from: string): string {
  const name = from.replace(/<.*>/, "").trim();
  const parts = name.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function getColor(from: string): string {
  const colors = [
    "bg-blue-600", "bg-emerald-600", "bg-violet-600", "bg-rose-600",
    "bg-amber-600", "bg-cyan-600", "bg-pink-600", "bg-indigo-600",
  ];
  let hash = 0;
  for (let i = 0; i < from.length; i++) hash = from.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 60) return `${diffMins}m`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h`;
    if (d.toDateString() === now.toDateString()) return "dnes";
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return "včera";
    return d.toLocaleDateString("sk-SK", { day: "numeric", month: "short" });
  } catch {
    return dateStr?.slice(0, 10) || "";
  }
}

function extractEmail(from: string): string {
  const match = from.match(/<(.+?)>/);
  return match ? match[1] : from;
}

function extractName(from: string): string {
  const name = from.replace(/<.*>/, "").replace(/"/g, "").trim();
  return name || extractEmail(from);
}

export default function EmailCards({ emails, mailbox, onMailboxChange, onReadEmail }: Props) {
  const MAILBOXES = useMailboxes();
  const [activeMailbox, setActiveMailbox] = useState(mailbox || MAILBOXES[0]?.id || "personal");
  const currentMb = MAILBOXES.find(m => m.id === activeMailbox) || MAILBOXES[0];

  const handleSwitch = (mbId: string) => {
    setActiveMailbox(mbId);
    onMailboxChange?.(mbId);
  };

  return (
    <div className="space-y-2 w-full">
      {/* Mailbox tabs */}
      {onMailboxChange && (
        <div className="flex gap-1 mb-2">
          {MAILBOXES.map(mb => (
            <button
              key={mb.id}
              onClick={() => handleSwitch(mb.id)}
              className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg transition-colors ${
                activeMailbox === mb.id
                  ? "bg-blue-600/20 text-blue-400 border border-blue-500/30"
                  : "bg-zinc-800 text-zinc-500 hover:text-zinc-300 border border-zinc-700/50"
              }`}
            >
              <span>{mb.icon}</span>
              <span>{mb.label}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-[11px] text-zinc-500 font-medium">
          {currentMb.icon} {currentMb.email} — {emails.length} {emails.length === 1 ? "email" : "emailov"}
        </span>
      </div>

      {emails.length === 0 ? (
        <div className="text-center py-6 text-zinc-500 text-sm">
          Žiadne emaily v tejto schránke
        </div>
      ) : (
        <div className="space-y-1.5">
          {emails.map((email, i) => (
            <div
              key={email.id || i}
              onClick={() => onReadEmail?.(i + 1)}
              className={`flex gap-3 p-3 rounded-xl border transition-all group ${
                onReadEmail ? "cursor-pointer active:scale-[0.98]" : "cursor-default"
              } ${
                email.unread
                  ? "bg-zinc-800/80 border-blue-500/20 hover:bg-zinc-700/80"
                  : "bg-zinc-800/40 border-zinc-700/30 hover:bg-zinc-700/50"
              }`}
            >
              <div
                className={`w-9 h-9 rounded-full ${getColor(email.from)} flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0 mt-0.5`}
              >
                {getInitials(email.from)}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-[13px] truncate ${email.unread ? "font-semibold text-zinc-100" : "font-medium text-zinc-300"}`}>
                    {extractName(email.from)}
                  </span>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {email.unread && (
                      <span className="w-2 h-2 rounded-full bg-blue-500" />
                    )}
                    <span className="text-[10px] text-zinc-500">
                      {formatDate(email.date)}
                    </span>
                  </div>
                </div>

                <div className={`text-[12px] truncate mt-0.5 ${email.unread ? "font-medium text-zinc-200" : "text-zinc-400"}`}>
                  {email.subject || "(bez predmetu)"}
                </div>

                {email.snippet && (
                  <div className="text-[11px] text-zinc-500 truncate mt-0.5 leading-relaxed">
                    {email.snippet.slice(0, 120)}
                  </div>
                )}

                <div className="text-[10px] text-zinc-600 mt-1">
                  {extractEmail(email.from)}
                </div>
              </div>

              <div className="flex flex-col items-center justify-center gap-1 flex-shrink-0">
                <span className="text-[10px] bg-zinc-700/60 text-zinc-500 px-1.5 py-0.5 rounded group-hover:bg-zinc-600 group-hover:text-zinc-300 transition-colors">
                  #{i + 1}
                </span>
                {onReadEmail && (
                  <svg className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="text-[10px] text-zinc-600 mt-2 space-y-0.5">
        <div>
          <span className="text-zinc-400">&quot;prečítaj mail 3&quot;</span> · <span className="text-zinc-400">&quot;odpovedz na 1&quot;</span> · <span className="text-zinc-400">&quot;hľadaj faktúra&quot;</span> · <span className="text-zinc-400">&quot;adsun maily&quot;</span> · <span className="text-zinc-400">&quot;juraj maily&quot;</span>
        </div>
      </div>
    </div>
  );
}
