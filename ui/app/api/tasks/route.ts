import { NextRequest } from "next/server";
import { backendPost } from "@/lib/api-client";

const QUICK_TIMEOUT = 15_000;
const LONG_TIMEOUT = 120_000;

export async function GET() {
  try {
    const res = await backendPost("/tasks", { action: "list" }, QUICK_TIMEOUT);
    return Response.json(await res.json());
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: msg, tasks: [] }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const isLongRunning = body.action === "run";
  const timeout = isLongRunning ? LONG_TIMEOUT : QUICK_TIMEOUT;

  try {
    const res = await backendPost("/tasks", body, timeout);
    const data = await res.json();
    return Response.json(data, { status: res.ok ? 200 : res.status });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: msg }, { status: 500 });
  }
}
