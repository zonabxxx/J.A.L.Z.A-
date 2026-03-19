import { NextRequest, NextResponse } from "next/server";
import { backendPost, jalzaAIText } from "@/lib/api-client";

async function searchUrls(query: string): Promise<string[]> {
  const text = await jalzaAIText({
    messages: [{
      role: "user",
      content: `Nájdi relevantné webové stránky o: "${query}"

Hľadaj na: finstat.sk, orsr.sk, zivefirmy.sk, oficiálne weby, Wikipedia, odborné články, LinkedIn.

Vráť JSON pole URL adries (max 10). IBA JSON, žiadny text:
["https://...", "https://..."]`,
    }],
    task_type: "web_search",
    temperature: 0.3,
    max_tokens: 1000,
  });

  if (!text) return [];
  const urlRegex = /https?:\/\/[^\s"',\]]+/g;
  const urls: string[] = text.match(urlRegex) || [];
  return Array.from(new Set(urls)).slice(0, 10);
}

async function analyzeResults(
  query: string,
  agentKey: string,
  savedCount: number
): Promise<string> {
  if (savedCount === 0) return "";

  try {
    const ctxRes = await backendPost("/context", {
      agent: agentKey,
      question: query,
      top_k: 8,
    });
    if (!ctxRes.ok) return "";
    const ctxData = await ctxRes.json();
    const context = ctxData.context || "";
    if (!context) return "";

    return await jalzaAIText({
      messages: [{
        role: "user",
        content: `Na základe nasledujúcich informácií zo znalostnej databázy vytvor stručný analytický report.

OTÁZKA: ${query}

KONTEXT Z DATABÁZY:
${context.slice(0, 6000)}

Napíš report v slovenčine. Použi markdown formátovanie (nadpisy, odrážky, tučné písmo). Buď vecný a stručný (max 500 slov).`,
      }],
      task_type: "analysis",
      temperature: 0.5,
      max_tokens: 2000,
    });
  } catch {
    return "";
  }
}

export async function POST(req: NextRequest) {
  const { query, agent, analyze } = await req.json();

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

  let analysisReport = "";
  if (analyze !== false && ok.length > 0) {
    analysisReport = await analyzeResults(query, agentKey, ok.length);
  }

  return NextResponse.json({
    query,
    agent: agentKey,
    total_urls: urls.length,
    saved: ok.length,
    failed: failed.length,
    results,
    analysis: analysisReport || undefined,
  });
}
