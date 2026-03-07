import { NextRequest, NextResponse } from "next/server";
import { backendPost, backendGet } from "@/lib/api-client";

export async function GET(req: NextRequest) {
  const folder = req.nextUrl.searchParams.get("folder") || "";
  try {
    const res = await backendPost("/files", { action: "list", folder });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ files: [], error: "Failed to list files" });
  }
}

export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const folder = (formData.get("folder") as string) || "";

    if (!file) {
      return NextResponse.json({ error: "No file" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString("base64");

    try {
      const res = await backendPost("/files", {
        action: "upload",
        filename: file.name,
        folder,
        content_base64: base64,
        size: file.size,
      });
      const data = await res.json();
      return NextResponse.json(data);
    } catch {
      return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }
  }

  const body = await req.json();
  try {
    const res = await backendPost("/files", body);
    const data = await res.json();
    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch {
    return NextResponse.json({ error: "File operation failed" }, { status: 500 });
  }
}
