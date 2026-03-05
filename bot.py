import os
import re
import json
import base64
import sqlite3
import logging
import requests
from datetime import datetime
from telegram import Update
from telegram.ext import (
    Application,
    CommandHandler,
    MessageHandler,
    filters,
    ContextTypes,
)
from duckduckgo_search import DDGS
from agent import run_agent
from knowledge_base import KnowledgeBase, list_knowledge_bases
from specialist_agent import ask_specialist, AGENTS
from voice_agent import text_to_speech, load_voice_config

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("jalza")

OLLAMA_URL = "http://localhost:11434/api/chat"
MODEL = "jalza"
DB_PATH = os.path.join(os.path.dirname(__file__), "memory", "jalza.db")
MEMORY_DIR = os.path.join(os.path.dirname(__file__), "memory")
CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config.json")
MAX_HISTORY = 10
MAX_FACTS = 200

DAY_NAMES = ["pondelok", "utorok", "streda", "štvrtok", "piatok", "sobota", "nedeľa"]


def load_config() -> dict:
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"knowledge_update": {"enabled": True, "day": 0, "hour": 3},
                "scheduled_messages": [], "custom_agents": {}}


def save_config(cfg: dict):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)

EXTRACT_PROMPT = """Z tejto konverzácie extrahuj NOVÉ dôležité fakty o používateľovi alebo jeho firmách.
Pravidlá:
- Len fakty, nie názory alebo otázky
- Heslovito, max 15 slov na fakt
- Ak nie sú žiadne nové fakty, napíš ŽIADNE
- Neduplicuj existujúce fakty

Existujúce fakty:
{existing_facts}

Konverzácia:
{conversation}

Nové fakty (jeden na riadok, začni pomlčkou):"""


def init_db():
    os.makedirs(MEMORY_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""CREATE TABLE IF NOT EXISTS facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fact TEXT NOT NULL UNIQUE,
        category TEXT DEFAULT 'general',
        created_at TEXT NOT NULL
    )""")
    c.execute("""CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
    )""")
    conn.commit()
    conn.close()


def get_facts(limit=MAX_FACTS):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT fact FROM facts ORDER BY id DESC LIMIT ?", (limit,))
    facts = [row[0] for row in c.fetchall()]
    conn.close()
    return facts


def save_fact(fact: str, category: str = "general"):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    try:
        c.execute(
            "INSERT OR IGNORE INTO facts (fact, category, created_at) VALUES (?, ?, ?)",
            (fact.strip(), category, datetime.now().isoformat()),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        pass
    conn.close()


def save_message(chat_id: int, role: str, content: str):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        "INSERT INTO conversations (chat_id, role, content, created_at) VALUES (?, ?, ?, ?)",
        (chat_id, role, content, datetime.now().isoformat()),
    )
    conn.commit()
    conn.close()


def get_history(chat_id: int, limit=MAX_HISTORY):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        "SELECT role, content FROM conversations WHERE chat_id = ? ORDER BY id DESC LIMIT ?",
        (chat_id, limit),
    )
    rows = c.fetchall()
    conn.close()
    rows.reverse()
    return [{"role": r, "content": c} for r, c in rows]


def chat_ollama(messages: list) -> str:
    try:
        resp = requests.post(
            OLLAMA_URL,
            json={"model": MODEL, "messages": messages, "stream": False},
            timeout=300,
        )
        resp.raise_for_status()
        return resp.json()["message"]["content"]
    except Exception as e:
        logger.error(f"Ollama error: {e}")
        return "Chyba pri komunikácii s modelom."


import asyncio

async def chat_ollama_with_typing(messages: list, chat, message_id=None) -> str:
    """Call Ollama while keeping 'typing' indicator alive."""
    loop = asyncio.get_event_loop()

    async def keep_typing():
        while True:
            try:
                await chat.send_action("typing")
            except Exception:
                pass
            await asyncio.sleep(4)

    typing_task = asyncio.create_task(keep_typing())
    try:
        response = await loop.run_in_executor(
            None, lambda: chat_ollama(messages)
        )
        return response
    finally:
        typing_task.cancel()


def extract_facts(conversation_text: str):
    existing = get_facts()
    existing_str = "\n".join(f"- {f}" for f in existing) if existing else "(žiadne)"

    prompt = EXTRACT_PROMPT.format(
        existing_facts=existing_str, conversation=conversation_text
    )

    try:
        resp = requests.post(
            "http://localhost:11434/api/generate",
            json={"model": MODEL, "prompt": prompt, "stream": False},
            timeout=120,
        )
        result = resp.json().get("response", "")

        if "ŽIADNE" in result.upper() or "ZIADNE" in result.upper():
            return []

        new_facts = []
        for line in result.strip().split("\n"):
            line = line.strip().lstrip("-•").strip()
            if line and len(line) > 5 and len(line) < 200:
                new_facts.append(line)
        return new_facts
    except Exception as e:
        logger.error(f"Extract error: {e}")
        return []


async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await cmd_help(update, context)


async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "🤖 *J.A.L.Z.A. — príkazy*\n\n"
        "*💬 Základné:*\n"
        "/help — tento zoznam príkazov\n"
        "/search [text] — hľadaj na webe\n"
        "/task [úloha] — daj agentovi úlohu\n\n"
        "*🧠 Pamäť:*\n"
        "/facts — čo si pamätám\n"
        "/remember [text] — zapamätaj si fakt\n"
        "/forget — zabudni konverzáciu\n\n"
        "*📚 Znalostní agenti:*\n"
        "/knowledge — stav znalostných databáz\n"
        "/learn [agent] — nauč agenta (stiahne zdroje)\n"
        "/refresh [agent] — vymaž staré + stiahni nové\n"
        "/addagent — pridaj nového agenta\n\n"
        "*⚙️ Nastavenia:*\n"
        "/settings — zobraz všetky nastavenia\n"
        "/update\\_day [deň] — zmeň deň auto-updatu\n"
        "/update\\_hour [hodina] — zmeň čas auto-updatu\n"
        "/update\\_toggle — zapni/vypni auto-update\n"
        "/update\\_now — spusti update teraz\n\n"
        "*🔊 Hlas:*\n"
        "/voice [text] — odpoveď hlasovou správou\n"
        "/voice\\_toggle — zapni/vypni hlasové odpovede\n\n"
        "*📧 Email:*\n"
        "/email\\_check — skontroluj nové emaily\n"
        "/email\\_send — pošli email\n"
        "/email\\_cleanup — vymaž marketing a staré emaily\n\n"
        "💡 _Stačí aj normálne napísať otázku — automaticky rozpoznám tému a prepnem na správneho agenta._",
        parse_mode="Markdown",
    )


async def cmd_facts(update: Update, context: ContextTypes.DEFAULT_TYPE):
    facts = get_facts(50)
    if not facts:
        await update.message.reply_text("Zatiaľ si nič nepamätám.")
        return
    text = "📋 Pamätám si:\n\n" + "\n".join(f"• {f}" for f in facts)
    if len(text) > 4000:
        text = text[:4000] + "\n\n... (skrátené)"
    await update.message.reply_text(text)


async def cmd_remember(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = " ".join(context.args) if context.args else ""
    if not text:
        await update.message.reply_text("Použitie: /remember [text]")
        return
    save_fact(text)
    await update.message.reply_text(f"✅ Zapamätal som si: {text}")


async def cmd_forget(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("DELETE FROM conversations WHERE chat_id = ?", (chat_id,))
    conn.commit()
    conn.close()
    await update.message.reply_text("🗑 História konverzácie vymazaná.")


SEARCH_TRIGGERS = [
    "vyhľadaj", "vyhladaj", "googli", "nájdi na webe", "najdi na webe",
    "aktuálne", "aktualne", "dnes", "teraz", "novinky", "správy", "spravy",
    "aká je cena", "aka je cena", "koľko stojí", "kolko stoji",
    "počasie", "pocasie", "kurz", "výsledky", "vysledky",
    "kto vyhral", "kto je", "čo je", "co je", "co je nové", "co je nove",
    "posledné", "posledne", "latest", "search", "find",
    "poznáš", "poznas", "vieš čo", "vies co", "čo znamená", "co znamen",
    "vysvetli", "povedz mi o", "povedz mi niečo", "povedz mi nieco",
    "ako funguje", "čo robí", "co robi", "kde nájdem", "kde najdem",
    "aký je", "aky je", "aké sú", "ake su", "existuje",
    "porovnaj", "odporúčaš", "odporucas", "recenzia", "review",
    "cena", "price", "stránka", "stranka", "web", "url", "link",
]


def needs_web_search(text: str) -> bool:
    lower = text.lower()
    if "?" in text:
        return True
    return any(trigger in lower for trigger in SEARCH_TRIGGERS)


def web_search(query: str, max_results: int = 5) -> str:
    try:
        with DDGS() as ddgs:
            results = list(ddgs.text(query, region="sk-sk", max_results=max_results))
        if not results:
            return ""
        lines = []
        for r in results:
            title = r.get("title", "")
            body = r.get("body", "")
            href = r.get("href", "")
            lines.append(f"- {title}: {body} ({href})")
        return "\n".join(lines)
    except Exception as e:
        logger.error(f"Search error: {e}")
        return ""


async def cmd_search(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = " ".join(context.args) if context.args else ""
    if not query:
        await update.message.reply_text("Použitie: /search [čo hľadáš]")
        return

    await update.message.chat.send_action("typing")
    results = web_search(query, max_results=5)

    if not results:
        await update.message.reply_text("Nenašiel som nič relevantné.")
        return

    chat_id = update.effective_chat.id
    save_message(chat_id, "user", f"Vyhľadaj na webe: {query}")

    search_context = f"Výsledky vyhľadávania pre '{query}':\n{results}"
    messages = [
        {"role": "user", "content": PRIMING_USER},
        {"role": "assistant", "content": PRIMING_ASSISTANT},
        {"role": "user", "content": f"Na základe týchto výsledkov z webu mi odpovedz po slovensky:\n\n{search_context}\n\nOtázka: {query}"},
    ]

    response = chat_ollama(messages)
    if "<think>" in response:
        response = re.sub(r"<think>.*?</think>", "", response, flags=re.DOTALL).strip()

    save_message(chat_id, "assistant", response)

    if len(response) > 4000:
        for i in range(0, len(response), 4000):
            await update.message.reply_text(response[i : i + 4000])
    else:
        await update.message.reply_text(response)


AGENT_TRIGGERS = [
    "spusti", "spusť", "otestuj", "skontroluj", "zisti", "urob", "vytvor",
    "napíš kód", "napis kod", "prečítaj súbor", "precitaj subor",
    "zálohuj", "zalohuj", "reštartuj", "restartuj", "nainštaluj", "nainstaluj",
    "aký je stav", "aky je stav", "koľko miesta", "kolko miesta",
    "analyzuj", "oprav", "uprav súbor", "uprav subor",
]

KNOWLEDGE_TRIGGERS = {
    "uctovnictvo": ["účtovníctvo", "uctovnictvo", "dane", "daň", "dph", "szčo", "szco",
                    "odvody", "faktur", "účtovn", "uctovn", "daňov", "danov"],
    "3d_tlac": ["3d tlač", "3d tlac", "multiboard", "filament", "pla", "petg",
                "tlačiareň", "tlaciaren", "slicer", "stl"],
}


def needs_agent(text: str) -> bool:
    lower = text.lower()
    return any(trigger in lower for trigger in AGENT_TRIGGERS)


async def cmd_task(update: Update, context: ContextTypes.DEFAULT_TYPE):
    task_text = " ".join(context.args) if context.args else ""
    if not task_text:
        await update.message.reply_text(
            "Použitie: /task [úloha]\n\n"
            "Príklady:\n"
            "• /task skontroluj či beží business-flow-ai\n"
            "• /task koľko miesta zaberá disk\n"
            "• /task otestuj endpoint /api/health\n"
            "• /task nájdi všetky TODO v kóde\n"
            "• /task zálohuj databázu"
        )
        return

    await _run_agent_task(update, task_text)


async def _run_agent_task(update: Update, task_text: str):
    chat_id = update.effective_chat.id
    status_msg = await update.message.reply_text(f"🤖 Agent pracuje na: {task_text}\n\nKrok 1...")

    facts = get_facts(20)
    facts_block = ""
    if facts:
        facts_block = "\nFakty:\n" + "\n".join(f"- {f}" for f in facts[:10])

    priming = [
        {"role": "user", "content": PRIMING_USER + facts_block},
        {"role": "assistant", "content": PRIMING_ASSISTANT},
    ]

    loop = asyncio.get_event_loop()

    async def run_with_updates():
        steps = await loop.run_in_executor(None, lambda: run_agent(task_text, priming))
        return steps

    typing_task = asyncio.create_task(_keep_typing(update.message.chat))
    try:
        steps = await run_with_updates()
    finally:
        typing_task.cancel()

    try:
        await status_msg.delete()
    except Exception:
        pass

    report_lines = [f"🤖 *Agent — úloha:* {task_text}\n"]

    for s in steps:
        step_num = s.get("step", "?")
        tool = s.get("tool", "—")
        thought = s.get("thought", "")
        result = s.get("result", "")

        if tool == "done":
            report_lines.append(f"\n✅ *Výsledok:*\n{result[:2000]}")
        else:
            tool_display = s.get("input", "")[:100] if s.get("input") else ""
            report_lines.append(f"*Krok {step_num}* [{tool}]: {tool_display}")
            if thought:
                short_thought = thought[:200] + "..." if len(thought) > 200 else thought
                report_lines.append(f"  💭 _{short_thought}_")

    report = "\n".join(report_lines)
    if len(report) > 4000:
        report = report[:4000] + "\n\n... (skrátené)"

    try:
        await update.message.reply_text(report, parse_mode="Markdown")
    except Exception:
        await update.message.reply_text(report)

    save_message(chat_id, "user", f"[TASK] {task_text}")
    final = next((s["result"] for s in reversed(steps) if s.get("tool") == "done"), "Úloha dokončená")
    save_message(chat_id, "assistant", final)


def _detect_knowledge_agent(text: str) -> str:
    lower = text.lower()
    for agent_key, triggers in KNOWLEDGE_TRIGGERS.items():
        if any(t in lower for t in triggers):
            return agent_key
    for agent_key, agent_cfg in AGENTS.items():
        if agent_key in KNOWLEDGE_TRIGGERS:
            continue
        name_words = agent_cfg.get("name", "").lower().split()
        desc_words = agent_cfg.get("description", "").lower().split()
        keywords = [w for w in name_words + desc_words if len(w) > 3]
        if any(kw in lower for kw in keywords):
            return agent_key
    return ""


async def cmd_learn(update: Update, context: ContextTypes.DEFAULT_TYPE):
    args = " ".join(context.args) if context.args else ""
    if not args:
        agents_list = "\n".join(f"• `{k}` — {v['name']}" for k, v in AGENTS.items())
        bases = list_knowledge_bases()
        stats = "\n".join(f"• {b['name']}: {b['sources']} zdrojov, {b['chunks']} častí" for b in bases) or "Žiadne"
        await update.message.reply_text(
            f"*Dostupní agenti:*\n{agents_list}\n\n"
            f"*Znalostné databázy:*\n{stats}\n\n"
            f"Použitie: /learn <agent> [extra dotazy]\n"
            f"Príklad: /learn uctovnictvo\n"
            f"Príklad: /learn uctovnictvo sociálne odvody 2025",
            parse_mode="Markdown",
        )
        return

    parts = args.split(None, 1)
    agent_key = parts[0].lower()
    extra_queries = parts[1].split(",") if len(parts) > 1 else []

    if agent_key not in AGENTS:
        await update.message.reply_text(f"Neznámy agent: {agent_key}\nDostupní: {', '.join(AGENTS.keys())}")
        return

    agent_config = AGENTS[agent_key]
    kb = KnowledgeBase(agent_config["name"], agent_config["description"])
    queries = agent_config["queries"] + [q.strip() for q in extra_queries if q.strip()]
    p_domains = agent_config.get("priority_domains")
    b_domains = agent_config.get("blocked_domains")

    msg = await update.message.reply_text(f"📚 Učím sa: {agent_config['name']}...\nToto môže trvať niekoľko minút.")
    typing_task = asyncio.create_task(_keep_typing(update.message.chat))

    loop = asyncio.get_event_loop()
    try:
        stats = await loop.run_in_executor(
            None, lambda: kb.scrape_and_add(queries, priority_domains=p_domains, blocked_domains=b_domains)
        )
    finally:
        typing_task.cancel()

    info = kb.get_stats()
    await msg.edit_text(
        f"📚 *{agent_config['name']}* — hotovo\n\n"
        f"Nové zdroje: {stats['downloaded']}\n"
        f"Preskočené: {stats['skipped']}\n"
        f"Celkovo: {info['sources']} zdrojov, {info['chunks']} častí\n"
        f"Znakov: {info['total_chars']:,}",
        parse_mode="Markdown",
    )


async def cmd_settings(update: Update, context: ContextTypes.DEFAULT_TYPE):
    cfg = load_config()
    ku = cfg.get("knowledge_update", {})
    enabled = "✅ zapnutý" if ku.get("enabled", True) else "❌ vypnutý"
    day = DAY_NAMES[ku.get("day", 0)]
    hour = ku.get("hour", 3)

    agents_list = []
    for k, v in AGENTS.items():
        kb = KnowledgeBase(v["name"])
        stats = kb.get_stats()
        agents_list.append(f"  • `{k}` — {v['name']} ({stats['sources']} zdrojov)")

    custom = cfg.get("custom_agents", {})
    for k, v in custom.items():
        agents_list.append(f"  • `{k}` — {v['name']} (vlastný)")

    msgs = cfg.get("scheduled_messages", [])
    msg_list = [f"  • {m['hour']:02d}:{m['minute']:02d} — {m['message'][:40]}" for m in msgs]

    text = (
        f"⚙️ *Nastavenia J.A.L.Z.A.*\n\n"
        f"*Automatický update znalostí:* {enabled}\n"
        f"*Deň:* {day}\n"
        f"*Čas:* {hour}:00\n\n"
        f"*Agenti:*\n" + "\n".join(agents_list) + "\n\n"
        f"*Plánované správy:*\n" + ("\n".join(msg_list) if msg_list else "  žiadne") + "\n\n"
        f"*Príkazy:*\n"
        f"  /update\\_day <deň> — zmeniť deň (pondelok-nedeľa)\n"
        f"  /update\\_hour <hodina> — zmeniť čas (0-23)\n"
        f"  /update\\_toggle — zapnúť/vypnúť auto-update\n"
        f"  /update\\_now — spustiť update teraz\n"
        f"  /refresh <agent> — vymazať a znova stiahnuť\n"
        f"  /addagent — pridať nového agenta\n"
    )
    await update.message.reply_text(text, parse_mode="Markdown")


async def cmd_update_day(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text("Použitie: /update_day <deň>\nNapr: /update_day streda")
        return
    day_input = context.args[0].lower()
    day_map = {d.lower(): i for i, d in enumerate(DAY_NAMES)}
    day_map.update({"po": 0, "ut": 1, "st": 2, "stv": 3, "pi": 4, "so": 5, "ne": 6})
    if day_input not in day_map:
        await update.message.reply_text(f"Neznámy deň. Použi: {', '.join(DAY_NAMES)}")
        return
    cfg = load_config()
    cfg["knowledge_update"]["day"] = day_map[day_input]
    save_config(cfg)
    await update.message.reply_text(f"✅ Update nastavený na: {DAY_NAMES[day_map[day_input]]}")


async def cmd_update_hour(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text("Použitie: /update_hour <hodina>\nNapr: /update_hour 6")
        return
    try:
        hour = int(context.args[0])
        if not 0 <= hour <= 23:
            raise ValueError
    except ValueError:
        await update.message.reply_text("Zadaj číslo 0-23")
        return
    cfg = load_config()
    cfg["knowledge_update"]["hour"] = hour
    save_config(cfg)
    await update.message.reply_text(f"✅ Update nastavený na: {hour}:00")


async def cmd_update_toggle(update: Update, context: ContextTypes.DEFAULT_TYPE):
    cfg = load_config()
    current = cfg.get("knowledge_update", {}).get("enabled", True)
    cfg["knowledge_update"]["enabled"] = not current
    save_config(cfg)
    state = "zapnutý ✅" if not current else "vypnutý ❌"
    await update.message.reply_text(f"Automatický update: {state}")


async def cmd_update_now(update: Update, context: ContextTypes.DEFAULT_TYPE):
    msg = await update.message.reply_text("🔄 Spúšťam update všetkých znalostí...")
    typing_task = asyncio.create_task(_keep_typing(update.message.chat))
    loop = asyncio.get_event_loop()
    try:
        report = await loop.run_in_executor(None, _run_knowledge_update)
    finally:
        typing_task.cancel()
    await msg.edit_text(f"🔄 *Update hotový*\n\n{report}", parse_mode="Markdown")


async def cmd_refresh(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text(
            f"Použitie: /refresh <agent>\nDostupní: {', '.join(AGENTS.keys())}\n\n"
            "⚠️ Vymaže všetky dáta a stiahne nové!"
        )
        return
    agent_key = context.args[0].lower()
    if agent_key not in AGENTS:
        await update.message.reply_text(f"Neznámy agent. Dostupní: {', '.join(AGENTS.keys())}")
        return

    agent_config = AGENTS[agent_key]
    kb = KnowledgeBase(agent_config["name"])
    msg = await update.message.reply_text(f"🔄 Mažem staré dáta a sťahujem nové pre {agent_config['name']}...")
    typing_task = asyncio.create_task(_keep_typing(update.message.chat))
    loop = asyncio.get_event_loop()
    try:
        deleted = await loop.run_in_executor(None, kb.refresh)
        stats = await loop.run_in_executor(
            None,
            lambda: kb.scrape_and_add(
                agent_config["queries"],
                priority_domains=agent_config.get("priority_domains"),
                blocked_domains=agent_config.get("blocked_domains"),
            ),
        )
    finally:
        typing_task.cancel()
    info = kb.get_stats()
    await msg.edit_text(
        f"🔄 *Refresh: {agent_config['name']}*\n\n"
        f"Vymazané: {deleted['deleted_sources']} zdrojov\n"
        f"Nové: {stats['downloaded']} zdrojov\n"
        f"Celkovo: {info['sources']} zdrojov, {info['chunks']} častí",
        parse_mode="Markdown",
    )


async def cmd_addagent(update: Update, context: ContextTypes.DEFAULT_TYPE):
    args = " ".join(context.args) if context.args else ""
    if not args:
        await update.message.reply_text(
            "*Pridanie nového agenta*\n\n"
            "Formát:\n"
            "/addagent <kľúč> | <názov> | <popis> | <dotazy oddelené čiarkou> | <prioritné domény>\n\n"
            "Príklad:\n"
            "`/addagent pravo | Právo SR | Slovenské zákony | "
            "občiansky zákonník slovensko, trestný zákon SR, zákonník práce | "
            "slov-lex.sk, justice.gov.sk`",
            parse_mode="Markdown",
        )
        return

    parts = [p.strip() for p in args.split("|")]
    if len(parts) < 4:
        await update.message.reply_text("Zadaj aspoň: kľúč | názov | popis | dotazy\nOddeľ časti znakom |")
        return

    key = re.sub(r"[^a-z0-9_]", "_", parts[0].lower())
    name = parts[1]
    description = parts[2]
    queries = [q.strip() for q in parts[3].split(",") if q.strip()]
    priority_domains = [d.strip() for d in parts[4].split(",")] if len(parts) > 4 else []

    if key in AGENTS:
        await update.message.reply_text(f"Agent `{key}` už existuje. Zvol iný kľúč.")
        return

    new_agent = {
        "name": name,
        "description": description,
        "queries": queries,
        "priority_domains": priority_domains,
        "blocked_domains": ["facebook.com", "twitter.com", "instagram.com", "youtube.com", "reddit.com"],
        "system_prompt": f"Si expert na tému: {name}. Odpovedaj na základe znalostnej databázy. "
                         f"Odpovedaj stručne a vecne po slovensky.",
    }

    AGENTS[key] = new_agent

    cfg = load_config()
    cfg["custom_agents"][key] = new_agent
    save_config(cfg)

    await update.message.reply_text(
        f"✅ Agent `{key}` pridaný!\n\n"
        f"*{name}*\n{description}\n"
        f"Dotazy: {len(queries)}\n"
        f"Prioritné domény: {', '.join(priority_domains) if priority_domains else 'žiadne'}\n\n"
        f"Teraz spusti: /learn {key}",
        parse_mode="Markdown",
    )


async def cmd_voice(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = " ".join(context.args) if context.args else ""
    if not text:
        await update.message.reply_text(
            "Použitie: /voice <text>\nNapr: /voice Ahoj Juraj, ako sa máš?"
        )
        return

    vcfg = load_voice_config()
    if not vcfg.get("api_key") or not vcfg.get("voice_id"):
        await update.message.reply_text(
            "ElevenLabs nie je nakonfigurovaný.\n"
            "Pridaj do config.json:\n"
            '```\n"elevenlabs": {\n  "api_key": "tvoj-kluc",\n  "voice_id": "id-hlasu"\n}\n```',
            parse_mode="Markdown",
        )
        return

    msg = await update.message.reply_text("🔊 Generujem hlas...")
    loop = asyncio.get_event_loop()
    try:
        audio_path = await loop.run_in_executor(None, lambda: text_to_speech(text))
        await msg.delete()
        with open(audio_path, "rb") as audio:
            await update.message.reply_voice(voice=audio)
    except Exception as e:
        await msg.edit_text(f"Chyba: {str(e)[:200]}")


async def cmd_voice_toggle(update: Update, context: ContextTypes.DEFAULT_TYPE):
    cfg = load_config()
    el = cfg.get("elevenlabs", {})
    current = el.get("auto_voice", False)
    el["auto_voice"] = not current
    cfg["elevenlabs"] = el
    save_config(cfg)
    state = "zapnuté ✅" if not current else "vypnuté ❌"
    await update.message.reply_text(
        f"Hlasové odpovede: {state}\n"
        f"{'Agent bude odpovedať aj hlasovou správou.' if not current else 'Agent bude odpovedať len textom.'}"
    )


async def cmd_email_check(update: Update, context: ContextTypes.DEFAULT_TYPE):
    cfg = load_config()
    email_cfg = cfg.get("email", {})
    if not email_cfg.get("imap", {}).get("server"):
        await update.message.reply_text(
            "Email nie je nakonfigurovaný.\n"
            "Pridaj do config.json:\n"
            '```\n"email": {\n'
            '  "imap": {"server": "imap.gmail.com", "username": "tvoj@gmail.com", "password": "app-password"},\n'
            '  "smtp": {"server": "smtp.gmail.com", "port": 465, "username": "tvoj@gmail.com", "password": "app-password"},\n'
            '  "allowed_senders": ["someone@example.com"],\n'
            '  "auto_reply": false\n'
            "}\n```",
            parse_mode="Markdown",
        )
        return

    msg = await update.message.reply_text("📧 Kontrolujem emaily...")
    loop = asyncio.get_event_loop()
    try:
        from email_agent import check_and_reply
        results = await loop.run_in_executor(None, lambda: check_and_reply(dry_run=not email_cfg.get("auto_reply", False)))

        if not results:
            await msg.edit_text("📧 Žiadne nové emaily.")
            return

        lines = [f"📧 *Nové emaily: {len(results)}*\n"]
        for r in results:
            lines.append(f"*Od:* {r['sender']}")
            lines.append(f"*Predmet:* {r['subject']}")
            lines.append(f"*Akcia:* {r['action']}")
            if r.get("reply_preview"):
                lines.append(f"_Odpoveď: {r['reply_preview'][:100]}..._")
            lines.append("")
        await msg.edit_text("\n".join(lines)[:4000], parse_mode="Markdown")
    except Exception as e:
        await msg.edit_text(f"Chyba: {str(e)[:200]}")


async def cmd_email_send(update: Update, context: ContextTypes.DEFAULT_TYPE):
    args = " ".join(context.args) if context.args else ""
    if not args or "|" not in args:
        await update.message.reply_text(
            "*📧 Odoslanie emailu*\n\n"
            "Formát:\n"
            "/email\\_send adresa@email.com | Predmet | Text správy\n\n"
            "Príklady:\n"
            "`/email_send simona@adsun.sk | Faktúry | Ahoj Simona, pošli mi prosím faktúry za február.`\n\n"
            "`/email_send zuzka@email.com | Nákup | Zuzka, kúp prosím mlieko a chlieb.`\n\n"
            "Alebo nechaj agenta napísať email:\n"
            "`/email_send simona@adsun.sk | Faktúry | AUTO: napíš zdvorilý email že potrebujem faktúry za február`",
            parse_mode="Markdown",
        )
        return

    parts = [p.strip() for p in args.split("|", 2)]
    if len(parts) < 3:
        await update.message.reply_text("Zadaj: adresa | predmet | text\nOddeľ časti znakom |")
        return

    to_addr = parts[0]
    subject = parts[1]
    body = parts[2]

    if body.upper().startswith("AUTO:"):
        instruction = body[5:].strip()
        msg = await update.message.reply_text("✍️ Agent píše email...")
        typing_task = asyncio.create_task(_keep_typing(update.message.chat))
        loop = asyncio.get_event_loop()
        try:
            payload = {
                "model": MODEL,
                "messages": [
                    {"role": "system", "content": (
                        "Napíš email v mene Juraja Martinkových. "
                        "Buď zdvorilý, profesionálny a stručný. Píš po slovensky. "
                        "Výstup je len samotný text emailu, bez predmetu a bez podpisu."
                    )},
                    {"role": "user", "content": f"Adresát: {to_addr}\nPredmet: {subject}\nInštrukcia: {instruction}"},
                ],
                "stream": False,
            }
            r = await loop.run_in_executor(
                None,
                lambda: requests.post(OLLAMA_URL, json=payload, timeout=120)
            )
            body = r.json().get("message", {}).get("content", "")
        finally:
            typing_task.cancel()
        await msg.edit_text(
            f"✍️ *Návrh emailu:*\n\n"
            f"*Komu:* {to_addr}\n"
            f"*Predmet:* {subject}\n\n"
            f"{body}\n\n"
            f"_Odoslať? Použi:_\n"
            f"`/email_confirm {to_addr} | {subject} | {body}`",
            parse_mode="Markdown",
        )
        return

    from email_agent import send_reply, load_email_config
    cfg = load_email_config()
    smtp_cfg = cfg.get("smtp", {})
    if not smtp_cfg.get("server"):
        await update.message.reply_text("SMTP nie je nakonfigurovaný.")
        return

    try:
        send_reply(smtp_cfg, to_addr, subject, body)
        await update.message.reply_text(f"✅ Email odoslaný!\n\nKomu: {to_addr}\nPredmet: {subject}")
    except Exception as e:
        await update.message.reply_text(f"❌ Chyba: {str(e)[:200]}")


async def cmd_email_confirm(update: Update, context: ContextTypes.DEFAULT_TYPE):
    args = " ".join(context.args) if context.args else ""
    if not args or "|" not in args:
        await update.message.reply_text("Použi /email_send na vytvorenie emailu.")
        return

    parts = [p.strip() for p in args.split("|", 2)]
    if len(parts) < 3:
        await update.message.reply_text("Chýbajú údaje.")
        return

    to_addr, subject, body = parts[0], parts[1], parts[2]

    from email_agent import send_reply, load_email_config
    cfg = load_email_config()
    smtp_cfg = cfg.get("smtp", {})

    try:
        send_reply(smtp_cfg, to_addr, subject, body)
        await update.message.reply_text(f"✅ Email odoslaný!\n\nKomu: {to_addr}\nPredmet: {subject}")
    except Exception as e:
        await update.message.reply_text(f"❌ Chyba: {str(e)[:200]}")


async def cmd_email_cleanup(update: Update, context: ContextTypes.DEFAULT_TYPE):
    args = " ".join(context.args).lower() if context.args else ""

    if not args:
        await update.message.reply_text(
            "*📧 Čistenie emailov*\n\n"
            "Najprv spustím náhľad (nič sa nevymaže):\n"
            "/email\\_cleanup scan — pozri koľko marketingu a starých mailov máš\n\n"
            "Potom na vymazanie:\n"
            "/email\\_cleanup delete — vymaž marketing + staršie ako 1 rok\n"
            "/email\\_cleanup marketing — vymaž len marketing\n"
            "/email\\_cleanup old — vymaž len staršie ako 1 rok",
            parse_mode="Markdown",
        )
        return

    from email_agent import cleanup_emails

    if args == "scan":
        msg = await update.message.reply_text("📧 Skenujem mailbox... (môže trvať)")
        typing_task = asyncio.create_task(_keep_typing(update.message.chat))
        loop = asyncio.get_event_loop()
        try:
            stats = await loop.run_in_executor(None, lambda: cleanup_emails(
                delete_marketing=True, delete_older_than_days=365, dry_run=True
            ))
        finally:
            typing_task.cancel()
        await msg.edit_text(
            f"📧 *Scan hotový (nič sa nevymazalo)*\n\n"
            f"Marketing emailov: *{stats['marketing_found']}*\n"
            f"Starších ako 1 rok: *{stats['old_found']}*\n\n"
            f"Na vymazanie použi:\n"
            f"/email\\_cleanup delete",
            parse_mode="Markdown",
        )

    elif args in ("delete", "all"):
        msg = await update.message.reply_text("📧 ⚠️ Mažem marketing + staršie ako 1 rok...")
        typing_task = asyncio.create_task(_keep_typing(update.message.chat))
        loop = asyncio.get_event_loop()
        try:
            stats = await loop.run_in_executor(None, lambda: cleanup_emails(
                delete_marketing=True, delete_older_than_days=365, dry_run=False
            ))
        finally:
            typing_task.cancel()
        await msg.edit_text(
            f"📧 *Čistenie hotové*\n\n"
            f"Marketing: {stats['marketing_found']}\n"
            f"Staré (1+ rok): {stats['old_found']}\n"
            f"*Vymazaných celkovo: {stats['deleted']}*",
            parse_mode="Markdown",
        )

    elif args == "marketing":
        msg = await update.message.reply_text("📧 Mažem marketingové emaily...")
        typing_task = asyncio.create_task(_keep_typing(update.message.chat))
        loop = asyncio.get_event_loop()
        try:
            stats = await loop.run_in_executor(None, lambda: cleanup_emails(
                delete_marketing=True, delete_older_than_days=0, dry_run=False
            ))
        finally:
            typing_task.cancel()
        await msg.edit_text(
            f"📧 *Marketing vymazaný*\n\nNájdených: {stats['marketing_found']}\nVymazaných: {stats['deleted']}",
            parse_mode="Markdown",
        )

    elif args == "old":
        msg = await update.message.reply_text("📧 Mažem emaily staršie ako 1 rok...")
        typing_task = asyncio.create_task(_keep_typing(update.message.chat))
        loop = asyncio.get_event_loop()
        try:
            stats = await loop.run_in_executor(None, lambda: cleanup_emails(
                delete_marketing=False, delete_older_than_days=365, dry_run=False
            ))
        finally:
            typing_task.cancel()
        await msg.edit_text(
            f"📧 *Staré emaily vymazané*\n\nNájdených: {stats['old_found']}\nVymazaných: {stats['deleted']}",
            parse_mode="Markdown",
        )
    else:
        await update.message.reply_text("Neznámy príkaz. Použi /email_cleanup bez argumentov pre pomoc.")


async def cmd_knowledge(update: Update, context: ContextTypes.DEFAULT_TYPE):
    bases = list_knowledge_bases()
    if not bases:
        await update.message.reply_text("Žiadne znalostné databázy. Použi /learn <agent>")
        return
    lines = ["*Znalostné databázy:*\n"]
    for b in bases:
        lines.append(f"📚 *{b['name']}*: {b['sources']} zdrojov, {b['chunks']} častí, {b['total_chars']:,} znakov")
    await update.message.reply_text("\n".join(lines), parse_mode="Markdown")


async def _ask_knowledge_agent(update: Update, agent_key: str, question: str):
    agent_config = AGENTS[agent_key]
    kb = KnowledgeBase(agent_config["name"], agent_config["description"])
    info = kb.get_stats()

    if info["chunks"] == 0:
        await update.message.reply_text(
            f"Agent {agent_config['name']} nemá žiadne znalosti. Spusti najprv /learn {agent_key}"
        )
        return

    msg = await update.message.reply_text(f"📚 Hľadám v: {agent_config['name']}...")
    typing_task = asyncio.create_task(_keep_typing(update.message.chat))

    loop = asyncio.get_event_loop()
    try:
        answer = await loop.run_in_executor(
            None,
            lambda: ask_specialist(kb, question, agent_config.get("system_prompt", "")),
        )
    finally:
        typing_task.cancel()

    try:
        await msg.delete()
    except Exception:
        pass

    header = f"📚 *{agent_config['name']}*\n\n"
    await update.message.reply_text(header + answer[:4000], parse_mode="Markdown")


async def _keep_typing(chat):
    while True:
        try:
            await chat.send_action("typing")
        except Exception:
            pass
        await asyncio.sleep(4)


VISION_MODEL = "qwen2.5vl:3b"


async def handle_photo(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    caption = update.message.caption or "Čo je na tomto obrázku? Odpovedz po slovensky."
    status_msg = await update.message.reply_text("Analyzujem obrázok...")

    try:
        photo = update.message.photo[-1]
        file = await context.bot.get_file(photo.file_id)
        tmp_dir = os.path.join(os.path.dirname(__file__), "tmp")
        os.makedirs(tmp_dir, exist_ok=True)
        img_path = os.path.join(tmp_dir, f"{photo.file_id}.jpg")
        await file.download_to_drive(img_path)

        with open(img_path, "rb") as f:
            img_b64 = base64.b64encode(f.read()).decode("utf-8")

        try:
            os.remove(img_path)
        except Exception:
            pass

        await status_msg.edit_text("Premýšľam nad obrázkom...")

        messages = [
            {"role": "user", "content": PRIMING_USER},
            {"role": "assistant", "content": PRIMING_ASSISTANT},
            {
                "role": "user",
                "content": caption,
                "images": [img_b64],
            },
        ]

        async def keep_typing():
            while True:
                try:
                    await update.message.chat.send_action("typing")
                except Exception:
                    pass
                await asyncio.sleep(4)

        typing_task = asyncio.create_task(keep_typing())
        try:
            loop = asyncio.get_event_loop()
            resp = await loop.run_in_executor(None, lambda: requests.post(
                OLLAMA_URL,
                json={"model": VISION_MODEL, "messages": messages, "stream": False},
                timeout=300,
            ))
            resp.raise_for_status()
            response = resp.json()["message"]["content"]
        except Exception as e:
            response = f"Chyba pri analýze obrázku: {str(e)[:200]}"
        finally:
            typing_task.cancel()

        if "<think>" in response:
            response = re.sub(r"<think>.*?</think>", "", response, re.DOTALL).strip()

        try:
            await status_msg.delete()
        except Exception:
            pass

        save_message(chat_id, "user", f"[FOTO] {caption}")
        save_message(chat_id, "assistant", response)

        if len(response) > 4000:
            for i in range(0, len(response), 4000):
                await update.message.reply_text(response[i : i + 4000])
        else:
            await update.message.reply_text(response)

    except Exception as e:
        logger.error(f"Photo handler error: {e}")
        try:
            await status_msg.edit_text(f"Chyba: {str(e)[:200]}")
        except Exception:
            await update.message.reply_text("Chyba pri spracovaní obrázku.")


async def handle_voice(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    status_msg = await update.message.reply_text("Prepíšem hlasovú správu...")

    try:
        voice = update.message.voice or update.message.audio
        if not voice:
            await status_msg.edit_text("Nepodarilo sa načítať hlasovú správu.")
            return

        file = await context.bot.get_file(voice.file_id)
        tmp_dir = os.path.join(os.path.dirname(__file__), "tmp")
        os.makedirs(tmp_dir, exist_ok=True)
        ogg_path = os.path.join(tmp_dir, f"{voice.file_id}.ogg")
        await file.download_to_drive(ogg_path)

        await status_msg.edit_text("Prepisujem hlas na text (Whisper)...")

        import whisper
        loop = asyncio.get_event_loop()
        model = whisper.load_model("base")
        result = await loop.run_in_executor(
            None, lambda: model.transcribe(ogg_path, language="sk")
        )
        transcribed = result.get("text", "").strip()

        try:
            os.remove(ogg_path)
        except Exception:
            pass

        if not transcribed:
            await status_msg.edit_text("Nepodarilo sa prepísať hlasovú správu.")
            return

        await status_msg.edit_text(f"Rozumel som: \"{transcribed}\"\n\nPremýšľam...")

        save_message(chat_id, "user", transcribed)

        facts = get_facts(30)
        facts_block = ""
        if facts:
            facts_block = "\n\nĎalšie fakty o Jurajovi:\n" + "\n".join(f"- {f}" for f in facts[:20])

        search_context = ""
        if needs_web_search(transcribed):
            search_query = transcribed
            lower = transcribed.lower()
            if "počasie" in lower or "pocasie" in lower:
                search_query = "počasie Bratislava Petržalka zajtra predpoveď"
            search_results = web_search(search_query, max_results=5)
            if search_results:
                search_context = (
                    f"\n\nVYHĽADÁVANIE NA WEBE — reálne výsledky:\n{search_results}\n"
                    f"Zhrň po slovensky s konkrétnymi údajmi."
                )

        priming = [
            {"role": "user", "content": PRIMING_USER + facts_block + search_context},
            {"role": "assistant", "content": PRIMING_ASSISTANT},
        ]
        history = get_history(chat_id, MAX_HISTORY)
        messages = priming + history

        response = await chat_ollama_with_typing(messages, update.message.chat)

        thinking_text = ""
        answer = response
        if "<think>" in response:
            think_match = re.search(r"<think>(.*?)</think>", response, flags=re.DOTALL)
            if think_match:
                thinking_text = think_match.group(1).strip()
            answer = re.sub(r"<think>.*?</think>", "", response, flags=re.DOTALL).strip()

        try:
            await status_msg.delete()
        except Exception:
            pass

        if thinking_text:
            short_think = thinking_text[:1500] + "..." if len(thinking_text) > 1500 else thinking_text
            await update.message.reply_text(f"💭 *Myšlienky:*\n_{short_think}_", parse_mode="Markdown")

        save_message(chat_id, "assistant", answer)

        if len(answer) > 4000:
            for i in range(0, len(answer), 4000):
                await update.message.reply_text(answer[i : i + 4000])
        else:
            await update.message.reply_text(answer)

    except Exception as e:
        logger.error(f"Voice handler error: {e}")
        try:
            await status_msg.edit_text(f"Chyba pri spracovaní hlasu: {str(e)[:200]}")
        except Exception:
            await update.message.reply_text("Chyba pri spracovaní hlasovej správy.")


PRIMING_USER = """Ahoj J.A.L.Z.A., som Juraj Martinkových, tvoj vlastník. VŽDY mi odpovedaj PO SLOVENSKY. Nikdy po anglicky.

Tu sú moje údaje — zapamätaj si ich a vždy mi ich povedz keď sa opýtam:

- Meno: Juraj, Priezvisko: Martinkových
- Vek: 45 rokov
- Bydlisko: Bratislava, Petržalka, Slovensko
- Manželka: Zuzka Martinkových, 35 rokov
- Syn: Adam, 8 rokov — LEGO, Minecraft, bojové športy
- Dcéra: Livinka, 3 roky — tenis
- Meniny: Juraj má meniny 24. apríla (sviatok svätého Juraja)
- Firma: ADSUN s.r.o., Pezinok — reklama, polepy áut, svetelné reklamy, tlač
- Spolupracovníci: Juraj Chlepko (riaditeľ), Jozef Tomášek (inovácie), Simona Jurčíková (účtovníctvo)
- Projekt: business-flow-ai — Next.js, TypeScript, Drizzle ORM

DÔLEŽITÉ: Odpovedaj VŽDY po slovensky! Nikdy nie po anglicky!"""

PRIMING_ASSISTANT = """Ahoj Juraj! Zapamätal som si všetko a budem odpovedať PO SLOVENSKY:
- Si Juraj Martinkových, 45r, Bratislava, Petržalka
- Manželka Zuzka (35), syn Adam (8), dcéra Livinka (3)
- Meniny máš 24. apríla
- Firma ADSUN v Pezinku — reklama, polepy, svetelné reklamy
- Vyvíjaš business-flow-ai
Pýtaj sa na čokoľvek!"""


async def _email_draft_step(update: Update, context: ContextTypes.DEFAULT_TYPE, user_text: str):
    """Interaktívny email flow so stavovým sledovaním."""
    draft = context.user_data.get("email_draft", {})
    step = draft.get("step", "init")
    lower = user_text.lower().strip()

    cancel_words = ["zrus", "zruš", "cancel", "stop", "nie", "nechci", "koniec"]
    if any(w == lower for w in cancel_words):
        context.user_data.pop("email_draft", None)
        await update.message.reply_text("❌ Písanie emailu zrušené.")
        return

    if step == "confirm":
        yes_words = ["ano", "áno", "ok", "odosli", "odošli", "posli", "pošli", "hej", "jo", "jasne", "jasné", "sure", "da"]
        if any(w in lower for w in yes_words):
            from email_agent import send_reply, load_email_config
            cfg = load_email_config()
            smtp_cfg = cfg.get("smtp", {})
            if not smtp_cfg.get("server"):
                await update.message.reply_text("SMTP nie je nakonfigurovaný.")
                context.user_data.pop("email_draft", None)
                return
            try:
                send_reply(smtp_cfg, draft["to"], draft["subject"], draft["body"])
                await update.message.reply_text(
                    f"✅ Email odoslaný!\n\n"
                    f"Komu: {draft['to']}\n"
                    f"Predmet: {draft['subject']}"
                )
            except Exception as e:
                await update.message.reply_text(f"❌ Chyba pri odoslaní: {str(e)[:200]}")
            context.user_data.pop("email_draft", None)
            return
        else:
            context.user_data["email_draft"]["step"] = "init"
            context.user_data["email_draft"]["messages"].append(
                {"role": "user", "content": user_text}
            )

    if step == "init" or step == "awaiting":
        msgs = draft.get("messages", [])
        if not msgs:
            msgs = [{"role": "user", "content": user_text}]

        sys_prompt = (
            "Si J.A.L.Z.A., asistent Juraja Martinkových. Juraj chce poslať email.\n"
            "Tvoja úloha: Zisti komu (email adresa), predmet a obsah emailu.\n"
            "Ak máš všetky 3 údaje, napíš hotový email a na POSLEDNOM riadku daj PRESNE tento formát:\n"
            "📧DRAFT|adresa@email.com|Predmet emailu|Celý text emailu\n"
            "Ak nemáš niektorý údaj (chýba adresa, predmet alebo obsah), opýtaj sa na chýbajúce.\n"
            "Odpovedaj VŽDY po slovensky. Buď stručný."
        )

        msg = await update.message.reply_text("✍️ Pripravujem email...")
        typing_task = asyncio.create_task(_keep_typing(update.message.chat))
        loop = asyncio.get_event_loop()
        try:
            payload = {
                "model": MODEL,
                "messages": [{"role": "system", "content": sys_prompt}] + msgs,
                "stream": False,
            }
            r = await loop.run_in_executor(
                None, lambda: requests.post(OLLAMA_URL, json=payload, timeout=120)
            )
            response = r.json().get("message", {}).get("content", "Nepodarilo sa.")
        finally:
            typing_task.cancel()
        try:
            await msg.delete()
        except Exception:
            pass

        draft_match = re.search(r"📧DRAFT\|([^|]+)\|([^|]+)\|(.*)", response, re.DOTALL)
        if draft_match:
            to_addr = draft_match.group(1).strip()
            subject = draft_match.group(2).strip()
            body = draft_match.group(3).strip()
            display_text = re.sub(r"📧DRAFT\|.*", "", response, flags=re.DOTALL).strip()
            context.user_data["email_draft"] = {
                "step": "confirm",
                "to": to_addr,
                "subject": subject,
                "body": body,
                "messages": msgs + [{"role": "assistant", "content": response}],
            }
            preview = (
                f"{display_text}\n\n"
                f"---\n"
                f"📧 *Návrh emailu:*\n"
                f"*Komu:* {to_addr}\n"
                f"*Predmet:* {subject}\n\n"
                f"{body}\n\n"
                f"---\n"
                f"_Odoslať? Napíš_ *áno* _alebo_ *nie*"
            )
            await update.message.reply_text(preview, parse_mode="Markdown")
        else:
            msgs.append({"role": "assistant", "content": response})
            context.user_data["email_draft"] = {
                "step": "awaiting",
                "messages": msgs,
            }
            await update.message.reply_text(response)
        return


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    user_text = update.message.text

    # === AKTÍVNY EMAIL DRAFT → pokračuj v ňom ===
    if context.user_data.get("email_draft"):
        await _email_draft_step(update, context, user_text)
        return

    if needs_agent(user_text):
        await _run_agent_task(update, user_text)
        return

    lower_text = user_text.lower()

    # === EMAIL — prirodzený jazyk ===
    mail_words = ["mail", "email", "e-mail", "maily", "emaily"]
    has_mail_word = any(w in lower_text for w in mail_words)

    email_send_words = ["napis", "napíš", "posli", "pošli", "odosli", "odošli",
                        "napisat", "poslat", "odoslat", "odpovedat", "odpovedz"]
    email_check_words = ["skontroluj", "pozri", "over", "ukaž", "ukaz", "zobraz",
                         "precitaj", "prečítaj", "prislo", "prišlo", "dostal",
                         "posledny", "posledný", "posledne", "posledné", "novy", "nové", "nove",
                         "dnesny", "dnešný", "dnesne", "dnešné", "dnesnz",
                         "co mam", "čo mám", "kolko mam", "koľko mám",
                         "ake mam", "aké mám", "moj", "môj", "moje", "mám",
                         "neprecitane", "neprečítané", "chcem vediet", "chcem vedieť"]
    email_cleanup_words = ["vymaz", "vymaž", "zmaz", "zmaž", "vycisti", "vyčisti",
                           "uprac", "upracem", "odstan", "odstráň",
                           "marketing", "spam", "stare", "staré", "starsie", "staršie",
                           "nepotrebn", "cleanup"]

    if has_mail_word:
        if any(w in lower_text for w in email_cleanup_words):
            context.args = ["scan"]
            await cmd_email_cleanup(update, context)
            return
        if any(w in lower_text for w in email_send_words):
            await _email_draft_step(update, context, user_text)
            return
        if any(w in lower_text for w in email_check_words):
            await cmd_email_check(update, context)
            return
        await cmd_email_check(update, context)
        return

    learn_triggers = ["nauč sa", "nauc sa", "nastuduj", "naštuduj", "nauč sa všetko", "nauc sa vsetko"]
    is_learn_request = any(t in lower_text for t in learn_triggers)
    if is_learn_request:
        agent_key = _detect_knowledge_agent(user_text)
        if agent_key:
            agent_config = AGENTS[agent_key]
            kb = KnowledgeBase(agent_config["name"], agent_config["description"])
            queries = agent_config["queries"]
            p_domains = agent_config.get("priority_domains")
            b_domains = agent_config.get("blocked_domains")
            msg = await update.message.reply_text(f"📚 Učím sa: {agent_config['name']}...\nToto môže trvať niekoľko minút.")
            typing_task = asyncio.create_task(_keep_typing(update.message.chat))
            loop = asyncio.get_event_loop()
            try:
                stats = await loop.run_in_executor(
                    None, lambda: kb.scrape_and_add(queries, priority_domains=p_domains, blocked_domains=b_domains)
                )
            finally:
                typing_task.cancel()
            info = kb.get_stats()
            await msg.edit_text(
                f"📚 *{agent_config['name']}* — hotovo\n\n"
                f"Nové zdroje: {stats['downloaded']}\n"
                f"Preskočené: {stats['skipped']}\n"
                f"Celkovo: {info['sources']} zdrojov, {info['chunks']} častí\n"
                f"Znakov: {info['total_chars']:,}",
                parse_mode="Markdown",
            )
            return
        else:
            await update.message.reply_text(
                "Nemôžem určiť oblasť. Použi /learn <agent> alebo spresni tému.\n"
                f"Dostupné: {', '.join(AGENTS.keys())}"
            )
            return

    agent_key = _detect_knowledge_agent(user_text)
    if agent_key:
        kb = KnowledgeBase(AGENTS[agent_key]["name"])
        if kb.get_stats()["chunks"] > 0:
            await _ask_knowledge_agent(update, agent_key, user_text)
            return

    save_message(chat_id, "user", user_text)

    facts = get_facts(30)
    facts_block = ""
    if facts:
        facts_block = "\n\nĎalšie fakty o Jurajovi:\n" + "\n".join(f"- {f}" for f in facts[:20])

    search_context = ""
    if needs_web_search(user_text):
        search_query = user_text
        lower = user_text.lower()
        if "počasie" in lower or "pocasie" in lower:
            search_query = f"počasie Bratislava Petržalka zajtra predpoveď"
        search_results = web_search(search_query, max_results=5)
        if search_results:
            search_context = (
                f"\n\nVYHĽADÁVANIE NA WEBE — toto sú REÁLNE aktuálne výsledky z internetu, použi ich vo svojej odpovedi:\n"
                f"{search_results}\n"
                f"Zhrň tieto výsledky po slovensky a daj konkrétne údaje."
            )

    priming = [
        {"role": "user", "content": PRIMING_USER + facts_block + search_context},
        {"role": "assistant", "content": PRIMING_ASSISTANT},
    ]

    history = get_history(chat_id, MAX_HISTORY)
    messages = priming + history

    thinking_msg = await update.message.reply_text("Premýšľam...")

    response = await chat_ollama_with_typing(messages, update.message.chat)

    thinking_text = ""
    answer = response
    if "<think>" in response:
        think_match = re.search(r"<think>(.*?)</think>", response, flags=re.DOTALL)
        if think_match:
            thinking_text = think_match.group(1).strip()
        answer = re.sub(r"<think>.*?</think>", "", response, flags=re.DOTALL).strip()

    try:
        await thinking_msg.delete()
    except Exception:
        pass

    if thinking_text:
        short_think = thinking_text[:1500] + "..." if len(thinking_text) > 1500 else thinking_text
        await update.message.reply_text(f"💭 *Myšlienky:*\n_{short_think}_", parse_mode="Markdown")

    save_message(chat_id, "assistant", answer)

    if len(answer) > 4000:
        for i in range(0, len(answer), 4000):
            await update.message.reply_text(answer[i : i + 4000])
    else:
        await update.message.reply_text(answer)

    # Extract facts every 5 messages
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM conversations WHERE chat_id = ?", (chat_id,))
    count = c.fetchone()[0]
    conn.close()

    if count % 10 == 0 and count > 0:
        conv_text = "\n".join(f"{m['role']}: {m['content']}" for m in history[-10:])
        new_facts = extract_facts(conv_text)
        for fact in new_facts[:5]:
            save_fact(fact)
            logger.info(f"New fact saved: {fact}")


OWNER_CHAT_ID = 7054332348

SCHEDULED_MESSAGES = [
    {"hour": 19, "minute": 0, "message": "🌙 Dobrý večer Juraj! Ako prebehol deň? Ak potrebuješ niečo, som tu."},
    {"hour": 20, "minute": 0, "message": "⏰ Juraj, je 20:00 — pomaly čas na odpočinok. Dobrú noc!"},
    {"hour": 7, "minute": 0, "message": "☀️ Dobré ráno Juraj! Nový deň, nové možnosti. Napíš mi ak chceš vedieť počasie alebo čo ťa dnes čaká."},
]




def _run_knowledge_update() -> str:
    results = []
    for agent_key, cfg in AGENTS.items():
        try:
            kb = KnowledgeBase(cfg["name"])
            old_stats = kb.get_stats()
            stats = kb.scrape_and_add(
                cfg["queries"],
                priority_domains=cfg.get("priority_domains"),
                blocked_domains=cfg.get("blocked_domains"),
            )
            new_stats = kb.get_stats()
            if stats["downloaded"] > 0:
                results.append(
                    f"📚 *{cfg['name']}*: +{stats['downloaded']} nových zdrojov "
                    f"(celkovo {new_stats['sources']})"
                )
            else:
                results.append(f"📚 *{cfg['name']}*: žiadne nové zdroje")
        except Exception as e:
            results.append(f"📚 *{cfg['name']}*: chyba — {str(e)[:100]}")
    return "\n".join(results)


async def scheduler(app_instance):
    sent_today = set()
    knowledge_updated_this_week = set()
    while True:
        now = datetime.now()
        time_key = f"{now.year}-{now.month}-{now.day}"
        week_key = f"{now.year}-W{now.isocalendar()[1]}"
        cfg = load_config()

        for sched in cfg.get("scheduled_messages", SCHEDULED_MESSAGES):
            msg_id = f"{time_key}-{sched['hour']}-{sched['minute']}"
            if msg_id in sent_today:
                continue
            if now.hour == sched["hour"] and now.minute == sched["minute"]:
                try:
                    await app_instance.bot.send_message(
                        chat_id=OWNER_CHAT_ID,
                        text=sched["message"],
                    )
                    sent_today.add(msg_id)
                except Exception as e:
                    logger.error(f"Scheduler error: {e}")

        ku = cfg.get("knowledge_update", {})
        if (ku.get("enabled", True)
                and now.weekday() == ku.get("day", 0)
                and now.hour == ku.get("hour", 3)
                and week_key not in knowledge_updated_this_week):
            knowledge_updated_this_week.add(week_key)
            logger.info("Spúšťam týždenný knowledge update...")
            try:
                for ck, cv in cfg.get("custom_agents", {}).items():
                    if ck not in AGENTS:
                        AGENTS[ck] = cv
                loop = asyncio.get_event_loop()
                report = await loop.run_in_executor(None, _run_knowledge_update)
                await app_instance.bot.send_message(
                    chat_id=OWNER_CHAT_ID,
                    text=f"🔄 *Týždenný update znalostí*\n\n{report}",
                    parse_mode="Markdown",
                )
            except Exception as e:
                logger.error(f"Knowledge update error: {e}")

        if now.hour == 0 and now.minute == 0:
            sent_today.clear()

        await asyncio.sleep(30)


def main():
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        env_file = os.path.join(os.path.dirname(__file__), ".env")
        if os.path.exists(env_file):
            with open(env_file) as f:
                for line in f:
                    if line.startswith("TELEGRAM_BOT_TOKEN="):
                        token = line.split("=", 1)[1].strip()
    if not token:
        print("TELEGRAM_BOT_TOKEN nie je nastavený!")
        print("Vytvor súbor jalza/.env s riadkom: TELEGRAM_BOT_TOKEN=tvoj_token")
        return

    init_db()

    for md_file in ["facts.md", "business.md", "goals.md"]:
        path = os.path.join(MEMORY_DIR, md_file)
        if os.path.exists(path):
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute("SELECT COUNT(*) FROM facts WHERE category = ?", (md_file,))
            if c.fetchone()[0] == 0:
                with open(path) as f:
                    for line in f:
                        line = line.strip().lstrip("-•").strip()
                        if line and len(line) > 10 and not line.startswith("#"):
                            save_fact(line, category=md_file)
            conn.close()

    cfg = load_config()
    for ck, cv in cfg.get("custom_agents", {}).items():
        if ck not in AGENTS:
            AGENTS[ck] = cv
            logger.info(f"Loaded custom agent: {ck}")

    app = Application.builder().token(token).build()

    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("help", cmd_help))
    app.add_handler(CommandHandler("task", cmd_task))
    app.add_handler(CommandHandler("search", cmd_search))
    app.add_handler(CommandHandler("facts", cmd_facts))
    app.add_handler(CommandHandler("remember", cmd_remember))
    app.add_handler(CommandHandler("forget", cmd_forget))
    app.add_handler(CommandHandler("learn", cmd_learn))
    app.add_handler(CommandHandler("knowledge", cmd_knowledge))
    app.add_handler(CommandHandler("settings", cmd_settings))
    app.add_handler(CommandHandler("update_day", cmd_update_day))
    app.add_handler(CommandHandler("update_hour", cmd_update_hour))
    app.add_handler(CommandHandler("update_toggle", cmd_update_toggle))
    app.add_handler(CommandHandler("update_now", cmd_update_now))
    app.add_handler(CommandHandler("refresh", cmd_refresh))
    app.add_handler(CommandHandler("addagent", cmd_addagent))
    app.add_handler(CommandHandler("voice", cmd_voice))
    app.add_handler(CommandHandler("voice_toggle", cmd_voice_toggle))
    app.add_handler(CommandHandler("email_check", cmd_email_check))
    app.add_handler(CommandHandler("email_send", cmd_email_send))
    app.add_handler(CommandHandler("email_confirm", cmd_email_confirm))
    app.add_handler(CommandHandler("email_cleanup", cmd_email_cleanup))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    app.add_handler(MessageHandler(filters.PHOTO, handle_photo))
    app.add_handler(MessageHandler(filters.VOICE | filters.AUDIO, handle_voice))

    async def post_init(application):
        asyncio.create_task(scheduler(application))
        logger.info("Scheduler started")

    app.post_init = post_init

    # Minimal HTTP health server for Railway
    import threading
    from http.server import HTTPServer, BaseHTTPRequestHandler

    class _HealthHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"J.A.L.Z.A. is alive")
        def log_message(self, *args):
            pass

    _port = int(os.environ.get("PORT", 8080))
    _srv = HTTPServer(("0.0.0.0", _port), _HealthHandler)
    threading.Thread(target=_srv.serve_forever, daemon=True).start()
    logger.info(f"Health endpoint on port {_port}")

    print("J.A.L.Z.A. Telegram bot beží...")
    app.run_polling()


if __name__ == "__main__":
    main()
