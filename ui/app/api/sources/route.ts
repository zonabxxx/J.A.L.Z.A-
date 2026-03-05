import { NextRequest, NextResponse } from "next/server";
import { backendPost } from "@/lib/api-client";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = await backendPost("/sources", body);
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
