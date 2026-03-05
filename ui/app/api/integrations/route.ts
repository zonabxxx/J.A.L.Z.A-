import { NextRequest } from "next/server";
import { backendPost } from "@/lib/api-client";

export async function GET() {
  try {
    const res = await backendPost("/integrations", {});
    return Response.json(await res.json());
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: msg }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  try {
    const res = await backendPost("/integrations/update", body);
    return Response.json(await res.json());
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: msg }, { status: 500 });
  }
}
