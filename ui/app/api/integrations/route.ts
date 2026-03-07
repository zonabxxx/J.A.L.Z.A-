import { NextRequest } from "next/server";
import { backendPost } from "@/lib/api-client";

async function safeJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    if (text.includes("<!DOCTYPE") || text.includes("<html")) {
      return { error: "Backend vrátil HTML – tunnel pravdepodobne nebeží." };
    }
    return { error: `Neplatná odpoveď: ${text.slice(0, 200)}` };
  }
}

export async function GET() {
  try {
    const res = await backendPost("/integrations", {});
    const data = await safeJson(res);
    if (!res.ok && !data.error) data.error = `Backend HTTP ${res.status}`;
    return Response.json(data, { status: data.error ? 502 : 200 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: `Pripojenie zlyhalo: ${msg}` }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  try {
    const res = await backendPost("/integrations/update", body);
    return Response.json(await safeJson(res));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: `Pripojenie zlyhalo: ${msg}` }, { status: 500 });
  }
}
