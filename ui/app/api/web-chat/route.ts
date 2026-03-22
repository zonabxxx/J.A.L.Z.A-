import { NextRequest, NextResponse } from "next/server";
import { jalzaAIText } from "@/lib/api-client";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(req: NextRequest) {
  const { systemPrompt, prompt, task_type } = await req.json();

  if (!prompt) {
    return NextResponse.json(
      { error: "prompt required" },
      { status: 400, headers: corsHeaders() }
    );
  }

  const messages: { role: string; content: string }[] = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  try {
    const text = await jalzaAIText({
      messages,
      temperature: 0.7,
      max_tokens: 1024,
      ...(task_type && { task_type }),
    });

    if (!text) {
      return NextResponse.json(
        { error: "JALZA AI Router nedostupný" },
        { status: 502, headers: corsHeaders() }
      );
    }

    return NextResponse.json({ text }, { headers: corsHeaders() });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: msg },
      { status: 502, headers: corsHeaders() }
    );
  }
}
