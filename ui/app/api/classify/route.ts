import { NextRequest, NextResponse } from "next/server";
import { GEMINI_API_KEY } from "@/lib/config";
import { getOllamaUrl, ollamaHeaders } from "@/lib/ollama-client";

const CLASSIFY_PROMPT = `Si inteligentný router pre AI asistenta J.A.L.Z.A. Analyzuj používateľovu správu a urči kam ju nasmerovať.

KATEGÓRIE:
- "search" — používateľ potrebuje AKTUÁLNE informácie z internetu (počasie, novinky, ceny, kurzy, firmy, produkty, recepty, osoby, udalosti, šport, vyhľadávanie čohokoľvek na webe)
- "email" — používateľ chce pracovať s emailami (poslať, čítať, odpovedať, hľadať, vymazať, spam, pošta, mail)
- "image" — používateľ chce VYGENEROVAŤ/VYTVORIŤ obrázok, kresbu, ilustráciu, logo, design, grafiku (nakresli, vygeneruj obrázok, vytvor obrázok, urob mi obrázok, nakresli mi, namaľuj, design, logo, ilustrácia)
- "chat" — všetko ostatné (rozhovor, programovanie, matematika, vysvetlenia, preklad, kreativita, pomoc s kódom)

PRAVIDLÁ:
- Správy sú často zo speech-to-text, skomolené, s preklepmi — pochop ZÁMER, nie presné slová
- Ak si nie si istý či treba aktuálne dáta → "search"
- "vyhľadaj", "nájdi", "aké je počasie", "koľko stojí", "čo je nové" → "search"
- "pošli mail", "maily", "email", "napíš mail", "odpoveď na mail" → "email"
- "nakresli", "vygeneruj obrázok", "vytvor obrázok", "nakresli mi", "namaľuj", "urob logo" → "image"
- Bežný rozhovor, otázky na vedomosti, pomoc → "chat"

Odpovedz IBA jedným slovom: search, email, image, alebo chat`;

async function classifyWithGemini(message: string): Promise<string | null> {
  if (!GEMINI_API_KEY) return null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            { role: "user", parts: [{ text: `${CLASSIFY_PROMPT}\n\nSpráva: "${message}"` }] },
          ],
          generationConfig: { temperature: 0, maxOutputTokens: 10 },
        }),
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return (data.candidates?.[0]?.content?.parts?.[0]?.text || "").trim().toLowerCase();
  } catch {
    return null;
  }
}

async function classifyWithOllama(message: string): Promise<string | null> {
  try {
    const res = await fetch(getOllamaUrl("/api/chat"), {
      method: "POST",
      headers: ollamaHeaders(),
      body: JSON.stringify({
        model: "jalza",
        messages: [
          { role: "system", content: CLASSIFY_PROMPT },
          { role: "user", content: message },
        ],
        stream: false,
        options: { temperature: 0, num_predict: 10 },
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.message?.content || "").trim().toLowerCase();
  } catch {
    return null;
  }
}

function parseRoute(text: string | null): string {
  if (!text) return "chat";
  if (text.includes("search")) return "search";
  if (text.includes("email")) return "email";
  if (text.includes("image")) return "image";
  return "chat";
}

export async function POST(req: NextRequest) {
  try {
    const { message } = await req.json();
    if (!message) return NextResponse.json({ route: "chat" });

    // Try Gemini first (fast ~200ms), fall back to Ollama
    let result = await classifyWithGemini(message);
    if (!result) {
      result = await classifyWithOllama(message);
    }

    return NextResponse.json({ route: parseRoute(result) });
  } catch {
    return NextResponse.json({ route: "chat" });
  }
}
