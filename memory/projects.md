# J.A.L.Z.A. — Projekty a stratégie

## DENDRIQ (hlavný softvérový projekt)
- Oficiálny názov pre investorov a prezentácie
- AI systémy pre analýzu procesov a modulárne firemné systémy
- Vizuál: čistý, moderný, profesionálny

### Piliere
1. Interný systém na správu zákaziek pre vlastnú tlačiareň (tlač, výroba, inštalácie)
2. Predaj modulárneho systému iným tlačiarňam a výrobným firmám
3. Vývoj systémov na mieru pre firmy
4. Analýza potrieb klientov pred vývojom softvéru (spoplatnená služba)

### Workflow systém (14 krokov)
- Inšpirovaný MultiPressom, prispôsobený pre ADSUN
- AI asistencia: validácia e-mailov, kalkulácie, plánovanie, výroba, fakturácia, reporting
- Konfigurátor workflow — generuje postup krokov podľa segmentu (polepy, tlač, montáže)
- Pripravený na škálovanie ako SaaS

### Pitch Deck pre investorov
- 10 kapitol: úvod, problém, riešenie, trh, produkt, go-to-market, konkurencia, financie, tím, investičná požiadavka
- Formáty: PowerPoint, Word

## Black Point (druhý softvérový smer)
- Pôvodne DENDRIQ, teraz pod značkou Black Point
- Produkty: AI analytika, optimalizácia výkonu, inovačné laboratórium, integračný hub
- Používateľ je spolumajiteľ
- DENDRIQ zostáva ako samostatný projekt

## Marketingová stratégia ADSUN/DENDRIQ
- Vstupná brána: analýza potrieb softvérových riešení
- Psychológia predaja: zisk efektivity + strach zo strát bez analýzy
- Kanály: LinkedIn, FB, IG, TikTok, Email, Webináre
- Obsah: Reels, Blogy, Posty, Lead Magnety
- 3 piliere: systém pre tlačiarne, pre inštalačné firmy, systémy na mieru
- Tón: profesionálny, ľudský, prínosy + eliminácia rizík
- Priorita: dôvera cez analýzu → predaj riešenia

## E-mailový systém (Microsoft Graph API)
- Funkčný základ: maily sa načítavajú a ukladajú do DB (header, body, attachment)
- Problém: spomalenie, inline obrázky cez cid: nefungujú
- Plán: refaktor fetchera → synchronizátor, cache loader, oddelenie UI od Graph API, validátor, revalidácia
- Cieľ: robustný, škálovateľný mailový engine pre AI automatizáciu

## Automatizácie (plánované)
- Make scenár: čítanie e-mailov → AI klasifikácia (zákazka/dopyt) → identifikácia firmy cez Flowii API → vytvorenie zákazky
- ChatGPT Actions + Make webhook (testovaný, funguje)
- AI + Make scenáre: e-maily, nacenenie, faktúry
- Marketingový proces: AI strih videí, titulky, popisy, plánovanie publikácií
- RPA automatizácia v Hugo.dev pre Flowii

## AI pamäťový systém
- Plánovaný: LangChain + Qdrant
- Uchovávanie kontextu projektových súborov
- Generovanie inteligentných promptov
- Indexovanie ako vektory, vyhľadávanie cez LLM

## Globálna expanzia
- IT sektor, dôraz na Áziu a Blízky východ
- Thajsko a Singapur — AI stratégie, implementácia AI do firemných systémov
- Priateľ v Thajsku pre lokálnu pomoc
- Plán: lokálne SK → zahraničie
- Rozpočet: 6-7 tisíc €, mesačné náklady 4-5 tisíc €
- Tím: 1 marketing (AI, grafika, video) 500 €/mes + developer
- Možnosť spolupráce s tímom 9 ľudí (4 senior devs), náklady ~25 000 €/mes
- Bývalý spoločník sa chce zapojiť
