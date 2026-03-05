import { NextRequest, NextResponse } from "next/server";
import { GEMINI_API_KEY } from "@/lib/config";

const CLASSIFY_PROMPT = `Si router pre AI asistenta. Tvojou jedinou úlohou je klasifikovať používateľovu správu do jednej z kategórií.

Kategórie:
- "search" — ak používateľ potrebuje AKTUÁLNE, REÁLNE informácie z internetu (počasie, ceny, novinky, športové výsledky, kurzy, aktuálne udalosti, vyhľadávanie produktov, stránok, receptov, osôb, firiem, čokoľvek čo vyžaduje aktuálne dáta alebo informácie z webu)
- "email" — ak používateľ chce čítať, písať, odpovedať na emaily alebo spravovať poštu
- "chat" — všetko ostatné (bežný rozhovor, programovanie, matematika, vysvetlenia, preklad, kreativita, osobné otázky)

DÔLEŽITÉ:
- Ak si nie si istý či používateľ potrebuje aktuálne dáta, zvoľ "search"
- Ignoruj preklepy — pochop ZÁMER správy
- Odpovedz LEN jedným slovom: search, email, alebo chat`;

export async function POST(req: NextRequest) {
  try {
    const { message } = await req.json();
    if (!message) {
      return NextResponse.json({ route: "chat" });
    }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            { role: "user", parts: [{ text: `${CLASSIFY_PROMPT}\n\nSpráva: "${message}"` }] },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 10,
          },
        }),
      }
    );

    if (!res.ok) {
      return NextResponse.json({ route: "chat" });
    }

    const data = await res.json();
    const text = (data.candidates?.[0]?.content?.parts?.[0]?.text || "").trim().toLowerCase();

    if (text.includes("search")) return NextResponse.json({ route: "search" });
    if (text.includes("email")) return NextResponse.json({ route: "email" });
    return NextResponse.json({ route: "chat" });
  } catch {
    return NextResponse.json({ route: "chat" });
  }
}
