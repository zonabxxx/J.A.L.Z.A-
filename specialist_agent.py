"""
Špecializovaný agent J.A.L.Z.A.
Pracuje výhradne so svojou znalostnou databázou.
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


# === PREDNASTAVENÍ AGENTI ===

AGENTS = {
    "uctovnictvo": {
        "name": "Účtovníctvo a dane SR",
        "description": "Slovenské daňové zákony, účtovníctvo, DPH, daň z príjmov",
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
    "3d_tlac": {
        "name": "3D tlač",
        "description": "3D tlač, materiály, modely, Multiboard, nastavenia tlačiarne",
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
