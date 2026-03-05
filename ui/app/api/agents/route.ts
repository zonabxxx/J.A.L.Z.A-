import { NextRequest } from "next/server";
import { KNOWLEDGE_API_URL } from "@/lib/config";

export async function GET() {
  try {
    const res = await fetch(`${KNOWLEDGE_API_URL}/agents`);
    const data = await res.json();
    return Response.json(data);
  } catch {
    return Response.json({}, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action } = body;

  if (action === "create") {
    try {
      const res = await fetch(`${KNOWLEDGE_API_URL}/addagent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return Response.json(await res.json());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      return Response.json({ error: msg }, { status: 500 });
    }
  }

  if (action === "learn") {
    try {
      const res = await fetch(`${KNOWLEDGE_API_URL}/learn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: body.agent }),
      });
      return Response.json(await res.json());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      return Response.json({ error: msg }, { status: 500 });
    }
  }

  if (action === "refresh") {
    try {
      const res = await fetch(`${KNOWLEDGE_API_URL}/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: body.agent }),
      });
      return Response.json(await res.json());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      return Response.json({ error: msg }, { status: 500 });
    }
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
