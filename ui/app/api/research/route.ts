import { NextRequest, NextResponse } from "next/server";
import { GEMINI_API_KEY } from "@/lib/config";
import { backendPost } from "@/lib/api-client";

async function searchUrls(query: string): Promise<string[]> {
  if (!GEMINI_API_KEY) return [];

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `Nájdi relevantné webové stránky o: "${query}"

Hľadaj na: finstat.sk, orsr.sk, zivefirmy.sk, oficiálne weby, Wikipedia, odborné články, LinkedIn.

Vráť JSON pole URL adries (max 10). IBA JSON, žiadny text:
["https://...", "https://..."]`,
              },
            ],
          },
        ],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 1000 },
      }),
      signal: AbortSignal.timeout(15000),
    }
  );

  if (!res.ok) return [];
  const data = await res.json();
  const text =
    data.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text || "")
      .join("") || "";

  const urlRegex = /https?:\/\/[^\s"',\]]+/g;
  const urls = text.match(urlRegex) || [];
  return [...new Set(urls)].slice(0, 10);
}

export async function POST(req: NextRequest) {
  const { query, agent } = await req.json();

  if (!query) {
    return NextResponse.json({ error: "query required" }, { status: 400 });
  }

  const agentKey = agent || "adsun_dopyty";

  const urls = await searchUrls(query);
  if (urls.length === 0) {
    return NextResponse.json({
      error: "Nepodarilo sa nájsť žiadne URL.",
      urls: [],
      results: [],
    });
  }

  const results: {
    url: string;
    title: string;
    status: "ok" | "error";
    error?: string;
    chunks?: number;
  }[] = [];

  for (const url of urls) {
    try {
      const res = await backendPost("/sources", {
        action: "add_url",
        agent: agentKey,
        url,
      });
      const data = await res.json();
      if (data.error) {
        results.push({ url, title: "", status: "error", error: data.error });
      } else {
        results.push({
          url,
          title: data.title || url,
          status: "ok",
          chunks: data.stats?.chunks,
        });
      }
    } catch (e) {
      results.push({
        url,
        title: "",
        status: "error",
        error: e instanceof Error ? e.message : "unknown",
      });
    }
  }

  const ok = results.filter((r) => r.status === "ok");
  const failed = results.filter((r) => r.status === "error");

  return NextResponse.json({
    query,
    agent: agentKey,
    total_urls: urls.length,
    saved: ok.length,
    failed: failed.length,
    results,
  });
}
