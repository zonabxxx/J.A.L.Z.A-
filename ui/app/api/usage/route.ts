import { NextRequest } from "next/server";
import { backendPost } from "@/lib/api-client";

export async function POST(req: NextRequest) {
  const body = await req.json();

  try {
    const res = await backendPost("/usage", body);
    const data = await res.json();
    return Response.json(data, { status: res.ok ? 200 : 502 });
  } catch {
    return Response.json({ error: "Backend unavailable" }, { status: 502 });
  }
}
