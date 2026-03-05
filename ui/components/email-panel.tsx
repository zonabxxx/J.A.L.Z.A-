"use client";
import { useEffect, useState, useCallback } from "react";
import type { Email } from "@/lib/types";

export default function EmailPanel() {
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(false);
  const [todayOnly, setTodayOnly] = useState(true);
  const [cleanupStats, setCleanupStats] = useState<{
    marketing_found: number;
    old_found: number;
    deleted: number;
    dry_run: boolean;
  } | null>(null);
  const [cleaningUp, setCleaningUp] = useState(false);

  const loadEmails = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/email?today=${todayOnly}&limit=20`
      );
      const data = await res.json();
      if (data.emails) setEmails(data.emails);
      else if (data.error) setEmails([]);
    } catch {
      setEmails([]);
    } finally {
      setLoading(false);
    }
  }, [todayOnly]);

  useEffect(() => {
    loadEmails();
  }, [loadEmails]);

  const handleCleanup = async (dryRun: boolean) => {
    setCleaningUp(true);
    try {
      const res = await fetch("/api/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cleanup", dry_run: dryRun }),
      });
      const data = await res.json();
      setCleanupStats(data);
      if (!dryRun) loadEmails();
    } catch {
      // error
    } finally {
      setCleaningUp(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full">
      <header className="flex items-center justify-between px-6 py-3 border-b bg-zinc-900/50">
        <div>
          <h2 className="font-semibold">Email</h2>
          <p className="text-xs text-zinc-500">
            {emails.length} emailov · {todayOnly ? "dnes" : "neprečítané"}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setTodayOnly(!todayOnly)}
            className="text-xs text-zinc-400 hover:text-zinc-200 px-3 py-1.5 rounded hover:bg-zinc-800 transition-colors"
          >
            {todayOnly ? "Všetky neprečítané" : "Len dnes"}
          </button>
          <button
            onClick={loadEmails}
            disabled={loading}
            className="text-xs text-zinc-400 hover:text-zinc-200 px-3 py-1.5 rounded hover:bg-zinc-800 transition-colors"
          >
            {loading ? "Načítavam..." : "Obnoviť"}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {loading && emails.length === 0 ? (
          <div className="flex items-center justify-center h-full text-zinc-500">
            <div className="text-center">
              <div className="animate-spin w-8 h-8 border-2 border-zinc-600 border-t-blue-500 rounded-full mx-auto mb-3" />
              <p>Načítavam emaily...</p>
            </div>
          </div>
        ) : emails.length === 0 ? (
          <div className="flex items-center justify-center h-full text-zinc-500">
            <p>Žiadne emaily</p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-800">
            {emails.map((email, i) => (
              <div
                key={i}
                className="px-6 py-3 hover:bg-zinc-900/50 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-medium text-sm truncate">
                        {email.sender}
                      </span>
                      <span className="text-[10px] text-zinc-600 shrink-0">
                        {email.date}
                      </span>
                    </div>
                    <div className="text-sm text-zinc-300 truncate">
                      {email.subject}
                    </div>
                    <div className="text-xs text-zinc-500 mt-1 line-clamp-2">
                      {email.body}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t px-6 py-3 bg-zinc-900/50">
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleCleanup(true)}
            disabled={cleaningUp}
            className="text-xs px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors disabled:opacity-50"
          >
            {cleaningUp ? "Skenujem..." : "Skenovať spam"}
          </button>
          {cleanupStats && (
            <>
              <span className="text-xs text-zinc-500">
                Marketing: {cleanupStats.marketing_found} · Staré:{" "}
                {cleanupStats.old_found}
              </span>
              {(cleanupStats.marketing_found > 0 ||
                cleanupStats.old_found > 0) &&
                cleanupStats.dry_run && (
                  <button
                    onClick={() => handleCleanup(false)}
                    disabled={cleaningUp}
                    className="text-xs px-3 py-1.5 rounded bg-red-600/20 hover:bg-red-600/30 text-red-400 transition-colors disabled:opacity-50"
                  >
                    Vymazať {cleanupStats.marketing_found + cleanupStats.old_found}
                  </button>
                )}
              {cleanupStats.dry_run === false && (
                <span className="text-xs text-green-400">
                  Vymazaných: {cleanupStats.deleted}
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
