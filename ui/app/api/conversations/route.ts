import { NextRequest, NextResponse } from "next/server";
import { KNOWLEDGE_API_URL } from "@/lib/config";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = await fetch(`${KNOWLEDGE_API_URL}/conversations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
