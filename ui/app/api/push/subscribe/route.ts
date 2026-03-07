import { NextRequest, NextResponse } from "next/server";
import { backendPost } from "@/lib/api-client";

export async function POST(req: NextRequest) {
  const body = await req.json();
  try {
    const res = await backendPost("/push/subscribe", body);
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
    return NextResponse.json({ status: "saved_locally" });
  } catch {
    return NextResponse.json({ status: "saved_locally" });
  }
}

export async function DELETE(req: NextRequest) {
  const body = await req.json();
  try {
    await backendPost("/push/unsubscribe", body);
  } catch {
    // ignore
  }
  return NextResponse.json({ status: "unsubscribed" });
}
