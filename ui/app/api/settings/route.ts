import { NextRequest } from "next/server";
import { KNOWLEDGE_API_URL } from "@/lib/config";

export async function GET() {
  try {
    const res = await fetch(`${KNOWLEDGE_API_URL}/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    return Response.json(await res.json());
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: msg }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  try {
    const res = await fetch(`${KNOWLEDGE_API_URL}/settings/update`, {
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
