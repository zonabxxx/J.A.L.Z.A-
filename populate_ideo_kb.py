"""
Naplnenie znalostnej bázy pre IDEO prezentáciu.
Obsahuje: obsah webu, ADSUN stratégiu, tím, plány, obchodnú stratégiu.
Spustenie: python3 populate_ideo_kb.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from knowledge_base import KnowledgeBase

KB_NAME = "IDEO Prezentácia — Black Point AI"
KB_DESCRIPTION = "AI prezentácia pre IDEO s.r.o. — riešenia, stratégia ADSUN/Black Point, tím, plány"


def build_documents() -> list[tuple[str, str, str]]:
    docs = []

    # 1. Obsah prezentačného webu
    docs.append((
        "ideo://web/overview",
        "IDEO Prezentácia — Prehľad webu",
        """Prezentačný web "AI riešenia pre IDEO s.r.o. | Black Point" je jednostránková prezentácia pripravená spoločnosťou Black Point pre IDEO s.r.o.

IDEO s.r.o. je slovenský B2B distribútor grafických materiálov a fólií so sídlom na Vajnorskej 127, 831 04 Bratislava.
IČO: 35 884 860, Web: ideo.sk, E-shop: Shoptec platforma.
Kontakt: +421 2 2074 1576, objednavky@ideo.sk
Zamestnanci: 5-9 (FinStat), Tržby 2024: 3 377 000 € (+9%), Zisk 2024: 99 407 € (-46%).

Sortiment IDEO: 17+ kategórií — tlačové fólie, rezaná reklama, nažehľovanie, laminácie, banner/textil/magnet,
architektúra a okenné fólie, svetelná reklama, papier a hárky, PVC Free, hardware, carwrap a tuning,
displej a POP-UP, výstražné materiály, doskové materiály, pásky/lepidlá/suchý zips, príslušenstvo.
Značky: 3M, Oracal/Orafol, Avery Dennison, Siser, Chemica, Igepa, Mactac.

Web prezentuje 3 konkrétne AI riešenia s merateľnou návratnosťou od Black Point.""",
    ))

    # 2. Hero sekcia a kľúčové čísla
    docs.append((
        "ideo://web/hero",
        "IDEO Prezentácia — Kľúčové čísla a problémy",
        """Kľúčové štatistiky prezentácie:
- Zisk IDEO klesol o 46% pri raste tržieb o 9% — prevádzkové náklady narástli o ~100k €
- 26 000 € viazaných v prezásobených položkách s pomalou obrátkovosťou
- 20-50 emailov/deň manuálneho spracovania objednávok = 5-15 hodín denne
- 17 kategórií, stovky SKU — zákazníci nevedia čo presne potrebujú

Firma je zdravá (bez úverov, zadlženosť klesá), ale potrebuje efektívnejšie procesy.""",
    ))

    # 3. Trendy a Agentic Commerce
    docs.append((
        "ideo://web/trends",
        "IDEO Prezentácia — Trhové trendy a Agentic Commerce",
        """Trhové trendy prezentované IDEO:
- 58-69% zero-click vyhľadávaní (Ahrefs, 2026)
- 37% ľudí používa AI chatbot namiesto Googlu (Gartner)
- -50% pokles organickej návštevnosti do 2028
- +693% nárast AI e-commerce traffic v Q4 2025
- 20% transakcií cez AI agentov predikcia do 2030

Agentic Commerce — budúcnosť B2B:
Dnes: zákazník googli, hľadá na webe, volá, čaká na cenovú ponuku = hodiny až dni
O 2 roky: AI agenti si vymenia požiadavky, dohodnú podmienky, objednávka prebehne automaticky = sekundy

Shopify v januári 2026 auto-pripojil všetkých obchodníkov k ChatGPT a Perplexity.
Amazon, Stripe a OpenAI budujú infraštruktúru pre automatický obchod.""",
    ))

    # 4. Riešenie 1 — Predpoveď dopytu
    docs.append((
        "ideo://web/riesenie1",
        "Riešenie 1 — Predpoveď dopytu a optimalizácia zásob",
        """PONUKA 1: Predpoveď dopytu a optimalizácia zásob (najväčšie ROI)

Problém IDEO:
- 17+ kategórií, desiatky SKU v rôznych rozmeroch/farbách/hrúbkach
- Silná sezónnosť: car wrapping (jar/leto), výstavná sezóna (jeseň), textilná sezóna (školský rok)
- Pri obrate 3,4M € a hrubej marži 11% je prezásobenie = viazaný kapitál, výpadok = stratený predaj
- Aktíva narástli o 7% (1,7M €) — pravdepodobne investícia do skladu

Riešenie:
- AI model trénovaný na histórii objednávok (Shoptec API)
- Sezónne krivky dopytu po kategóriách a SKU
- Automatické upozornenia: "O 3 týždne začína sezóna polepov — naskladniť kanálikové fólie"
- Identifikácia mŕtveho tovaru
- Odporúčania optimálnych objednávok od dodávateľov
- Obrátkovosť zásob po kategórii a SKU

ROI: 50-100k €/rok (zníženie overstock -15-25%, zníženie stockout -30-50%)
Cena: 4 000 – 7 000 €
Čas: 3-5 týždňov""",
    ))

    # 5. Riešenie 2 — Automatizácia objednávok
    docs.append((
        "ideo://web/riesenie2",
        "Riešenie 2 — Automatizované spracovanie objednávok",
        """PONUKA 2: Automatizované spracovanie objednávok z emailov (máme živé demo)

Problém IDEO:
- Objednávky prichádzajú na objednavky@ideo.sk
- Pri obrate 3,4M € = odhadom 20-50 emailov denne
- Manuálne: prečítať → identifikovať zákazníka → rozlúštiť produkty → overiť sklad → zadať do Shoptec → potvrdenie
- Každá objednávka 15-30 minút = 5-15 hodín denne

Riešenie (funguje v produkcii pre ADSUN):
1. AI sleduje emailovú schránku (Microsoft Graph API)
2. Extrahuje: zákazník, produkty, množstvá, rozmery, termín
3. Validuje voči katalógu cez Shoptec API
4. Automaticky vytvára objednávku v systéme
5. Posiela potvrdenie zákazníkovi
6. Escalation na živého operátora ak niečo nesedí

Príklad: "poslite mi 5 roliek oracalu na autá, čierny lesklý, 126ka. A komatex 5ka biela, 3 kusy veľké."
AI rozpozná: Oracal 651 čierna lesklá 126cm + Komatex 5mm biela 3050×1560

ROI: 7 800 – 15 600 €/rok (úspora 2-4h denne, -80% chyby, 24/7)
Cena: 5 000 – 10 000 €
Čas: 6-8 týždňov""",
    ))

    # 6. Riešenie 3 — Katalógová inteligencia
    docs.append((
        "ideo://web/riesenie3",
        "Riešenie 3 — Inteligencia produktového katalógu",
        """PONUKA 3: Inteligencia produktového katalógu

Problém IDEO:
- 17 kategórií, stovky položiek s komplexnými parametrami
- Zákazníci (tlačiarne, reklamky) často nevedia čo presne potrebujú
- Chýba cross-selling: kto kupuje fóliu, potrebuje aj lamináciu
- Popisy produktov v SK sú často chabé alebo chýbajú
- Technické parametre roztrúsené v PDF datasheet-och

Riešenie:
1. AI-asistované vyhľadávanie: "fólia na polep auta na 5 rokov, čierna" → relevantné výsledky
2. Kompatibilné produkty: "K tejto fólii odporúčame lamináciu 8519"
3. Automatizované popisy SK z technických listov
4. Znalostná báza technických parametrov
5. Parametre na dotaz: "Aká je teplotná odolnosť Chemica Quickflex?"

ROI: +8-15% priemerná objednávka (+270k-510k € tržieb pri obrate 3,4M), -30% vrátky, -40% opakované otázky
Cena: 3 000 – 6 000 €
Čas: 3-4 týždne""",
    ))

    # 7. Technológia a integrácia
    docs.append((
        "ideo://web/technologia",
        "IDEO Prezentácia — Technológia a integrácia",
        """Technologická architektúra:
Shoptec e-shop (API: objednávky, produkty, sklad, ceny)
→ Black Point AI platforma (Email agent, Workflow, Analytika, AI agenti)
→ AI kanály zákazníkov (ChatGPT, Perplexity, Telegram, API)

Používané technológie:
- Shoptec API (REST)
- Microsoft Outlook (Graph API)
- FinStat API
- Doklado
- Telegram
- Google AI (Gemini)
- Lokálny Ollama (70B model)
- Agentic Commerce Protocol

Kľúčový princíp: Nemeníme váš e-shop. Pridávame AI vrstvu.

Garancia: Ak sa nepodarí, neplatíte.
Úsporu meriame spoločne — konkrétnymi číslami. Celé riziko nesie Black Point.""",
    ))

    # 8. Black Point — kto sme
    docs.append((
        "ideo://web/blackpoint",
        "Black Point — Prečo my",
        """Black Point (blackpoint.dev, Brno, Česká republika)
Kontakt: info@blackpoint.dev, +420 606 055 013

Prečo Black Point:
1. Rovnaký svet — Vlastníme reklamnú výrobu (ADSUN). Pracujeme s fóliami, doskami, polepmi. Sme zákazníci IDEO.
2. Fungujúci produkt — Riešenia bežia v ostrej prevádzke. Nie je to PowerPoint — je to softvér v produkcii.
3. Vlastná AI infraštruktúra — Mac Studio M3 Ultra, 96 GB RAM, 70B model. Dáta zostávajú u klienta — bez cloudu.
4. Pripravení na agentický obchod — Budujeme API a AI agentov pre Agentic Commerce.

Pitch argumenty:
- SAP je absurdný pre 5-9 ľudí. Excel nestačí. Black Point je presne medzi tým.
- 3-8 týždňov do prvých výsledkov, nie rok.
- Garancia: Ak neprinesie merateľný výsledok, neplatíte.""",
    ))

    # 9. ADSUN firma — kompletný prehľad
    docs.append((
        "ideo://adsun/firma",
        "ADSUN s.r.o. — Prehľad firmy",
        """ADSUN s.r.o. (adsun.sk / wrapboys.sk)
Sídlo: Pezinok, Bratislavská 90, 902 01
Zameranie: výroba reklamy, svetelné boxy, polepy áut, bannery, grafické aplikácie
Tržby: 800 000 € (AD SUN s.r.o.)

Firmy (Juraj Martinkových je spoločník):
- AD SUN s.r.o. — tržby 800 000 €
- WRAPBOYS s.r.o. — tržby 344 000 €
- EDON s.r.o. — tržby 100 €
Všetky ziskové, žiadne úverové záväzky.

CRM: Flowii (plánuje sa nahradiť)
E-mail: Microsoft Outlook
Dáta: Synology WebDAV
Spolupráca: externá agentúra Signity (web, SEO, PPC)
Marketing sociálnych sietí: Peter Kuliffay (krátke videá/reely z inštalácií a výroby)""",
    ))

    # 10. ADSUN tím
    docs.append((
        "ideo://adsun/tim",
        "ADSUN — Tím a spolupracovníci",
        """Tím ADSUN:
- Juraj Martinkových (používateľ/zakladateľ) — obchodno-systémové stratégie, obchod a marketing, 45 rokov
- Juraj Chlepko — riaditeľ firmy, organizácia, chod a poriadok
- Jozef Tomášek — inovácie, technológie, obchod a marketing (CSO, tomasek@adsun.sk, +421 903 222 751)
- Marián Blažkovič
- Simona Jurčíková — zmluvy a účtovníctvo (sekretárka)

Výroba:
- Tlačiar: Máte Dexler
- Výrobcovia svetelných reklám / inštalatéri: Brano a Zolo
- Brano: aj osádzanie a striekanie svetiel
- Pomocný inštalatér: Ondraj
- Externí výrobcovia/inštalatéri: Dano a Ondraj
- Grafička: Myška
- Obchodník: Matej Šejc

Expanzia Rakúsko:
- Kontakt: Branislav Stojkov (stojkov@adsun.at), architekt, dohodol 3 zákazky, vie riadiť pobočku
- Web v nemčine, 800 €/mes Google Ads
- Plán: po rozbehu aj polepy áut, založiť firmu v Rakúsku

Expanzia Trnava:
- Pobočka polepov áut, spolupráca s vyškoleným lepičom (priestor pre 5 áut)
- ADSUN: marketing, materiály, naceňovanie, admin""",
    ))

    # 11. ADSUN procesy
    docs.append((
        "ideo://adsun/procesy",
        "ADSUN — Procesy a služby",
        """Hlavné služby ADSUN:
1. Polepy vozidiel (~59% dopytov): reklamný polep (malý/stredný/celopolep), zmena farby/wrap, ochranná fólia PPF
2. Svetelná reklama (~27%): LED nápisy, svetelné boxy, neónové reklamy
3. Tlačové služby (~5%): veľkoformátová tlač, bannery, plachty
4. Špeciálne projekty: eventové inštalácie, interiérové fólie
5. Grafický dizajn

Proces polepov áut:
1. Dopyt cez e-mail alebo telefonicky
2. Zadanie do Flowii ako "obchodný prípad"
3. Cenotvorba: NC na materiál (m²) + čas (hodiny), predajná cena podľa marže
4. Výstup: cenová ponuka

Rozdiel celopolep vs carwrap:
- Reklamný celopolep: fólia na celý povrch, NEzahýba sa za hrany, oreže sa po hrane
- Carwrap (zmena farby): po jednotlivých častiach karosérie, zahýba sa za hrany (~4 cm)

Maloformátová tlač:
- Partnerská firma Remprint za cenu Typocon - 20%

Aktuálne zákazky:
- PHASE + NATUZZI Editions Černý Most — interiérový branding
- PENAM — 171 vozidiel (77 SK + 94 CZ), ~4413 m² fólie
- Maďarsko — 100 áut, 7-ročná záruka""",
    ))

    # 12. Stratégia a ciele 2026
    docs.append((
        "ideo://adsun/strategia",
        "ADSUN — Stratégia a ciele 2026",
        """Ciele ADSUN 2026:
- Dokončiť a nasadiť interný systém (FINRQ/DENDRIQ)
- Prerobiť web ADSUN a prepojiť so systémom
- Vybudovať IT tím
- Nastaviť pravidlá/procesy pre obchodný tím
- Zoptimalizovať fungovanie ADSUN
- Nahradiť rutinné úkony automatizáciami a AI nástrojmi
- ADSUN: rast +33%, fokus na 1 smer, obchodný tím a cenotvorba

Projekty:
1. DENDRIQ — AI systémy pre analýzu procesov a modulárne firemné systémy
   - Interný systém na správu zákaziek pre tlačiareň
   - Predaj modulárneho systému iným tlačiarňam
   - Vývoj systémov na mieru
   - Analýza potrieb klientov (spoplatnená služba)

2. Black Point — AI analytika, optimalizácia výkonu, integračný hub
   Produkty: demand forecasting, email order automation, catalog intelligence

Marketingová stratégia:
- Vstupná brána: analýza potrieb softvérových riešení
- Kanály: LinkedIn, FB, IG, TikTok, Email, Webináre
- Obsah: Reels, Blogy, Posty, Lead Magnety
- 3 piliere: systém pre tlačiarne, pre inštalačné firmy, systémy na mieru

Globálna expanzia:
- IT sektor, Ázia a Blízky východ (Thajsko, Singapur)
- Rozpočet: 6-7 tisíc €, mesačné 4-5 tisíc €""",
    ))

    # 13. Predajná stratégia voči IDEO
    docs.append((
        "ideo://strategia/predajna",
        "Predajná stratégia — stretnutie s IDEO",
        """Odporúčaný postup na schôdzke s IDEO:

1. Otvárací hook:
"Dobrý deň, som z firmy ADSUN/Black Point. Vaše materiály používame denne. Všimol som si tri veci, kde by AI mohla mať okamžitý dopad na váš biznis — a na jednu z nich vám mám funkčné demo."

2. Začať s live demo (Ponuka 2 — automatizácia objednávok):
- Poslať "objednávku" na ADSUN systém → ukázať automatické spracovanie
- "Toto by bežalo na objednavky@ideo.sk"
- Najhmatateľnejšie — vidia to na vlastné oči

3. Prejsť na čísla (Ponuka 1 — predpoveď dopytu):
- "Váš zisk klesol o 46% pri raste tržieb. Jedným z dôvodov môže byť viazaný kapitál v sklade."
- Ukázať demo sezónnych kriviek
- Najväčšie merateľné ROI

4. Ukázať katalógovú inteligenciu (Ponuka 3):
- Demo: "fólia na auto 5 rokov čierna" → relevantné výsledky
- Kompatibilné produkty a auto-generované popisy

5. Zatvoriť:
"Navrhnem začať s jedným modulom — vyberte si ktorý problém vás trápi najviac. Ak neprinesie výsledky, neplatíte."

Pitch argumenty:
1. Rovnaký svet — sme z reklamnej výroby, pracujeme s rovnakými materiálmi
2. Fungujúci produkt — softvér v produkcii, nie PowerPoint
3. Merateľné výsledky — konkrétne čísla ROI
4. Správna veľkosť — SAP absurdný, Excel nestačí
5. Rýchly štart — 3-8 týždňov
6. Garancia — ak neprinesie výsledok, neplatíte""",
    ))

    # 14. Cenník
    docs.append((
        "ideo://web/cennik",
        "IDEO Prezentácia — Cenník a porovnanie",
        """Cenník riešení pre IDEO:

Riešenie 1 — Predpoveď dopytu: 4 000 – 7 000 € (3-5 týždňov, ROI 50-100k €/rok)
Riešenie 2 — AI objednávky z emailov: 5 000 – 10 000 € (6-8 týždňov, úspora 2-4h denne)
Riešenie 3 — Katalógová inteligencia: 3 000 – 6 000 € (3-4 týždne, +8-15% objednávka)

Porovnanie:
| | Predpoveď dopytu | Spracovanie objednávok | Katalógová inteligencia |
|Pripravenosť| Rýchlo napísať | Hotová ukážka (ADSUN) | Napísať pred schôdzkou |
|Ročné ROI| 50-100k € | 8-16k € | Najvyšší potenciál |
|Urgentnosť| Vysoká (zisk -46%) | Vysoká (5-15h admin) | Stredná (dlhodobý) |

Ponuka stretnutia: 30 minút. 3 riešenia. Živé demo.
Kontakt: info@blackpoint.dev, +420 606 055 013""",
    ))

    # 15. Interné chyby ADSUN
    docs.append((
        "ideo://adsun/chyby",
        "ADSUN — Interný log chýb",
        """Evidované chyby v procesoch ADSUN:

1. Inštalácie bez oznámenia klientom
   - Inštalácie prebiehajú bez predchádzajúceho oznámenia klientom
   - Dopad: problémy pri preberaní, nespokojnosť, zbytočné výjazdy

2. Neautorizované odborné rady inštalatérov
   - Inštalatéri navrhujú riešenia bez konzultácie s manažmentom
   - Dopad: nejednotnosť v kvalite, zodpovednosť za chyby

3. Bezpečnostné incidenty vo výrobe
   - Otvorené dvere a zapnuté svetlo, upchané umývadlo
   - Dopad: bezpečnostné riziko, poškodenie reputácie""",
    ))

    return docs


def main():
    kb = KnowledgeBase(KB_NAME, KB_DESCRIPTION)
    print(f"Knowledge base: {kb.db_path}")

    docs = build_documents()
    print(f"Pripravených {len(docs)} dokumentov na vloženie\n")

    for url, title, text in docs:
        print(f"  Vkladám: {title} ({len(text)} znakov)...", end=" ", flush=True)
        result = kb.add_document(url, title, text)
        print(f"→ {result['status']}" + (f" ({result.get('chunks', 0)} chunks)" if result["status"] == "added" else ""))

    stats = kb.get_stats()
    print(f"\n✅ Hotovo!")
    print(f"   Zdroje: {stats['sources']}")
    print(f"   Časti (chunks): {stats['chunks']}")
    print(f"   Znakov: {stats['total_chars']:,}")
    print(f"   DB: {stats['db_path']}")


if __name__ == "__main__":
    main()
