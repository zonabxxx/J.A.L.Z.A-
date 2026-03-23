import { NextRequest } from "next/server";
import { backendGet, backendPost } from "@/lib/api-client";

export async function GET() {
  try {
    const res = await backendGet("/agents", 15_000);
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
      const res = await backendPost("/addagent", body);
      return Response.json(await res.json());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      return Response.json({ error: msg }, { status: 500 });
    }
  }

  if (action === "learn") {
    try {
      const res = await backendPost("/learn", { agent: body.agent });
      return Response.json(await res.json());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      return Response.json({ error: msg }, { status: 500 });
    }
  }

  if (action === "refresh") {
    try {
      const res = await backendPost("/refresh", { agent: body.agent });
      return Response.json(await res.json());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      return Response.json({ error: msg }, { status: 500 });
    }
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
