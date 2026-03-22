import { NextRequest, NextResponse } from "next/server";
import { jalzaAIText } from "@/lib/api-client";

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

function parseRoute(text: string | null): string {
  if (!text) return "chat";
  const t = text.toLowerCase();
  if (t.includes("search")) return "search";
  if (t.includes("email")) return "email";
  if (t.includes("image")) return "image";
  if (t.includes("calendar")) return "calendar";
  if (t.includes("research")) return "research";
  if (t.includes("agent")) return "agent";
  if (t.includes("multi")) return "multi";
  if (t.includes("business_action")) return "business_action";
  if (t.includes("business")) return "business";
  return "chat";
}

export async function POST(req: NextRequest) {
  try {
    const { message } = await req.json();
    if (!message) return NextResponse.json({ route: "chat" });

    const result = await jalzaAIText({
      messages: [
        { role: "system", content: CLASSIFY_PROMPT },
        { role: "user", content: message },
      ],
      task_type: "classify",
      temperature: 0,
      max_tokens: 256,
    });

    return NextResponse.json({ route: parseRoute(result) });
  } catch {
    return NextResponse.json({ route: "chat" });
  }
}
