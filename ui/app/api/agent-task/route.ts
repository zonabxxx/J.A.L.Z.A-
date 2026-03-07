import { NextRequest, NextResponse } from "next/server";
import { backendPost } from "@/lib/api-client";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const { prompt, agent } = await req.json();

  if (!prompt) {
    return NextResponse.json({ error: "prompt required" }, { status: 400 });
  }

  try {
    const res = await backendPost("/agent-run", {
      prompt,
      agent: agent || "",
    });

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("json")) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Backend vrátil neočakávanú odpoveď: ${text.slice(0, 100)}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json(
        { error: data.error || "Agent failed" },
        { status: res.status }
      );
    }

    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Agent task failed" },
      { status: 500 }
    );
  }
}
