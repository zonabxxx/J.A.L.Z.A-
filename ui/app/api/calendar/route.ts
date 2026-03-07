import { NextRequest } from "next/server";
import { backendPost } from "@/lib/api-client";

async function safeJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    if (text.includes("<!DOCTYPE") || text.includes("<html")) {
      return { error: "Backend vrátil HTML – tunnel pravdepodobne nebeží." };
    }
    return { error: `Neplatná odpoveď: ${text.slice(0, 200)}` };
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const view = searchParams.get("view") || "week";
  const account = searchParams.get("account") || "juraj";

  try {
    const endpoint = view === "today" ? "/calendar/today" : "/calendar/week";
    const res = await backendPost(endpoint, { account });
    const data = await safeJson(res);
    if (!res.ok && !data.error) data.error = `Backend HTTP ${res.status}`;
    return Response.json(data, { status: data.error ? 502 : 200 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: `Pripojenie zlyhalo: ${msg}` }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action, account = "juraj" } = body;

  try {
    if (action === "list") {
      const res = await backendPost("/calendar/list", { account, start: body.start, end: body.end, limit: body.limit || 20 });
      return Response.json(await safeJson(res));
    }
    if (action === "today") {
      const res = await backendPost("/calendar/today", { account });
      return Response.json(await safeJson(res));
    }
    if (action === "week") {
      const res = await backendPost("/calendar/week", { account });
      return Response.json(await safeJson(res));
    }
    if (action === "get") {
      const res = await backendPost("/calendar/get", { id: body.id, account });
      return Response.json(await safeJson(res));
    }
    if (action === "create") {
      const res = await backendPost("/calendar/create", {
        subject: body.subject, start: body.start, end: body.end, account,
        location: body.location || "", body: body.body || "",
        attendees: body.attendees, is_all_day: body.is_all_day || false,
      });
      return Response.json(await safeJson(res));
    }
    if (action === "update") {
      const res = await backendPost("/calendar/update", { id: body.id, updates: body.updates, account });
      return Response.json(await safeJson(res));
    }
    if (action === "delete") {
      const res = await backendPost("/calendar/delete", { id: body.id, account });
      return Response.json(await safeJson(res));
    }
    if (action === "search") {
      const res = await backendPost("/calendar/search", { query: body.query, account, limit: body.limit || 10 });
      return Response.json(await safeJson(res));
    }
    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: `Pripojenie zlyhalo: ${msg}` }, { status: 500 });
  }
}
