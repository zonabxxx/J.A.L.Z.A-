import { NextRequest, NextResponse } from "next/server";
import { GEMINI_API_KEY } from "@/lib/config";
import { getOllamaUrl, ollamaHeaders, isOllamaLocal } from "@/lib/ollama-client";

const CLASSIFY_PROMPT = `Si inteligentný router pre AI asistenta J.A.L.Z.A. Analyzuj používateľovu správu a urči kam ju nasmerovať.

KATEGÓRIE:
- "search" — používateľ potrebuje AKTUÁLNE informácie z internetu (počasie, novinky, ceny, kurzy, firmy, produkty, recepty, osoby, udalosti, šport, vyhľadávanie čohokoľvek na webe)
- "email" — používateľ chce pracovať s emailami (poslať, čítať, odpovedať, hľadať, vymazať, spam, pošta, mail)
- "image" — používateľ chce VYGENEROVAŤ/VYTVORIŤ obrázok, kresbu, ilustráciu, logo, design, grafiku (nakresli, vygeneruj obrázok, vytvor obrázok, urob mi obrázok, nakresli mi, namaľuj, design, logo, ilustrácia)
- "calendar" — používateľ chce pracovať s KALENDÁROM (stretnutie, schôdzka, meeting, udalosť, čo mám dnes, program, vytvor stretnutie, zruš meeting, presuň, kalendár, kedy mám, diary, agenda, termín)
- "research" — používateľ chce aby AI VYHĽADAL informácie na webe a ULOŽIL ich do znalostnej databázy (nájdi info a ulož, urob research, preskúmaj firmu a pridaj do databázy, nauč sa o..., zisti všetko o... a zapamätaj si, pridaj zdroje o...)
- "agent" — používateľ zadáva KOMPLEXNÚ ÚLOHU ktorá vyžaduje VIACERO KROKOV, použitie nástrojov, alebo prístup k súborom/systému (analyzuj, sprav audit, skontroluj systém, porovnaj, spracuj dáta, vytvor report, naprogramuj, napíš skript, urob analýzu, komplexná úloha, naplánuj a vykonaj, zautomatizuj, spusti príkaz, koľko súborov, vypíš súbory, analyzuj priečinok, preskúmaj adresár, čo je v priečinku)
- "multi" — používateľ chce odpoveď zo VŠETKÝCH znalostných agentov naraz, alebo chce porovnať informácie z viacerých databáz (opýtaj sa všetkých agentov, spýtaj sa všetkých, čo vedia všetci agenti, porovnaj znalosti, cross-knowledge)
- "business" — používateľ sa pýta na BUSINESS DÁTA z firemného systému: zákazky, objednávky, faktúry, kalkulácie, zákazníci, financie, tržby, obrat, marža, štatistiky firmy, koľko máme zákaziek, aký je obrat, nezaplatené faktúry, zoznam zákazníkov, stav zákaziek, finančný prehľad
- "business_action" — používateľ chce VYKONAŤ AKCIU v business systéme: vytvoriť cenovú ponuku, vytvoriť projekt, pridať zákazníka, nájsť produkt a vytvoriť kalkuláciu, poslať ponuku klientovi, spracovať objednávku, založiť zákazku — akákoľvek požiadavka na VYTVORENIE alebo ODOSLANIE niečoho v business systéme
- "chat" — všetko ostatné (rozhovor, programovanie, matematika, vysvetlenia, preklad, kreativita, pomoc s kódom, jednoduché otázky)

PRAVIDLÁ:
- Správy sú často zo speech-to-text, skomolené, s preklepmi — pochop ZÁMER, nie presné slová
- Ak si nie si istý či treba aktuálne dáta → "search"
- "vyhľadaj", "nájdi", "aké je počasie", "koľko stojí", "čo je nové" → "search"
- "pošli mail", "maily", "email", "napíš mail", "odpoveď na mail" → "email"
- "nakresli", "vygeneruj obrázok", "vytvor obrázok", "nakresli mi", "namaľuj", "urob logo" → "image"
- "čo mám dnes", "aký mám program", "stretnutie", "meeting", "schôdzka", "kalendár", "vytvor udalosť", "kedy mám" → "calendar"
- "nájdi info a ulož", "urob research", "preskúmaj a pridaj", "nauč sa o", "zisti a zapamätaj", "pridaj do databázy" → "research"
- "analyzuj systém", "sprav audit", "urob analýzu", "vytvor report", "porovnaj", "skontroluj a oprav", "spusti príkaz", "naprogramuj", "zautomatizuj", "komplexná úloha", "naplánuj a vykonaj", "koľko súborov", "vypíš súbory", "analyzuj priečinok", "čo je v priečinku" → "agent"
- "opýtaj sa všetkých agentov", "čo vedia agenti o", "spýtaj sa všetkých", "cross-knowledge" → "multi"
- "zákazky", "objednávky", "faktúry", "kalkulácie", "zákazníci", "obrat", "tržby", "financie", "marža", "štatistiky firmy", "koľko máme", "stav zákaziek", "nezaplatené", "finančný prehľad", "aký je obrat", "mesačný report" → "business"
- "vytvor cenovú ponuku", "pridaj zákazníka", "nájdi produkt a vytvor projekt", "pošli ponuku", "spracuj objednávku", "založ zákazku", "vytvor kalkuláciu pre", "priprav ponuku pre klienta", "chcem ponuku na" → "business_action"
- Bežný rozhovor, otázky na vedomosti, pomoc → "chat"

Odpovedz IBA jedným slovom: search, email, image, calendar, research, agent, multi, business, business_action, alebo chat`;

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
  if (text.includes("calendar")) return "calendar";
  if (text.includes("research")) return "research";
  if (text.includes("agent")) return "agent";
  if (text.includes("multi")) return "multi";
  if (text.includes("business_action")) return "business_action";
  if (text.includes("business")) return "business";
  return "chat";
}

export async function POST(req: NextRequest) {
  try {
    const { message } = await req.json();
    if (!message) return NextResponse.json({ route: "chat" });

    let result: string | null = null;
    if (isOllamaLocal) {
      result = await classifyWithOllama(message);
      if (!result) result = await classifyWithGemini(message);
    } else {
      result = await classifyWithGemini(message);
      if (!result) result = await classifyWithOllama(message);
    }

    return NextResponse.json({ route: parseRoute(result) });
  } catch {
    return NextResponse.json({ route: "chat" });
  }
}
