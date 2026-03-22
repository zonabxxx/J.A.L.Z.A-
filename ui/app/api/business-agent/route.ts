import { NextRequest, NextResponse } from "next/server";
import { KNOWLEDGE_API_URL, JALZA_API_TOKEN } from "@/lib/config";

export async function POST(req: NextRequest) {
  try {
    const { prompt } = await req.json();
    if (!prompt) {
      return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
    }

    const res = await fetch(`${KNOWLEDGE_API_URL}/business-agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Token": JALZA_API_TOKEN,
      },
      body: JSON.stringify({ prompt }),
      signal: AbortSignal.timeout(60000),
    });

    const data = await res.json();
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Business agent error" }, { status: 500 });
  }
}
