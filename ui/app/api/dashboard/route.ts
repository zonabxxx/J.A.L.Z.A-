import { NextResponse } from "next/server";
import { backendPost } from "@/lib/api-client";
import { GEMINI_API_KEY } from "@/lib/config";

export async function GET() {
  const results: Record<string, unknown> = {};

  const fetches = [
    backendPost("/calendar/today", {}).then(async (r) => {
      if (r.ok) results.calendar = await r.json();
    }).catch(() => {}),

    backendPost("/email/adsun/list", { count: 5 }).then(async (r) => {
      if (r.ok) results.emails_adsun = await r.json();
    }).catch(() => {}),

    backendPost("/email/juraj/list", { count: 5 }).then(async (r) => {
      if (r.ok) results.emails_juraj = await r.json();
    }).catch(() => {}),

    backendPost("/tasks", { action: "list" }).then(async (r) => {
      if (r.ok) {
        const d = await r.json();
        results.tasks = d.tasks?.filter((t: { enabled: boolean }) => t.enabled) || [];
      }
    }).catch(() => {}),

    backendPost("/tasks", { action: "results", limit: 5 }).then(async (r) => {
      if (r.ok) results.task_results = await r.json();
    }).catch(() => {}),

    backendPost("/facts", { action: "list", limit: 10 }).then(async (r) => {
      if (r.ok) results.recent_facts = await r.json();
    }).catch(() => {}),
  ];

  await Promise.allSettled(fetches);

  const calEvents = (results.calendar as { events?: unknown[] })?.events || [];
  const adsunEmails = (results.emails_adsun as { emails?: unknown[] })?.emails || [];
  const jurajEmails = (results.emails_juraj as { emails?: unknown[] })?.emails || [];
  const activeTasks = (results.tasks as unknown[]) || [];

  // Generate summary with Gemini
  let summary = "";
  if (GEMINI_API_KEY) {
    try {
      const contextParts = [];
      if (calEvents.length > 0) contextParts.push(`Dnešné udalosti: ${JSON.stringify(calEvents).slice(0, 1000)}`);
      if (adsunEmails.length > 0) contextParts.push(`ADSUN emaily: ${adsunEmails.length} nových`);
      if (jurajEmails.length > 0) contextParts.push(`Juraj emaily: ${jurajEmails.length} nových`);
      if (activeTasks.length > 0) contextParts.push(`Aktívne úlohy: ${activeTasks.length}`);

      if (contextParts.length > 0) {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{
                parts: [{
                  text: `Si J.A.L.Z.A., osobný AI asistent. Vytvor stručný ranný prehľad pre Juraja (po slovensky, max 200 slov, markdown).

${contextParts.join("\n")}

Formát: krátke zhrnutie dňa, dôležité stretnutia, emaily, úlohy. Buď stručný a vecný.`,
                }],
              }],
              generationConfig: { temperature: 0.5, maxOutputTokens: 500 },
            }),
            signal: AbortSignal.timeout(15000),
          }
        );
        if (res.ok) {
          const data = await res.json();
          summary = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        }
      }
    } catch {
      // no summary
    }
  }

  return NextResponse.json({
    date: new Date().toLocaleDateString("sk-SK", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
    calendar_events: calEvents.length,
    emails_adsun: adsunEmails.length,
    emails_juraj: jurajEmails.length,
    active_tasks: activeTasks.length,
    summary,
    calendar: calEvents,
    emails: { adsun: adsunEmails.slice(0, 3), juraj: jurajEmails.slice(0, 3) },
    tasks: activeTasks,
  });
}
