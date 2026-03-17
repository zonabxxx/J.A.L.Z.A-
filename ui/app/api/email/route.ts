import { NextRequest } from "next/server";
import { backendPost } from "@/lib/api-client";

async function safeJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    if (text.includes("<!DOCTYPE") || text.includes("<html")) {
      return { error: "Backend vrátil HTML – tunnel pravdepodobne nebeží alebo je nedostupný." };
    }
    return { error: `Neplatná odpoveď z backendu: ${text.slice(0, 200)}` };
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const todayOnly = searchParams.get("today") === "true";
  const limit = parseInt(searchParams.get("limit") || "20");
  const mailbox = searchParams.get("mailbox") || "personal";

  try {
    let endpoint = "/email/check";
    const payload: Record<string, unknown> = { today_only: todayOnly, limit };

    if (mailbox === "adsun") {
      endpoint = "/email/adsun/list";
      payload.unseen_only = !todayOnly;
      payload.today_only = todayOnly;
    } else if (mailbox === "juraj") {
      endpoint = "/email/juraj/list";
      payload.unseen_only = !todayOnly;
      payload.today_only = todayOnly;
    }

    const res = await backendPost(endpoint, payload);
    const data = await safeJson(res);

    if (!res.ok && !data.error) {
      data.error = `Backend HTTP ${res.status}`;
    }

    return Response.json(data, { status: data.error ? 502 : 200 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: `Pripojenie zlyhalo: ${msg}` }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action, mailbox = "personal" } = body;

  try {
    if (action === "send") {
      let endpoint = "/email/send";
      if (mailbox === "adsun") endpoint = "/email/adsun/send";
      else if (mailbox === "juraj") endpoint = "/email/juraj/send";

      const res = await backendPost(endpoint, {
        to: body.to,
        subject: body.subject,
        body: body.body,
      });
      return Response.json(await safeJson(res));
    }

    if (action === "reply") {
      let endpoint = "/email/adsun/reply";
      if (mailbox === "juraj") endpoint = "/email/juraj/reply";

      const res = await backendPost(endpoint, {
        id: body.id,
        body: body.body,
      });
      return Response.json(await safeJson(res));
    }

    if (action === "read") {
      let endpoint = "/email/adsun/read";
      if (mailbox === "juraj") endpoint = "/email/juraj/read";

      const res = await backendPost(endpoint, { id: body.id });
      return Response.json(await safeJson(res));
    }

    if (action === "search") {
      let endpoint = "/email/adsun/search";
      if (mailbox === "juraj") endpoint = "/email/juraj/search";

      const res = await backendPost(endpoint, {
        query: body.query,
        limit: body.limit || 10,
      });
      return Response.json(await safeJson(res));
    }

    if (action === "cleanup") {
      const res = await backendPost("/email/cleanup", {
        dry_run: body.dry_run ?? true,
      });
      return Response.json(await safeJson(res));
    }

    if (action === "cleanup_execute") {
      const res = await backendPost("/email/cleanup", { dry_run: false });
      return Response.json(await safeJson(res));
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: `Pripojenie zlyhalo: ${msg}` }, { status: 500 });
  }
}
