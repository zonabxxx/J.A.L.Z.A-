import { backendPost } from "@/lib/api-client";

export async function GET() {
  try {
    const res = await backendPost("/mailboxes", {});
    const data = await res.json();
    return Response.json(data);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: msg, mailboxes: [] }, { status: 502 });
  }
}
