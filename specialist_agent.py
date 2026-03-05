"""
Špecializovaný agent J.A.L.Z.A.
Pracuje so znalostnou databázou — primárnou aj prepojenými (linked_kbs).
"""

import requests
from knowledge_base import KnowledgeBase

OLLAMA_URL = "http://localhost:11434/api/chat"
MODEL = "jalza"


def ask_specialist(
    knowledge_base: KnowledgeBase,
    question: str,
    system_prompt: str = "",
    model: str = MODEL,
    top_k: int = 5,
) -> str:
    results = knowledge_base.search(question, top_k=top_k)

    if not results:
        return "Nemám k tejto téme žiadne znalosti v databáze. Najprv spusti učenie."

    context = f"ZNALOSTNÁ DATABÁZA: {knowledge_base.name}\n\n"
    for i, r in enumerate(results, 1):
        context += f"--- Zdroj {i} (relevancia: {r['score']:.2f}) ---\n"
        context += f"Titulok: {r['title']}\n"
        context += f"URL: {r['url']}\n"
        context += f"{r['content']}\n\n"

    default_prompt = f"""Si špecializovaný agent na tému: {knowledge_base.name}.
Odpovedaj VÝHRADNE na základe poskytnutých znalostí. Ak informácia nie je v znalostnej databáze, povedz to.
Odpovedaj po slovensky, stručne a vecne. Uvádzaj zdroje."""

    messages = [
        {"role": "system", "content": system_prompt or default_prompt},
        {"role": "user", "content": f"{context}\n\nOTÁZKA: {question}"},
    ]

    r = requests.post(
        OLLAMA_URL,
        json={"model": model, "messages": messages, "stream": False},
        timeout=300,
    )
    r.raise_for_status()
    return r.json().get("message", {}).get("content", "Žiadna odpoveď")


def search_multi_kb(
    primary_kb: KnowledgeBase,
    linked_kb_names: list,
    question: str,
    context_budget: int = 8,
) -> list:
    """Search primary KB + all linked KBs, rank by relevance, return top N."""
    all_results = []

    primary_results = primary_kb.search(question, top_k=context_budget)
    for r in primary_results:
        r["_source_kb"] = primary_kb.name
        r["_is_primary"] = True
        all_results.append(r)

    for kb_name in linked_kb_names:
        try:
            linked_kb = KnowledgeBase(kb_name)
            stats = linked_kb.get_stats()
            if stats["chunks"] == 0:
                continue
            linked_results = linked_kb.search(question, top_k=context_budget)
            for r in linked_results:
                r["_source_kb"] = kb_name
                r["_is_primary"] = False
                all_results.append(r)
        except Exception:
            continue

    all_results.sort(key=lambda x: x["score"], reverse=True)
    return all_results[:context_budget]


def build_multi_kb_context(results: list) -> str:
    """Build context string from multi-KB search results."""
    if not results:
        return ""

    kb_groups = {}
    for r in results:
        kb = r.get("_source_kb", "?")
        kb_groups.setdefault(kb, []).append(r)

    context = ""
    for kb_name, chunks in kb_groups.items():
        context += f"═══ ZNALOSTNÁ DATABÁZA: {kb_name} ═══\n\n"
        for i, r in enumerate(chunks, 1):
            context += f"--- Zdroj {i} (relevancia: {r['score']:.2f}) ---\n"
            context += f"Titulok: {r['title']}\n"
            if r.get("url"):
                context += f"URL: {r['url']}\n"
            context += f"{r['content']}\n\n"

    return context


def ask_multi_kb(
    primary_kb: KnowledgeBase,
    linked_kb_names: list,
    question: str,
    system_prompt: str = "",
    model: str = MODEL,
    context_budget: int = 8,
) -> str:
    """Ask with context from multiple knowledge bases."""
    results = search_multi_kb(primary_kb, linked_kb_names, question, context_budget)

    if not results:
        return "Nemám k tejto téme žiadne znalosti. Najprv spusti učenie."

    context = build_multi_kb_context(results)

    kb_names = list({r.get("_source_kb", "?") for r in results})
    default_prompt = f"""Si špecializovaný agent s prístupom k znalostným databázam: {', '.join(kb_names)}.
Odpovedaj na základe poskytnutých znalostí. Ak informácia nie je v žiadnej databáze, povedz to.
Ak kombinuješ informácie z viacerých databáz, uveď z ktorej pochádzajú.
Odpovedaj po slovensky, stručne a vecne."""

    messages = [
        {"role": "system", "content": system_prompt or default_prompt},
        {"role": "user", "content": f"{context}\n\nOTÁZKA: {question}"},
    ]

    r = requests.post(
        OLLAMA_URL,
        json={"model": model, "messages": messages, "stream": False},
        timeout=300,
    )
    r.raise_for_status()
    return r.json().get("message", {}).get("content", "Žiadna odpoveď")


# === PREDNASTAVENÍ AGENTI ===

AGENTS = {
    "uctovnictvo": {
        "name": "Účtovníctvo a dane SR",
        "description": "Slovenské daňové zákony, účtovníctvo, DPH, daň z príjmov",
        "linked_kbs": [],
        "context_budget": 6,
        "priority_domains": [
            "slov-lex.sk",
            "financnasprava.sk",
            "socpoist.sk",
            "vszp.sk",
            "dovera.sk",
            "union.sk",
            "slovensko.sk",
            "nrsr.sk",
            "podnikajte.sk",
            "financnykompas.sk",
        ],
        "blocked_domains": [
            "facebook.com", "twitter.com", "instagram.com",
            "youtube.com", "reddit.com", "wikipedia.org",
        ],
        "queries": [
            "site:slov-lex.sk zákon 222/2004 DPH aktuálne znenie",
            "site:slov-lex.sk zákon 595/2003 daň z príjmov aktuálne znenie",
            "site:slov-lex.sk zákon 431/2002 účtovníctvo aktuálne znenie",
            "site:financnasprava.sk sadzby DPH 2025",
            "site:financnasprava.sk daňové priznanie 2025",
            "site:podnikajte.sk DPH 23% 2025 zmeny",
            "site:podnikajte.sk SZČO dane odvody 2025",
            "site:podnikajte.sk paušálne výdavky SZČO 2025",
            "konsolidačný balíček 2025 slovensko dane DPH 23",
            "sadzby DPH slovensko 2025 23 percent",
            "daňový bonus dieťa 2025 slovensko",
            "nezdaniteľná časť základu dane 2025",
            "sociálne odvody SZČO 2025 slovensko",
            "zdravotné odvody SZČO 2025 slovensko",
        ],
        "system_prompt": """Si expert na slovenské účtovníctvo a daňové zákony.
Odpovedaj na základe poskytnutých zákonov a predpisov. Uvádzaj konkrétne paragrafy a čísla zákonov.
DÔLEŽITÉ: Vždy uvádzaj informácie platné k aktuálnemu roku. Od 1.1.2025 je základná sadzba DPH 23%.
Ak si nie si istý alebo máš protichodné informácie, upozorni na to.
Odpovedaj stručne a vecne po slovensky.""",
    },
    "adsun_dopyty": {
        "name": "ADsun — Dopyty a zákazníci",
        "description": "Analýza dopytov z webu adsun.sk, zákazníci, trendy, kategórie služieb (polepy, svetelná reklama, tlač)",
        "linked_kbs": ["Tendry SK — Adsun", "Účtovníctvo a dane SR"],
        "context_budget": 8,
        "priority_domains": [
            "adsun.sk",
            "wrapboys.sk",
        ],
        "blocked_domains": [],
        "queries": [],
        "system_prompt": """Si interný analytik spoločnosti ADsun s.r.o. (adsun.sk / wrapboys.sk).
Spoločnosť sa venuje polepom vozidiel, svetelnej reklame, tlači a grafickému dizajnu.
Máš prístup k viacerým znalostným databázam: dopyty zákazníkov, verejné obstarávania/tendry a účtovníctvo.
Odpovedaj na základe znalostných databáz. Dávaj konkrétne čísla, percentá a porovnania.
Ak kombinuješ informácie z viacerých zdrojov, uveď odkiaľ pochádzajú.
Odpovedaj stručne, vecne a po slovensky.""",
    },
    "3d_tlac": {
        "name": "3D tlač",
        "description": "3D tlač, materiály, modely, Multiboard, nastavenia tlačiarne",
        "linked_kbs": [],
        "context_budget": 6,
        "priority_domains": [
            "prusa3d.com",
            "printables.com",
            "all3dp.com",
            "3dprinting.com",
            "help.prusa3d.com",
        ],
        "blocked_domains": [
            "facebook.com", "twitter.com", "instagram.com",
            "youtube.com", "reddit.com",
        ],
        "queries": [
            "3D printing best practices PLA PETG ABS",
            "multiboard 3D print STL files",
            "Prusa slicer settings",
            "3D print troubleshooting stringing warping",
            "3D printed storage organizer",
        ],
        "system_prompt": """Si expert na 3D tlač. Odpovedaj na základe znalostnej databázy.
Dávaj konkrétne rady ohľadom nastavení, materiálov a riešenia problémov.
Odpovedaj stručne po slovensky.""",
    },
}


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Dostupní agenti:")
        for key, agent in AGENTS.items():
            print(f"  {key}: {agent['name']} — {agent['description']}")
        print(f"\nPoužitie:")
        print(f"  python3 specialist_agent.py <agent> learn     — naučí sa z webu")
        print(f"  python3 specialist_agent.py <agent> ask <otázka>  — opýtaj sa")
        print(f"  python3 specialist_agent.py <agent> stats     — štatistiky")
        sys.exit(0)

    agent_key = sys.argv[1]
    if agent_key not in AGENTS:
        print(f"Neznámy agent: {agent_key}")
        print(f"Dostupní: {', '.join(AGENTS.keys())}")
        sys.exit(1)

    agent_config = AGENTS[agent_key]
    kb = KnowledgeBase(agent_config["name"], agent_config["description"])
    action = sys.argv[2] if len(sys.argv) > 2 else "stats"

    if action == "learn":
        print(f"Učím sa: {agent_config['name']}...")
        stats = kb.scrape_and_add(agent_config["queries"])
        print(f"Stiahnuté: {stats['downloaded']}, Preskočené: {stats['skipped']}, Chyby: {stats['errors']}")
        info = kb.get_stats()
        print(f"Celkovo: {info['sources']} zdrojov, {info['chunks']} časti, {info['total_chars']:,} znakov")

    elif action == "ask":
        question = " ".join(sys.argv[3:])
        if not question:
            print("Zadaj otázku")
            sys.exit(1)
        print(f"Hľadám odpoveď na: {question}\n")
        answer = ask_specialist(kb, question, agent_config.get("system_prompt", ""))
        print(answer)

    elif action == "stats":
        info = kb.get_stats()
        print(f"Agent: {agent_config['name']}")
        print(f"Zdroje: {info['sources']}")
        print(f"Časti: {info['chunks']}")
        print(f"Znakov: {info['total_chars']:,}")
        print(f"DB: {info['db_path']}")
