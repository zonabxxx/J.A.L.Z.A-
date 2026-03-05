"""
title: J.A.L.Z.A. Smart Router
description: Lokálny model + znalostní agenti + email + Gemini pre web search + pamäť
author: jalza
version: 8.4
"""

from pydantic import BaseModel, Field
from typing import Union
import requests
import json
import re
import unicodedata
import os
import sqlite3
from datetime import datetime

MEMORY_DB = "/app/backend/data/jalza_memory.db"

class Pipe:
    class Valves(BaseModel):
        text_model: str = Field(default="jalza", description="Lokálny model pre text")
        vision_model: str = Field(default="qwen2.5vl:3b", description="Lokálny model pre obrázky")
        gemini_api_key: str = Field(
            default="AIzaSyARjKGPfJ5-bHpDSQchCVO8za2yRGpwSiE",
            description="Gemini API kľúč (len pre web search)",
        )
        gemini_model: str = Field(default="gemini-2.0-flash", description="Gemini model")
        ollama_url: str = Field(
            default="http://host.docker.internal:11434", description="Ollama API URL"
        )
        knowledge_api_url: str = Field(
            default="http://host.docker.internal:8765", description="Knowledge API URL"
        )

    def __init__(self):
        self.valves = self.Valves()
        self._init_memory()

    def _init_memory(self):
        try:
            os.makedirs(os.path.dirname(MEMORY_DB), exist_ok=True)
            conn = sqlite3.connect(MEMORY_DB)
            conn.execute("""CREATE TABLE IF NOT EXISTS facts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                fact TEXT UNIQUE,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )""")
            conn.execute("""CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                role TEXT,
                content TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )""")
            conn.commit()
            conn.close()
        except Exception:
            pass

    def _get_facts(self, limit=20) -> str:
        try:
            conn = sqlite3.connect(MEMORY_DB)
            rows = conn.execute(
                "SELECT fact FROM facts ORDER BY id DESC LIMIT ?", (limit,)
            ).fetchall()
            conn.close()
            if rows:
                return "MOJA PAMÄŤ:\n" + "\n".join(f"- {r[0]}" for r in rows)
        except Exception:
            pass
        return ""

    def _save_facts(self, text: str):
        try:
            conn = sqlite3.connect(MEMORY_DB)
            save_triggers = ["zapamätaj", "zapamataj", "ulož", "uloz", "pamätaj",
                           "pamataj", "zapíš", "zapis", "poznač", "poznac"]
            lower = self._remove_accents(text.lower())
            if any(t in lower for t in save_triggers):
                clean = text
                for t in save_triggers:
                    clean = re.sub(t, "", self._remove_accents(clean.lower()))
                clean = re.sub(r"^[\s,.:;si že]+", "", clean).strip()
                if len(clean) > 5:
                    conn.execute(
                        "INSERT OR IGNORE INTO facts (fact) VALUES (?)", (clean,)
                    )
                    conn.commit()
            conn.close()
        except Exception:
            pass

    def _extract_and_save_facts(self, user_msg: str, assistant_msg: str):
        try:
            payload = {
                "model": self.valves.text_model,
                "messages": [
                    {"role": "system", "content": """Z tejto konverzácie extrahuj dôležité fakty o používateľovi.
Formát: jeden fakt na riadok, stručne. Ak nie sú žiadne nové fakty, napíš ŽIADNE."""},
                    {"role": "user", "content": f"Používateľ: {user_msg}\nAsistent: {assistant_msg}"}
                ],
                "stream": False,
                "options": {"num_ctx": 2048}
            }
            r = requests.post(
                f"{self.valves.ollama_url}/api/chat", json=payload, timeout=30
            )
            if r.ok:
                facts_text = r.json().get("message", {}).get("content", "")
                if "ŽIADNE" not in facts_text and "žiadne" not in facts_text:
                    conn = sqlite3.connect(MEMORY_DB)
                    for line in facts_text.strip().split("\n"):
                        line = re.sub(r"^[-\•*\d.)\s]+", "", line).strip()
                        if len(line) > 5:
                            conn.execute(
                                "INSERT OR IGNORE INTO facts (fact) VALUES (?)",
                                (line,),
                            )
                    conn.commit()
                    conn.close()
        except Exception:
            pass

    def pipes(self) -> list[dict]:
        return [{"id": "jalza_auto", "name": "J.A.L.Z.A. Auto"}]

    SEARCH_TRIGGERS = [
        "najdi", "hladaj", "vyhladaj", "link", "strank", "url", "webov",
        "aktualn", "teraz", "pocasie", "cena", "kolko stoj",
        "kde kupi", "kde najd", "novinky", "spravy", "najnovs",
        "recenzi", "porovnaj", "odporuc", "download", "stiahnut", "stiahni",
        "na webe", "na nete", "na internete", "online",
        "thingiverse", "github", "youtube", "printables",
    ]

    MAIL_WORDS = ["mail", "email", "e-mail", "maily", "emaily", "e-maily",
                  "mailbox", "schranky", "schranku", "dorucen"]

    MAIL_SEND_WORDS = ["napis", "posli", "odosli", "napisat", "poslat", "odoslat",
                       "odpovedz", "odpovedat", "odpoved na"]
    MAIL_CHECK_WORDS = ["skontroluj", "pozri", "over", "ukaz", "zobraz", "precitaj",
                        "prislo", "dostal", "posledny", "posledne", "novy", "nove",
                        "novih", "nových", "novych", "dnesny", "dnesne", "dnesnz",
                        "co mam", "co je", "kolko mam", "ake mam", "moj", "moje",
                        "neprecitane", "neprecitany", "neprečítané", "chcem vediet"]
    MAIL_CLEANUP_WORDS = ["vymaz", "zmaz", "vycisti", "uprac", "odstan",
                          "marketing", "spam", "stare", "starsie", "nepotrebn",
                          "cleanup", "cisteni", "cistenie", "vymazat"]

    ADSUN_WORDS = ["adsun", "info@adsun", "firemn", "firmov", "pracovn",
                   "biznis", "business", "obchodn"]
    JURAJ_ADSUN_WORDS = ["juraj@adsun", "juraj adsun", "mojho adsun", "moj adsun",
                         "mojom adsun", "mojich adsun"]

    @staticmethod
    def _remove_accents(text: str) -> str:
        nfkd = unicodedata.normalize("NFKD", text)
        return "".join(c for c in nfkd if not unicodedata.combining(c))

    def _needs_search(self, text: str) -> bool:
        lower = self._remove_accents(text.lower())
        return any(t in lower for t in self.SEARCH_TRIGGERS)

    def _is_juraj_adsun_email(self, text: str) -> bool:
        lower = self._remove_accents(text.lower())
        return any(w in lower for w in self.JURAJ_ADSUN_WORDS)

    def _is_adsun_email(self, text: str) -> bool:
        lower = self._remove_accents(text.lower())
        return any(w in lower for w in self.ADSUN_WORDS)

    def _detect_email_action(self, text: str) -> str:
        lower = self._remove_accents(text.lower())
        has_mail_word = any(w in lower for w in self.MAIL_WORDS)
        if not has_mail_word:
            return ""
        if any(w in lower for w in self.MAIL_CLEANUP_WORDS):
            return "cleanup"
        if any(w in lower for w in self.MAIL_SEND_WORDS):
            return "send"
        if any(w in lower for w in self.MAIL_CHECK_WORDS):
            return "check"
        return "check"

    def _detect_knowledge_agent(self, text: str) -> dict:
        try:
            r = requests.post(
                f"{self.valves.knowledge_api_url}/detect",
                json={"text": text},
                timeout=5,
            )
            if r.ok:
                data = r.json()
                if data.get("agent") and data.get("has_knowledge"):
                    return data
        except Exception:
            pass
        return {}

    def _get_knowledge_context(self, agent_key: str, question: str) -> dict:
        try:
            r = requests.post(
                f"{self.valves.knowledge_api_url}/context",
                json={"agent": agent_key, "question": question, "top_k": 5},
                timeout=60,
            )
            if r.ok:
                return r.json()
        except Exception:
            pass
        return {}

    def _convert_messages_ollama(self, messages):
        converted = []
        has_images = False
        for msg in messages:
            content = msg.get("content")
            if isinstance(content, list):
                text_parts = []
                images = []
                for part in content:
                    if isinstance(part, dict):
                        if part.get("type") == "text":
                            text_parts.append(part.get("text", ""))
                        elif part.get("type") == "image_url":
                            url = part.get("image_url", {}).get("url", "")
                            if url.startswith("data:"):
                                base64_data = re.sub(r"^data:[^;]+;base64,", "", url)
                                images.append(base64_data)
                                has_images = True
                new_msg = {
                    "role": msg.get("role", "user"),
                    "content": " ".join(text_parts) or "Čo je na tomto obrázku? Odpovedz po slovensky.",
                }
                if images:
                    new_msg["images"] = images
                converted.append(new_msg)
            else:
                converted.append({"role": msg.get("role", "user"), "content": content or ""})
        return converted, has_images

    def _call_gemini(self, messages, stream=True):
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.valves.gemini_api_key}",
        }
        payload = {"model": self.valves.gemini_model, "messages": messages, "stream": stream}
        r = requests.post(
            "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
            headers=headers, json=payload, stream=stream, timeout=120,
        )
        r.raise_for_status()
        return r

    def _stream_gemini(self, r):
        for line in r.iter_lines():
            if line:
                line_str = line.decode("utf-8", errors="ignore")
                if line_str.startswith("data: "):
                    json_str = line_str[6:]
                    if json_str.strip() == "[DONE]":
                        break
                    try:
                        data = json.loads(json_str)
                        delta = (
                            data.get("choices", [{}])[0]
                            .get("delta", {})
                            .get("content", "")
                        )
                        if delta:
                            yield delta
                    except json.JSONDecodeError:
                        pass

    def _handle_juraj_email(self, action: str, user_msg: str):
        api = self.valves.knowledge_api_url

        if action == "check":
            def gen():
                yield "*[📧 Juraj Email — juraj@adsun.sk]*\n\n"
                yield "_Kontrolujem mailbox juraj@adsun.sk..._\n\n"
                try:
                    r = requests.post(
                        f"{api}/email/juraj/list",
                        json={"limit": 10, "unseen_only": True},
                        timeout=30,
                    )
                    if not r.ok:
                        yield f"Chyba: {r.text}"
                        return
                    data = r.json()
                    if data.get("error"):
                        yield f"Chyba: {data['error']}"
                        return
                    emails = data.get("emails", [])
                    if not emails:
                        yield "Žiadne nové neprečítané emaily v juraj@adsun.sk."
                        return
                    yield f"**Nové emaily: {len(emails)}**\n\n"
                    for i, e in enumerate(emails[:10], 1):
                        yield f"---\n**{i}.** "
                        yield f"**Od:** {e.get('sender', '')} ({e.get('sender_email', '')})\n"
                        yield f"**Predmet:** {e.get('subject', '?')}\n"
                        date = e.get("date", "")
                        if date:
                            yield f"**Dátum:** {date[:16]}\n"
                        preview = e.get("body", "")[:200]
                        if preview:
                            yield f"**Náhľad:** {preview}...\n\n"
                except Exception as ex:
                    yield f"Chyba: {str(ex)}"
            return gen()

        elif action == "send":
            def gen():
                yield "*[📧 Juraj Email — odosielanie z juraj@adsun.sk]*\n\n"
                try:
                    r = requests.post(
                        f"{self.valves.ollama_url}/api/chat",
                        json={
                            "model": self.valves.text_model,
                            "messages": [
                                {"role": "system", "content": (
                                    "Si J.A.L.Z.A., asistent Juraja z ADsun s.r.o. Juraj chce poslať email z juraj@adsun.sk. "
                                    "Z jeho správy zisti: komu, predmet, obsah. "
                                    "Ak nie je jasné komu alebo čo, opýtaj sa. "
                                    "Ak je všetko jasné, napíš profesionálny email. "
                                    "Na konci uveď: KOMU: adresa@email.com | PREDMET: text"
                                )},
                                {"role": "user", "content": user_msg},
                            ],
                            "stream": True,
                        },
                        stream=True, timeout=300,
                    )
                    r.raise_for_status()
                    for line in r.iter_lines():
                        if line:
                            data = json.loads(line)
                            c = data.get("message", {}).get("content", "")
                            if c:
                                yield c
                except Exception as ex:
                    yield f"\n\nChyba: {str(ex)}"
            return gen()

        return self._handle_juraj_email("check", user_msg)

    def _handle_adsun_email(self, action: str, user_msg: str):
        api = self.valves.knowledge_api_url

        if action == "check":
            def gen():
                yield "*[📧 ADsun Email — info@adsun.sk]*\n\n"
                yield "_Kontrolujem mailbox info@adsun.sk..._\n\n"
                try:
                    r = requests.post(
                        f"{api}/email/adsun/list",
                        json={"limit": 10, "unseen_only": True},
                        timeout=30,
                    )
                    if not r.ok:
                        yield f"Chyba: {r.text}"
                        return
                    data = r.json()
                    if data.get("error"):
                        yield f"Chyba: {data['error']}"
                        return
                    emails = data.get("emails", [])
                    if not emails:
                        yield "Žiadne nové neprečítané emaily v info@adsun.sk."
                        return
                    yield f"**Nové emaily: {len(emails)}**\n\n"
                    for i, e in enumerate(emails[:10], 1):
                        yield f"---\n**{i}.** "
                        yield f"**Od:** {e.get('sender', '')} ({e.get('sender_email', '')})\n"
                        yield f"**Predmet:** {e.get('subject', '?')}\n"
                        date = e.get("date", "")
                        if date:
                            yield f"**Dátum:** {date[:16]}\n"
                        preview = e.get("body", "")[:200]
                        if preview:
                            yield f"**Náhľad:** {preview}...\n\n"
                except Exception as ex:
                    yield f"Chyba: {str(ex)}"
            return gen()

        elif action == "send":
            def gen():
                yield "*[📧 ADsun Email — odosielanie z info@adsun.sk]*\n\n"
                try:
                    r = requests.post(
                        f"{self.valves.ollama_url}/api/chat",
                        json={
                            "model": self.valves.text_model,
                            "messages": [
                                {"role": "system", "content": (
                                    "Si J.A.L.Z.A., asistent firmy ADsun s.r.o. Juraj chce poslať firemný email z info@adsun.sk. "
                                    "Z jeho správy zisti: komu, predmet, obsah. "
                                    "Ak nie je jasné komu alebo čo, opýtaj sa. "
                                    "Ak je všetko jasné, napíš profesionálny email. "
                                    "Na konci uveď: KOMU: adresa@email.com | PREDMET: text"
                                )},
                                {"role": "user", "content": user_msg},
                            ],
                            "stream": True,
                        },
                        stream=True, timeout=300,
                    )
                    r.raise_for_status()
                    for line in r.iter_lines():
                        if line:
                            data = json.loads(line)
                            c = data.get("message", {}).get("content", "")
                            if c:
                                yield c
                except Exception as ex:
                    yield f"\n\nChyba: {str(ex)}"
            return gen()

        elif action == "search":
            lower = self._remove_accents(user_msg.lower())
            for w in self.MAIL_WORDS + self.ADSUN_WORDS + self.MAIL_CHECK_WORDS:
                lower = lower.replace(w, "")
            query = lower.strip() or "dopyt"

            def gen():
                yield "*[📧 ADsun Email — vyhľadávanie]*\n\n"
                yield f"_Hľadám v info@adsun.sk: \"{query}\"..._\n\n"
                try:
                    r = requests.post(
                        f"{api}/email/adsun/search",
                        json={"query": query, "limit": 10},
                        timeout=30,
                    )
                    if not r.ok:
                        yield f"Chyba: {r.text}"
                        return
                    data = r.json()
                    emails = data.get("emails", [])
                    if not emails:
                        yield "Nič som nenašiel."
                        return
                    yield f"**Výsledky: {len(emails)}**\n\n"
                    for i, e in enumerate(emails[:10], 1):
                        yield f"**{i}.** {e.get('sender_email', '')} — {e.get('subject', '')}\n"
                        yield f"   {e.get('date', '')[:16]}  |  {e.get('body', '')[:100]}...\n\n"
                except Exception as ex:
                    yield f"Chyba: {str(ex)}"
            return gen()

        return self._handle_adsun_email("check", user_msg)

    def _handle_email(self, action: str, user_msg: str):
        api = self.valves.knowledge_api_url

        if action == "check":
            lower_msg = self._remove_accents(user_msg.lower())
            today = any(w in lower_msg for w in ["dnes", "dnesny", "dnesne", "dnesnz", "dnesnych"])

            def gen():
                yield "*[📧 Email]*\n\n"
                if today:
                    yield "_Načítavam dnešné emaily..._\n\n"
                else:
                    yield "_Kontrolujem mailbox..._\n\n"
                try:
                    payload = {"today_only": today, "limit": 10}
                    r = requests.post(f"{api}/email/check", json=payload, timeout=30)
                    if not r.ok:
                        yield f"Chyba: {r.text}"
                        return
                    data = r.json()
                    if data.get("error"):
                        yield f"Chyba: {data['error']}"
                        return
                    emails = data.get("emails", [])
                    if not emails:
                        if today:
                            yield "Dnes nemáš žiadne nové emaily."
                        else:
                            yield "Žiadne nové neprečítané emaily."
                        return
                    label = "Dnešné emaily" if today else "Nové emaily"
                    yield f"**{label}: {len(emails)}**\n\n"
                    for i, e in enumerate(emails[:10], 1):
                        yield f"---\n**{i}.** "
                        yield f"**Od:** {e.get('sender', '?')}\n"
                        yield f"**Predmet:** {e.get('subject', '?')}\n"
                        date = e.get('date', '')
                        if date:
                            yield f"**Dátum:** {date}\n"
                        preview = e.get('body', '')[:200]
                        if preview:
                            yield f"**Náhľad:** {preview}...\n\n"
                except Exception as ex:
                    yield f"Chyba: {str(ex)}"
            return gen()

        elif action == "cleanup":
            lower_msg = self._remove_accents(user_msg.lower())
            do_delete = any(w in lower_msg for w in ["vymaz", "zmaz", "odstran", "vycisti", "uprac", "zbav"])

            def gen():
                yield "*[📧 Email čistenie]*\n\n"
                if do_delete:
                    yield "_Mažem marketingové a staré emaily..._\n\n"
                else:
                    yield "_Skenujem mailbox..._\n\n"
                try:
                    r = requests.post(
                        f"{api}/email/cleanup",
                        json={"dry_run": not do_delete},
                        timeout=120,
                    )
                    if not r.ok:
                        yield f"Chyba: {r.text}"
                        return
                    data = r.json()
                    if data.get("error"):
                        yield f"Chyba: {data['error']}"
                        return
                    yield f"**Marketing emailov:** {data.get('marketing_found', 0)}\n"
                    yield f"**Starších ako 1 rok:** {data.get('old_found', 0)}\n"
                    if do_delete:
                        yield f"\n**Vymazaných: {data.get('deleted', 0)}** emailov\n"
                    else:
                        yield "\n_Toto bol len scan. Napíš \"vymaž marketingové maily\" pre skutočné vymazanie._\n"
                except Exception as ex:
                    yield f"Chyba: {str(ex)}"
            return gen()

        elif action == "send":
            def gen():
                yield "*[📧 Písanie emailu]*\n\n"
                try:
                    r = requests.post(
                        f"{self.valves.ollama_url}/api/chat",
                        json={
                            "model": self.valves.text_model,
                            "messages": [
                                {"role": "system", "content": (
                                    "Si J.A.L.Z.A., asistent Juraja Martinkových. Juraj chce poslať email. "
                                    "Z jeho správy zisti: komu, predmet, obsah. "
                                    "Ak nie je jasné komu alebo čo, opýtaj sa. "
                                    "Ak je všetko jasné, napíš zdvorilý email po slovensky. "
                                    "Na konci uveď: KOMU: adresa@email.com | PREDMET: text | aby mohol email schváliť a odoslať."
                                )},
                                {"role": "user", "content": user_msg},
                            ],
                            "stream": True,
                        },
                        stream=True, timeout=300,
                    )
                    r.raise_for_status()
                    for line in r.iter_lines():
                        if line:
                            data = json.loads(line)
                            c = data.get("message", {}).get("content", "")
                            if c:
                                yield c
                except Exception as ex:
                    yield f"\n\nChyba: {str(ex)}"
            return gen()

    def pipe(self, body: dict) -> Union[str, dict]:
        messages = body.get("messages", [])
        stream = body.get("stream", True)
        ollama_messages, has_images = self._convert_messages_ollama(messages)
        last_user_msg = ""
        for m in reversed(ollama_messages):
            if m.get("role") == "user":
                last_user_msg = m.get("content", "")
                break

        self._save_facts(last_user_msg)

        # === OBRÁZKY → lokálny vision model ===
        if has_images:
            label = f"👁 {self.valves.vision_model}"
            def img_gen():
                yield f"*[{label}]*\n\n"
                try:
                    r = requests.post(
                        f"{self.valves.ollama_url}/api/chat",
                        json={"model": self.valves.vision_model, "messages": ollama_messages, "stream": True},
                        stream=True, timeout=600,
                    )
                    r.raise_for_status()
                    for line in r.iter_lines():
                        if line:
                            data = json.loads(line)
                            c = data.get("message", {}).get("content", "")
                            if c:
                                yield c
                except Exception as e:
                    yield f"\n\nChyba: {str(e)}"
            return img_gen()

        # === EMAIL → čítanie, písanie, čistenie (PRED web search!) ===
        email_action = self._detect_email_action(last_user_msg)
        if email_action:
            if self._is_juraj_adsun_email(last_user_msg):
                return self._handle_juraj_email(email_action, last_user_msg)
            if self._is_adsun_email(last_user_msg):
                return self._handle_adsun_email(email_action, last_user_msg)
            return self._handle_email(email_action, last_user_msg)

        # === ZNALOSTNÝ AGENT → lokálna RAG databáza (s podporou multi-KB) ===
        kb_info = self._detect_knowledge_agent(last_user_msg)
        if kb_info:
            agent_key = kb_info["agent"]
            agent_name = kb_info["name"]
            linked_kbs = kb_info.get("linked_kbs", [])

            def knowledge_gen():
                if linked_kbs:
                    kb_label = f"{agent_name} + {len(linked_kbs)} prepojených"
                    yield f"*[📚 {kb_label}]*\n\n"
                    yield f"_Hľadám v {1 + len(linked_kbs)} znalostných databázach..._\n\n"
                else:
                    yield f"*[📚 {agent_name}]*\n\n"
                    yield f"_Hľadám v znalostnej databáze..._\n\n"
                try:
                    ctx = self._get_knowledge_context(agent_key, last_user_msg)
                    if not ctx or "context" not in ctx:
                        yield "Nepodarilo sa získať kontext zo znalostnej databázy."
                        return
                    used_kbs = ctx.get("used_kbs", [agent_name])
                    chunks_used = ctx.get("context_chunks", "?")
                    budget = ctx.get("context_budget", "?")
                    if len(used_kbs) > 1:
                        yield f"_Použité zdroje: {', '.join(used_kbs)} ({chunks_used}/{budget} chunks)_\n\n"
                    sys_prompt = ctx.get("system_prompt", "")
                    context = ctx["context"]
                    kb_messages = [
                        {"role": "system", "content": sys_prompt},
                        {"role": "user", "content": f"{context}\n\nOTÁZKA: {last_user_msg}"},
                    ]
                    r = requests.post(
                        f"{self.valves.ollama_url}/api/chat",
                        json={"model": self.valves.text_model, "messages": kb_messages, "stream": True},
                        stream=True, timeout=600,
                    )
                    r.raise_for_status()
                    for line in r.iter_lines():
                        if line:
                            data = json.loads(line)
                            c = data.get("message", {}).get("content", "")
                            if c:
                                yield c
                except Exception as e:
                    yield f"\n\nChyba: {str(e)}"
            return knowledge_gen()

        # === WEB SEARCH → Gemini (cloud) ===
        if self._needs_search(last_user_msg):
            label = f"✨ {self.valves.gemini_model} + 🔍 web"
            try:
                r = self._call_gemini(messages, stream)
                if stream:
                    def gen():
                        yield f"*[{label}]*\n\n"
                        full = ""
                        for chunk in self._stream_gemini(r):
                            full += chunk
                            yield chunk
                        self._extract_and_save_facts(last_user_msg, full)
                    return gen()
                else:
                    data = r.json()
                    content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                    self._extract_and_save_facts(last_user_msg, content)
                    return f"*[{label}]*\n\n" + content
            except Exception as e:
                return f"*[{label}]*\n\nChyba: {str(e)}"

        # === BEŽNÝ TEXT → lokálny jalza + pamäť ===
        label = f"🧠 {self.valves.text_model}"
        memory = self._get_facts()
        if memory:
            ollama_messages.insert(0, {"role": "system", "content": memory})

        def text_gen():
            yield f"*[{label}]*\n\n"
            try:
                r = requests.post(
                    f"{self.valves.ollama_url}/api/chat",
                    json={"model": self.valves.text_model, "messages": ollama_messages, "stream": True},
                    stream=True, timeout=600,
                )
                r.raise_for_status()
                full = ""
                for line in r.iter_lines():
                    if line:
                        data = json.loads(line)
                        c = data.get("message", {}).get("content", "")
                        if c:
                            full += c
                            yield c
                self._extract_and_save_facts(last_user_msg, full)
            except Exception as e:
                yield f"\n\nChyba: {str(e)}"
        return text_gen()
