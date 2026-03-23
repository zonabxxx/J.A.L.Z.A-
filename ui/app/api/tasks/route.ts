import { NextRequest } from "next/server";
import { backendPost } from "@/lib/api-client";
import { KNOWLEDGE_API_URL } from "@/lib/config";

export async function GET() {
  try {
    const res = await backendPost("/tasks", { action: "list" });
    return Response.json(await res.json());
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error(`[tasks GET] Backend error (${KNOWLEDGE_API_URL}):`, msg);
    return Response.json({ error: msg, tasks: [] }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  try {
    const res = await backendPost("/tasks", body);
    const data = await res.json();
    if (!res.ok) {
      console.error(`[tasks POST] Backend returned ${res.status}:`, data);
    }
    return Response.json(data, { status: res.ok ? 200 : res.status });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error(`[tasks POST] Backend error (${KNOWLEDGE_API_URL}):`, msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
