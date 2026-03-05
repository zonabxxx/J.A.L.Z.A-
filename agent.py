"""
J.A.L.Z.A. Agent — autonómny agent s nástrojmi.
Vie spúšťať príkazy, čítať/písať súbory, hľadať na webe, a plánovať úlohy.
"""
import os
import re
import json
import subprocess
import logging
import requests
from duckduckgo_search import DDGS

logger = logging.getLogger("jalza.agent")

OLLAMA_URL = "http://localhost:11434/api/chat"
MODEL = "jalza"
MAX_AGENT_STEPS = 8
WORKSPACE = "/Users/jurajmartinkovych/Documents/workspaceAI"

TOOLS_DESCRIPTION = """
Máš k dispozícii tieto NÁSTROJE. Keď potrebuješ niečo urobiť, použi presne tento formát:

[TOOL: shell]
príkaz na spustenie
[/TOOL]

[TOOL: read_file]
/cesta/k/súboru
[/TOOL]

[TOOL: write_file]
/cesta/k/súboru
---
obsah súboru
[/TOOL]

[TOOL: web_search]
čo hľadám
[/TOOL]

[TOOL: list_files]
/cesta/k/priečinku
[/TOOL]

[TOOL: learn_topic]
téma
dotaz1
dotaz2
[/TOOL]

Príklad: learn_topic na tému "Daňové zákony SR":
[TOOL: learn_topic]
Daňové zákony SR
zákon o dani z príjmov 595/2003 slov-lex
DPH zákon 222/2004 slovensko
daň z pridanej hodnoty SR 2024
[/TOOL]

[TOOL: done]
záverečná odpoveď pre Juraja
[/TOOL]

PRAVIDLÁ:
1. Použi VŽDY nástroj keď potrebuješ informáciu alebo vykonať akciu
2. Po každom nástroji dostaneš výsledok a môžeš pokračovať
3. Keď si hotový, použi [TOOL: done] so záverečnou odpoveďou
4. Premýšľaj krok po kroku — najprv plán, potom akcia
5. Odpovedaj PO SLOVENSKY
6. NIKDY nemažeš produkčné dáta bez potvrdenia
7. Maximálne {max_steps} krokov
"""


def execute_tool(tool_name: str, tool_input: str) -> str:
    tool_input = tool_input.strip()

    if tool_name == "shell":
        return _tool_shell(tool_input)
    elif tool_name == "read_file":
        return _tool_read_file(tool_input)
    elif tool_name == "write_file":
        return _tool_write_file(tool_input)
    elif tool_name == "web_search":
        return _tool_web_search(tool_input)
    elif tool_name == "list_files":
        return _tool_list_files(tool_input)
    elif tool_name == "learn_topic":
        return _tool_learn_topic(tool_input)
    elif tool_name == "done":
        return None
    else:
        return f"Neznámy nástroj: {tool_name}"


def _tool_shell(command: str) -> str:
    BLOCKED = ["rm -rf /", "rm -rf ~", "mkfs", "dd if=", "> /dev/sd"]
    for blocked in BLOCKED:
        if blocked in command:
            return f"BLOKOVANÉ: Nebezpečný príkaz '{blocked}'"

    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=60,
            cwd=WORKSPACE,
            env={**os.environ, "PATH": f"{os.path.expanduser('~')}/.local/bin:{os.environ.get('PATH', '')}"},
        )
        output = result.stdout[-3000:] if len(result.stdout) > 3000 else result.stdout
        stderr = result.stderr[-1000:] if len(result.stderr) > 1000 else result.stderr
        return f"Exit code: {result.returncode}\nSTDOUT:\n{output}\nSTDERR:\n{stderr}"
    except subprocess.TimeoutExpired:
        return "CHYBA: Príkaz prekročil časový limit 60s"
    except Exception as e:
        return f"CHYBA: {str(e)}"


def _tool_read_file(path: str) -> str:
    path = path.strip()
    if not os.path.exists(path):
        return f"Súbor neexistuje: {path}"
    try:
        with open(path, "r") as f:
            content = f.read()
        if len(content) > 5000:
            return content[:5000] + f"\n\n... (skrátené, celkovo {len(content)} znakov)"
        return content
    except Exception as e:
        return f"CHYBA pri čítaní: {str(e)}"


def _tool_write_file(input_text: str) -> str:
    parts = input_text.split("---", 1)
    if len(parts) != 2:
        return "CHYBA: Formát musí byť: /cesta/k/súboru\\n---\\nobsah"
    path = parts[0].strip()
    content = parts[1].strip()

    PROTECTED = [".env", "credentials", "id_rsa", "id_ed25519"]
    if any(p in path.lower() for p in PROTECTED):
        return f"BLOKOVANÉ: Nemôžem zapisovať do chráneného súboru: {path}"

    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(content)
        return f"Súbor zapísaný: {path} ({len(content)} znakov)"
    except Exception as e:
        return f"CHYBA pri zápise: {str(e)}"


def _tool_web_search(query: str) -> str:
    try:
        with DDGS() as ddgs:
            results = list(ddgs.text(query, region="sk-sk", max_results=5))
        if not results:
            return "Žiadne výsledky"
        lines = []
        for r in results:
            lines.append(f"- {r.get('title', '')}: {r.get('body', '')} ({r.get('href', '')})")
        return "\n".join(lines)
    except Exception as e:
        return f"CHYBA vyhľadávania: {str(e)}"


def _tool_list_files(path: str) -> str:
    path = path.strip() or WORKSPACE
    if not os.path.isdir(path):
        return f"Nie je priečinok: {path}"
    try:
        entries = sorted(os.listdir(path))[:50]
        lines = []
        for e in entries:
            full = os.path.join(path, e)
            kind = "DIR" if os.path.isdir(full) else "FILE"
            size = os.path.getsize(full) if os.path.isfile(full) else ""
            lines.append(f"  {kind}  {e}  {size}")
        return f"Obsah {path}:\n" + "\n".join(lines)
    except Exception as e:
        return f"CHYBA: {str(e)}"


def _tool_learn_topic(input_text: str) -> str:
    lines = input_text.strip().split("\n")
    if not lines:
        return "CHYBA: Zadaj tému a vyhľadávacie dotazy"
    topic = lines[0].strip()
    queries = [l.strip() for l in lines[1:] if l.strip()] or None
    try:
        from knowledge_scraper import scrape_topic, list_knowledge
        stats = scrape_topic(topic, queries, num_results=10)
        result = f"Téma: {topic}\n"
        result += f"Nájdené výsledky: {stats['searched']}\n"
        result += f"Stiahnuté dokumenty: {stats['downloaded']}\n"
        result += f"Preskočené (duplicity): {stats['skipped']}\n"
        result += f"Chyby: {stats['errors']}\n"
        result += f"Celkovo znakov: {stats['total_chars']:,}\n\n"
        result += "Aktuálne znalosti:\n"
        for k in list_knowledge():
            result += f"  - {k['topic']}: {k['documents']} dokumentov, {k['characters']:,} znakov\n"
        return result
    except Exception as e:
        return f"CHYBA: {str(e)}"


def parse_tool_call(response: str):
    pattern = r'\[TOOL:\s*(\w+)\](.*?)\[/TOOL\]'
    match = re.search(pattern, response, re.DOTALL)
    if match:
        return match.group(1).strip(), match.group(2).strip()
    return None, None


def run_agent(task: str, priming_messages: list = None) -> list:
    """
    Run the agent loop. Returns a list of steps:
    [{"step": 1, "thought": "...", "tool": "...", "input": "...", "result": "..."}, ...]
    """
    tools_prompt = TOOLS_DESCRIPTION.replace("{max_steps}", str(MAX_AGENT_STEPS))

    messages = list(priming_messages) if priming_messages else []
    messages.append({
        "role": "user",
        "content": (
            f"{tools_prompt}\n\n"
            f"ÚLOHA: {task}\n\n"
            f"Premýšľaj krok po kroku. Najprv si sprav plán, potom použi nástroje. "
            f"Po SLOVENSKY."
        ),
    })

    steps = []

    for step_num in range(1, MAX_AGENT_STEPS + 1):
        try:
            resp = requests.post(
                OLLAMA_URL,
                json={"model": MODEL, "messages": messages, "stream": False},
                timeout=300,
            )
            resp.raise_for_status()
            response = resp.json()["message"]["content"]
        except Exception as e:
            steps.append({"step": step_num, "error": str(e)})
            break

        clean_response = response
        if "<think>" in response:
            thinking = re.search(r"<think>(.*?)</think>", response, re.DOTALL)
            clean_response = re.sub(r"<think>.*?</think>", "", response, re.DOTALL).strip()
            thought = thinking.group(1).strip() if thinking else ""
        else:
            thought = ""

        tool_name, tool_input = parse_tool_call(clean_response)

        if tool_name == "done":
            steps.append({
                "step": step_num,
                "thought": thought[:500],
                "tool": "done",
                "result": tool_input,
            })
            break

        if tool_name:
            tool_result = execute_tool(tool_name, tool_input)
            steps.append({
                "step": step_num,
                "thought": thought[:500],
                "tool": tool_name,
                "input": tool_input[:200],
                "result": str(tool_result)[:2000],
            })

            messages.append({"role": "assistant", "content": response})
            messages.append({
                "role": "user",
                "content": f"Výsledok nástroja [{tool_name}]:\n{tool_result}\n\nPokračuj ďalším krokom alebo použi [TOOL: done] ak si hotový.",
            })
        else:
            steps.append({
                "step": step_num,
                "thought": thought[:500],
                "tool": None,
                "result": clean_response[:2000],
            })
            break

    return steps
