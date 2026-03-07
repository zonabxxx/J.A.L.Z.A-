import { NextRequest, NextResponse } from "next/server";
import { backendPost } from "@/lib/api-client";

export async function POST(req: NextRequest) {
  const { question, agents } = await req.json();

  if (!question) {
    return NextResponse.json({ error: "question required" }, { status: 400 });
  }

  try {
    const res = await backendPost("/multi-agent", { question, agents: agents || [] });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Multi-agent query failed" }, { status: 500 });
  }
}
