"use client";
import { useEffect, useState, useCallback } from "react";
import type { Email } from "@/lib/types";
import { useMailboxes, type Mailbox } from "@/lib/mailboxes";

interface Props {
  onMenuToggle?: () => void;
  onBack?: () => void;
}

export default function EmailPanel({ onMenuToggle, onBack }: Props) {
  const mailboxes = useMailboxes();
  const [activeMailbox, setActiveMailbox] = useState<string>("adsun");
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [todayOnly, setTodayOnly] = useState(true);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [emailDetail, setEmailDetail] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [cleanupStats, setCleanupStats] = useState<{
    marketing_found: number;
    old_found: number;
    deleted: number;
    dry_run: boolean;
  } | null>(null);
  const [cleaningUp, setCleaningUp] = useState(false);

  const currentMb: Mailbox | undefined = mailboxes.find(m => m.id === activeMailbox);

  const loadEmails = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/email?today=${todayOnly}&limit=30&mailbox=${activeMailbox}`
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        setEmails([]);
      } else if (data.emails) {
        setEmails(data.emails);
      } else if (data.error) {
        setError(data.error);
        setEmails([]);
      } else {
        setEmails([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nepodarilo sa načítať emaily");
      setEmails([]);
    } finally {
      setLoading(false);
    }
  }, [todayOnly, activeMailbox]);

  useEffect(() => {
    loadEmails();
  }, [loadEmails]);

  const openEmail = async (email: Email) => {
    setSelectedEmail(email);
    setEmailDetail(null);
    setLoadingDetail(true);
    try {
      const res = await fetch("/api/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "read", id: email.id, mailbox: activeMailbox }),
      });
      const data = await res.json();
      const body = data.body || data.text || email.body || "";

      const summaryRes = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: body,
          systemPrompt: `Si asistent. Dostal si obsah emailu. Urob stručné, prehľadné zhrnutie po slovensky. Na konci navrhni 2-3 možné akcie (odpoveď, preposlanie, archivácia).`,
        }),
      });
      const summaryData = await summaryRes.json();
      setEmailDetail(summaryData.text || body);
    } catch {
      setEmailDetail(email.body || "Nepodarilo sa načítať detail emailu.");
    } finally {
      setLoadingDetail(false);
    }
  };

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
      // silently fail
    } finally {
      setCleaningUp(false);
    }
  };

  if (selectedEmail) {
    return (
      <div className="flex-1 flex flex-col h-[100dvh] md:h-full overflow-hidden">
        <header className="flex items-center gap-3 px-4 md:px-6 py-3 border-b bg-zinc-900/50 safe-top">
          <button
            onClick={() => setSelectedEmail(null)}
            className="text-zinc-400 hover:text-zinc-200 p-1 -ml-1"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-sm truncate">{selectedEmail.subject || "(bez predmetu)"}</h2>
            <p className="text-xs text-zinc-500 truncate">{selectedEmail.sender} · {selectedEmail.date}</p>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4">
          {loadingDetail ? (
            <div className="flex items-center justify-center py-12 text-zinc-500">
              <div className="text-center">
                <div className="animate-spin w-8 h-8 border-2 border-zinc-600 border-t-blue-500 rounded-full mx-auto mb-3" />
                <p className="text-sm">Sumarizujem email...</p>
              </div>
            </div>
          ) : (
            <div className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
              {emailDetail}
            </div>
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
            <button
              onClick={onMenuToggle}
              className="md:hidden text-zinc-400 hover:text-zinc-200 p-1 -ml-1"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </button>
          )}
          {onBack && (
            <button
              onClick={onBack}
              className="md:hidden text-zinc-400 hover:text-zinc-200 p-1"
              title="Späť na chat"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <div>
            <h2 className="font-semibold text-sm">Email</h2>
            <p className="text-[10px] text-zinc-500">
              {emails.length} emailov · {todayOnly ? "dnes" : "neprečítané"}
            </p>
          </div>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={() => setTodayOnly(!todayOnly)}
            className="text-[10px] text-zinc-400 hover:text-zinc-200 px-2 py-1.5 rounded hover:bg-zinc-800 transition-colors"
          >
            {todayOnly ? "Všetky" : "Dnes"}
          </button>
          <button
            onClick={loadEmails}
            disabled={loading}
            className="text-[10px] text-zinc-400 hover:text-zinc-200 px-2 py-1.5 rounded hover:bg-zinc-800 transition-colors"
          >
            {loading ? "..." : "Obnoviť"}
          </button>
        </div>
      </header>

      {/* Mailbox tabs */}
      <div className="flex border-b border-zinc-800 bg-zinc-900/30 px-2 overflow-x-auto">
        {mailboxes.map((mb) => (
          <button
            key={mb.id}
            onClick={() => setActiveMailbox(mb.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs whitespace-nowrap transition-colors border-b-2 ${
              activeMailbox === mb.id
                ? "text-blue-400 border-blue-400"
                : "text-zinc-500 border-transparent hover:text-zinc-300"
            }`}
          >
            <span>{mb.icon}</span>
            <span>{mb.label}</span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-red-600/10 border border-red-600/20 text-red-400 text-xs">
            {error}
          </div>
        )}
        {loading && emails.length === 0 ? (
          <div className="flex items-center justify-center h-full text-zinc-500">
            <div className="text-center">
              <div className="animate-spin w-8 h-8 border-2 border-zinc-600 border-t-blue-500 rounded-full mx-auto mb-3" />
              <p className="text-sm">Načítavam z {currentMb?.email || activeMailbox}...</p>
            </div>
          </div>
        ) : emails.length === 0 && !error ? (
          <div className="flex items-center justify-center h-full text-zinc-500">
            <div className="text-center">
              <p className="text-sm">Žiadne emaily</p>
              <p className="text-xs text-zinc-600 mt-1">{currentMb?.email}</p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/60">
            {emails.map((email, i) => (
              <button
                key={email.id || i}
                onClick={() => openEmail(email)}
                className="w-full text-left px-4 md:px-6 py-3 hover:bg-zinc-800/40 transition-colors active:bg-zinc-800/60"
              >
                <div className="flex items-start justify-between gap-2">
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
                      {email.subject || "(bez predmetu)"}
                    </div>
                    <div className="text-xs text-zinc-500 mt-1 line-clamp-2">
                      {email.body}
                    </div>
                  </div>
                  <svg className="w-4 h-4 text-zinc-600 flex-shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="border-t px-4 md:px-6 py-3 bg-zinc-900/50">
        <div className="flex items-center gap-2 flex-wrap">
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
                Marketing: {cleanupStats.marketing_found} · Staré: {cleanupStats.old_found}
              </span>
              {(cleanupStats.marketing_found > 0 || cleanupStats.old_found > 0) && cleanupStats.dry_run && (
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
