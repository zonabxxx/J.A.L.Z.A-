import { NextRequest, NextResponse } from "next/server";
import { backendPost } from "@/lib/api-client";

export async function GET() {
  try {
    const res = await backendPost("/facts", { action: "list", limit: 100 });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ facts: [], error: "Failed to load facts" });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  try {
    const res = await backendPost("/facts", body);
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("json")) {
      return NextResponse.json({ error: "Backend error" }, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
