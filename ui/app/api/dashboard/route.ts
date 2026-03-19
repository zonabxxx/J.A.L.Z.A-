import { NextResponse } from "next/server";
import { backendPost, jalzaAIText } from "@/lib/api-client";

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

  let summary = "";
  try {
    const contextParts = [];
    if (calEvents.length > 0) contextParts.push(`Dnešné udalosti: ${JSON.stringify(calEvents).slice(0, 1000)}`);
    if (adsunEmails.length > 0) contextParts.push(`ADSUN emaily: ${adsunEmails.length} nových`);
    if (jurajEmails.length > 0) contextParts.push(`Juraj emaily: ${jurajEmails.length} nových`);
    if (activeTasks.length > 0) contextParts.push(`Aktívne úlohy: ${activeTasks.length}`);

    if (contextParts.length > 0) {
      summary = await jalzaAIText({
        messages: [{
          role: "user",
          content: `Si J.A.L.Z.A., osobný AI asistent. Vytvor stručný ranný prehľad pre Juraja (po slovensky, max 200 slov, markdown).\n\n${contextParts.join("\n")}\n\nFormát: krátke zhrnutie dňa, dôležité stretnutia, emaily, úlohy. Buď stručný a vecný.`,
        }],
        task_type: "summary",
        temperature: 0.5,
        max_tokens: 500,
      });
    }
  } catch {
    // no summary
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
