import { NextRequest } from "next/server";
import { KNOWLEDGE_API_URL } from "@/lib/config";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const todayOnly = searchParams.get("today") === "true";
  const limit = parseInt(searchParams.get("limit") || "20");

  try {
    const res = await fetch(`${KNOWLEDGE_API_URL}/email/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ today_only: todayOnly, limit }),
    });
    return Response.json(await res.json());
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: msg }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action } = body;

  if (action === "send") {
    try {
      const res = await fetch(`${KNOWLEDGE_API_URL}/email/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: body.to,
          subject: body.subject,
          body: body.body,
        }),
      });
      return Response.json(await res.json());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      return Response.json({ error: msg }, { status: 500 });
    }
  }

  if (action === "cleanup") {
    try {
      const res = await fetch(`${KNOWLEDGE_API_URL}/email/cleanup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dry_run: body.dry_run ?? true }),
      });
      return Response.json(await res.json());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      return Response.json({ error: msg }, { status: 500 });
    }
  }

  if (action === "delete") {
    try {
      const res = await fetch(`${KNOWLEDGE_API_URL}/email/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: body.sender,
          subject: body.subject,
        }),
      });
      return Response.json(await res.json());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      return Response.json({ error: msg }, { status: 500 });
    }
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
