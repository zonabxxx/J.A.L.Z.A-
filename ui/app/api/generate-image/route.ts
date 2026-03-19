import { NextRequest } from "next/server";
import { backendPost } from "@/lib/api-client";

export async function POST(req: NextRequest) {
  const { prompt, image: inputImage, useProxy } = await req.json();

  if (useProxy && process.env.US_PROXY_URL) {
    try {
      const proxyRes = await fetch(`${process.env.US_PROXY_URL}/api/generate-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, image: inputImage }),
        signal: AbortSignal.timeout(90000),
      });
      const proxyData = await proxyRes.json();
      return Response.json(proxyData, { status: proxyRes.status });
    } catch {
      // proxy failed, continue with JALZA backend
    }
  }

  if (!prompt) {
    return Response.json({ error: "Missing prompt" }, { status: 400 });
  }

  try {
    const res = await backendPost("/ai/generate-image", {
      prompt,
      image: inputImage,
    });

    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "JALZA AI Router nedostupný" }, { status: 502 });
  }
}
