import { NextRequest, NextResponse } from "next/server";
import { KNOWLEDGE_API_URL, JALZA_API_TOKEN } from "@/lib/config";

async function backendPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${KNOWLEDGE_API_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Token": JALZA_API_TOKEN,
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action") || "summary";
  const params: Record<string, string> = { action };
  for (const [k, v] of req.nextUrl.searchParams.entries()) {
    params[k] = v;
  }
  try {
    const data = await backendPost("/business", params);
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = await backendPost("/business", body);
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
