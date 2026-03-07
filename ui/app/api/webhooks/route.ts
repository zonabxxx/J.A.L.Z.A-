import { NextRequest, NextResponse } from "next/server";
import { backendPost } from "@/lib/api-client";

export async function GET() {
  try {
    const res = await backendPost("/webhooks", { action: "list" });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ webhooks: [] });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  try {
    const res = await backendPost("/webhooks", body);
    const data = await res.json();
    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
