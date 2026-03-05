"""
REST API pre znalostné bázy J.A.L.Z.A.
Beží na porte 8765, pipe funkcia v Open WebUI ho volá cez host.docker.internal.
"""

import os
import re
import json
import hmac
import sqlite3
import secrets
import hashlib
import base64
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
from knowledge_base import KnowledgeBase, list_knowledge_bases
from specialist_agent import ask_specialist, AGENTS

PORT = 8765
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")
CONVERSATIONS_DB = os.path.join(BASE_DIR, "conversations.db")

# Load .env file
_env_path = os.path.join(BASE_DIR, ".env")
if os.path.isfile(_env_path):
    with open(_env_path) as _ef:
        for _line in _ef:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _, _v = _line.partition("=")
                os.environ.setdefault(_k.strip(), _v.strip())

API_TOKEN = os.environ.get("JALZA_API_TOKEN", "")
DB_ENCRYPTION_KEY = os.environ.get("JALZA_DB_ENCRYPTION_KEY", "")

# ── Encryption helpers (Fernet AES-256-CBC) ───────────────────────────
_fernet = None

def _get_fernet():
    global _fernet
    if _fernet is not None:
        return _fernet
    if not DB_ENCRYPTION_KEY:
        return None
    try:
        from cryptography.fernet import Fernet
        raw = hashlib.sha256(DB_ENCRYPTION_KEY.encode()).digest()
        key = base64.urlsafe_b64encode(raw)
        _fernet = Fernet(key)
        return _fernet
    except ImportError:
        return None


def encrypt_text(text: str) -> str:
    f = _get_fernet()
    if not f:
        return text
    return f.encrypt(text.encode("utf-8")).decode("ascii")


def decrypt_text(data: str) -> str:
    f = _get_fernet()
    if not f:
        return data
    try:
        return f.decrypt(data.encode("ascii")).decode("utf-8")
    except Exception:
        return data


# ── Password hashing (PBKDF2-SHA256, 600k iterations) ────────────────

def hash_password(password: str) -> tuple:
    salt = secrets.token_hex(32)
    key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 600_000)
    return key.hex(), salt


def verify_password(password: str, stored_hash: str, salt: str) -> bool:
    key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 600_000)
    return hmac.compare_digest(key.hex(), stored_hash)


# ── DB init ───────────────────────────────────────────────────────────

def _init_conversations_db():
    conn = sqlite3.connect(CONVERSATIONS_DB)
    conn.execute("""CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'default',
        title TEXT NOT NULL,
        agent_key TEXT,
        agent_name TEXT,
        messages TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )""")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(user_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversations(updated_at DESC)")
    conn.execute("""CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        role TEXT DEFAULT 'user',
        created_at TEXT NOT NULL
    )""")
    conn.commit()
    conn.close()


_init_conversations_db()
DAY_NAMES = ["pondelok", "utorok", "streda", "štvrtok", "piatok", "sobota", "nedeľa"]


def load_config() -> dict:
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_config(cfg: dict):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


class KnowledgeHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def _send_json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length))

    def _check_token(self) -> bool:
        if not API_TOKEN:
            return True
        token = self.headers.get("X-API-Token", "")
        return hmac.compare_digest(token, API_TOKEN)

    def do_GET(self):
        if self.path == "/health":
            self._send_json({"status": "ok"})
            return

        if self.path == "/auth/check":
            conn = sqlite3.connect(CONVERSATIONS_DB)
            count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
            conn.close()
            self._send_json({"has_users": count > 0})
            return

        if not self._check_token():
            self._send_json({"error": "Unauthorized"}, 401)
            return

        if self.path == "/agents":
            agents = {}
            for key, cfg in AGENTS.items():
                kb = KnowledgeBase(cfg["name"])
                stats = kb.get_stats()
                agents[key] = {
                    "name": cfg["name"],
                    "description": cfg["description"],
                    "sources": stats["sources"],
                    "chunks": stats["chunks"],
                    "total_chars": stats["total_chars"],
                }
            self._send_json(agents)

        elif self.path == "/health":
            self._send_json({"status": "ok"})

        else:
            self._send_json({"error": "not found"}, 404)

    def do_POST(self):
        # Auth endpoints — no token required
        if self.path == "/auth/register":
            body = self._read_body()
            name = body.get("name", "").strip()
            password = body.get("password", "")
            if not name or len(password) < 6:
                self._send_json({"error": "Meno a heslo (min. 6 znakov) sú povinné."}, 400)
                return
            conn = sqlite3.connect(CONVERSATIONS_DB)
            existing = conn.execute("SELECT id FROM users WHERE name = ?", (name,)).fetchone()
            if existing:
                conn.close()
                self._send_json({"error": "Používateľ s týmto menom už existuje."}, 409)
                return
            user_id = name.lower().replace(" ", "_")
            user_id = re.sub(r"[^a-z0-9_]", "", user_id)
            pw_hash, salt = hash_password(password)
            from datetime import datetime
            now = datetime.utcnow().isoformat()
            conn.execute(
                "INSERT INTO users (id, name, password_hash, salt, role, created_at) VALUES (?,?,?,?,?,?)",
                (user_id, name, pw_hash, salt, "admin", now),
            )
            conn.commit()
            conn.close()
            self._send_json({"user": {"id": user_id, "name": name, "role": "admin"}})
            return

        if self.path == "/auth/login":
            body = self._read_body()
            name = body.get("name", "").strip()
            password = body.get("password", "")
            conn = sqlite3.connect(CONVERSATIONS_DB)
            row = conn.execute(
                "SELECT id, name, password_hash, salt, role FROM users WHERE name = ?",
                (name,),
            ).fetchone()
            conn.close()
            if not row:
                self._send_json({"error": "Neplatné prihlasovacie údaje."}, 401)
                return
            if not verify_password(password, row[2], row[3]):
                self._send_json({"error": "Neplatné prihlasovacie údaje."}, 401)
                return
            self._send_json({"user": {"id": row[0], "name": row[1], "role": row[4]}})
            return

        if self.path == "/auth/users":
            if not self._check_token():
                self._send_json({"error": "Unauthorized"}, 401)
                return
            conn = sqlite3.connect(CONVERSATIONS_DB)
            rows = conn.execute("SELECT id, name, role, created_at FROM users").fetchall()
            conn.close()
            self._send_json({
                "users": [{"id": r[0], "name": r[1], "role": r[2], "created_at": r[3]} for r in rows]
            })
            return

        # All other POST endpoints require API token
        if not self._check_token():
            self._send_json({"error": "Unauthorized"}, 401)
            return

        if self.path == "/ask":
            body = self._read_body()
            agent_key = body.get("agent", "")
            question = body.get("question", "")

            if agent_key not in AGENTS:
                self._send_json({"error": f"Unknown agent: {agent_key}"}, 400)
                return
            if not question:
                self._send_json({"error": "No question"}, 400)
                return

            cfg = AGENTS[agent_key]
            kb = KnowledgeBase(cfg["name"])
            stats = kb.get_stats()

            if stats["chunks"] == 0:
                self._send_json({"error": f"Agent {cfg['name']} nemá znalosti. Spusti learn."}, 400)
                return

            answer = ask_specialist(kb, question, cfg.get("system_prompt", ""))
            self._send_json({
                "agent": agent_key,
                "agent_name": cfg["name"],
                "answer": answer,
                "sources": stats["sources"],
            })

        elif self.path == "/search":
            body = self._read_body()
            agent_key = body.get("agent", "")
            query = body.get("query", "")
            top_k = body.get("top_k", 5)

            if agent_key not in AGENTS:
                self._send_json({"error": f"Unknown agent: {agent_key}"}, 400)
                return

            cfg = AGENTS[agent_key]
            kb = KnowledgeBase(cfg["name"])
            results = kb.search(query, top_k=top_k)
            self._send_json({"results": results})

        elif self.path == "/context":
            body = self._read_body()
            agent_key = body.get("agent", "")
            question = body.get("question", "")
            top_k = body.get("top_k", 5)

            if agent_key not in AGENTS:
                self._send_json({"error": f"Unknown agent: {agent_key}"}, 400)
                return

            cfg = AGENTS[agent_key]
            kb = KnowledgeBase(cfg["name"])
            results = kb.search(question, top_k=top_k)

            context = f"ZNALOSTNÁ DATABÁZA: {cfg['name']}\n\n"
            for i, r in enumerate(results, 1):
                context += f"--- Zdroj {i} (relevancia: {r['score']:.2f}) ---\n"
                context += f"Titulok: {r['title']}\n"
                context += f"URL: {r['url']}\n"
                context += f"{r['content']}\n\n"

            self._send_json({
                "agent": agent_key,
                "agent_name": cfg["name"],
                "system_prompt": cfg.get("system_prompt", ""),
                "context": context,
                "sources": kb.get_stats()["sources"],
            })

        elif self.path == "/refresh":
            body = self._read_body()
            agent_key = body.get("agent", "")

            if agent_key not in AGENTS:
                self._send_json({"error": f"Unknown agent: {agent_key}"}, 400)
                return

            cfg = AGENTS[agent_key]
            kb = KnowledgeBase(cfg["name"])
            deleted = kb.refresh()
            stats = kb.scrape_and_add(
                cfg["queries"],
                priority_domains=cfg.get("priority_domains"),
                blocked_domains=cfg.get("blocked_domains"),
            )
            info = kb.get_stats()
            self._send_json({
                "agent": agent_key,
                "deleted": deleted,
                "new": stats,
                "total": info,
            })

        elif self.path == "/sources":
            body = self._read_body()
            action = body.get("action", "list")
            agent_key = body.get("agent", "")

            if agent_key not in AGENTS:
                self._send_json({"error": f"Unknown agent: {agent_key}"}, 400)
                return

            cfg = AGENTS[agent_key]
            kb = KnowledgeBase(cfg["name"])

            if action == "list":
                sources = kb.list_sources()
                self._send_json({"agent": agent_key, "sources": sources})

            elif action == "delete":
                source_id = body.get("source_id")
                if not source_id:
                    self._send_json({"error": "source_id required"}, 400)
                    return
                result = kb.delete_source(int(source_id))
                self._send_json({"agent": agent_key, **result, "stats": kb.get_stats()})

            elif action == "add_url":
                url = body.get("url", "").strip()
                if not url:
                    self._send_json({"error": "url required"}, 400)
                    return
                try:
                    import requests as req
                    from bs4 import BeautifulSoup
                    resp = req.get(url, timeout=15, headers={"User-Agent": "JALZA/1.0"})
                    soup = BeautifulSoup(resp.text, "html.parser")
                    title = soup.title.string.strip() if soup.title and soup.title.string else url
                    for tag in soup(["script", "style", "nav", "footer", "header"]):
                        tag.decompose()
                    text = soup.get_text(separator="\n", strip=True)
                    result = kb.add_document(url, title, text)
                    self._send_json({"agent": agent_key, **result, "title": title, "stats": kb.get_stats()})
                except Exception as e:
                    self._send_json({"error": str(e)}, 500)
            else:
                self._send_json({"error": f"Unknown action: {action}"}, 400)

        elif self.path == "/detect":
            body = self._read_body()
            text = body.get("text", "").lower()
            TRIGGERS = {
                "uctovnictvo": ["účtovníctvo", "uctovnictvo", "dane", "daň", "dan ",
                                "dph", "szčo", "szco", "odvody", "faktur",
                                "účtovn", "uctovn", "daňov", "danov"],
                "3d_tlac": ["3d tlač", "3d tlac", "multiboard", "filament",
                            "pla", "petg", "tlačiareň", "tlaciaren", "slicer", "stl"],
            }
            detected = ""
            for key, triggers in TRIGGERS.items():
                if any(t in text for t in triggers):
                    detected = key
                    break

            if detected and detected in AGENTS:
                kb = KnowledgeBase(AGENTS[detected]["name"])
                stats = kb.get_stats()
                self._send_json({
                    "agent": detected,
                    "name": AGENTS[detected]["name"],
                    "has_knowledge": stats["chunks"] > 0,
                })
            else:
                self._send_json({"agent": None})

        elif self.path == "/settings":
            cfg = load_config()
            ku = cfg.get("knowledge_update", {})
            day = DAY_NAMES[ku.get("day", 0)]
            hour = ku.get("hour", 3)
            enabled = ku.get("enabled", True)

            agents_info = []
            for k, v in AGENTS.items():
                try:
                    kb = KnowledgeBase(v["name"])
                    s = kb.get_stats()
                    agents_info.append(f"• {k} — {v['name']} ({s['sources']} zdrojov)")
                except Exception:
                    agents_info.append(f"• {k} — {v['name']}")

            el = cfg.get("elevenlabs", {})
            voice = "nakonfigurovaný" if el.get("api_key") and el.get("voice_id") else "nie je nastavený"
            email_cfg = cfg.get("email", {})
            email_status = "nakonfigurovaný" if email_cfg.get("imap", {}).get("server") else "nie je nastavený"

            self._send_json({
                "update_enabled": enabled,
                "update_day": day,
                "update_hour": hour,
                "agents": agents_info,
                "voice": voice,
                "email": email_status,
                "auto_voice": el.get("auto_voice", False),
            })

        elif self.path == "/settings/update":
            body = self._read_body()
            cfg = load_config()
            ku = cfg.get("knowledge_update", {})

            if "enabled" in body:
                ku["enabled"] = body["enabled"]
            if "day" in body:
                day_input = str(body["day"]).lower()
                day_map = {d.lower(): i for i, d in enumerate(DAY_NAMES)}
                day_map.update({"po": 0, "ut": 1, "st": 2, "stv": 3, "pi": 4, "so": 5, "ne": 6})
                if day_input in day_map:
                    ku["day"] = day_map[day_input]
                elif day_input.isdigit() and 0 <= int(day_input) <= 6:
                    ku["day"] = int(day_input)
            if "hour" in body:
                try:
                    h = int(body["hour"])
                    if 0 <= h <= 23:
                        ku["hour"] = h
                except (ValueError, TypeError):
                    pass

            cfg["knowledge_update"] = ku
            save_config(cfg)
            self._send_json({
                "enabled": ku.get("enabled", True),
                "day": DAY_NAMES[ku.get("day", 0)],
                "hour": ku.get("hour", 3),
            })

        elif self.path == "/learn":
            body = self._read_body()
            agent_key = body.get("agent", "")
            if agent_key not in AGENTS:
                self._send_json({"error": f"Neznámy agent: {agent_key}"}, 400)
                return
            cfg_agent = AGENTS[agent_key]
            kb = KnowledgeBase(cfg_agent["name"])
            stats = kb.scrape_and_add(
                cfg_agent["queries"],
                priority_domains=cfg_agent.get("priority_domains"),
                blocked_domains=cfg_agent.get("blocked_domains"),
            )
            info = kb.get_stats()
            self._send_json({"agent": agent_key, "new": stats, "total": info})

        elif self.path == "/addagent":
            body = self._read_body()
            key = re.sub(r"[^a-z0-9_]", "_", body.get("key", "").lower())
            name = body.get("name", "")
            description = body.get("description", "")
            queries = body.get("queries", [])
            priority_domains = body.get("priority_domains", [])

            if not key or not name or not queries:
                self._send_json({"error": "Zadaj key, name, queries"}, 400)
                return
            if key in AGENTS:
                self._send_json({"error": f"Agent {key} už existuje"}, 400)
                return

            new_agent = {
                "name": name,
                "description": description,
                "queries": queries,
                "priority_domains": priority_domains,
                "blocked_domains": ["facebook.com", "twitter.com", "instagram.com", "youtube.com", "reddit.com"],
                "system_prompt": f"Si expert na tému: {name}. Odpovedaj na základe znalostnej databázy. Odpovedaj stručne po slovensky.",
            }
            AGENTS[key] = new_agent
            cfg = load_config()
            cfg.setdefault("custom_agents", {})[key] = new_agent
            save_config(cfg)
            self._send_json({"status": "created", "agent": key, "name": name})

        elif self.path == "/integrations":
            cfg = load_config()
            email_cfg = cfg.get("email", {})
            imap = email_cfg.get("imap", {})
            el = cfg.get("elevenlabs", {})

            integrations = []

            # Email / Gmail
            email_status = "connected" if imap.get("server") and imap.get("password") else "disconnected"
            integrations.append({
                "id": "email",
                "name": "Email (Gmail)",
                "type": "email",
                "icon": "📧",
                "status": email_status,
                "provider": imap.get("server", ""),
                "account": imap.get("username", ""),
                "capabilities": ["čítanie emailov", "posielanie emailov", "mazanie spamu", "cleanup"],
                "config": {
                    "imap_server": imap.get("server", ""),
                    "imap_port": imap.get("port", 993),
                    "smtp_server": email_cfg.get("smtp", {}).get("server", ""),
                    "smtp_port": email_cfg.get("smtp", {}).get("port", 465),
                    "username": imap.get("username", ""),
                    "has_password": bool(imap.get("password")),
                },
            })

            # Web Search / Gemini
            integrations.append({
                "id": "web_search",
                "name": "Web Search (Gemini)",
                "type": "search",
                "icon": "🔍",
                "status": "connected",
                "provider": "Google Gemini",
                "account": "gemini-2.0-flash",
                "capabilities": ["vyhľadávanie na webe", "aktuálne informácie", "novinky"],
                "config": {},
            })

            # Ollama / LLM
            try:
                import requests as req
                r = req.get("http://localhost:11434/api/tags", timeout=3)
                models = [m["name"] for m in r.json().get("models", [])] if r.ok else []
                ollama_status = "connected" if models else "disconnected"
            except Exception:
                models = []
                ollama_status = "disconnected"
            integrations.append({
                "id": "ollama",
                "name": "Ollama (Lokálne LLM)",
                "type": "llm",
                "icon": "🧠",
                "status": ollama_status,
                "provider": "Ollama",
                "account": f"{len(models)} modelov",
                "capabilities": ["chat", "reasoning", "embeddings", "vision"],
                "config": {"models": models},
            })

            # ElevenLabs / Voice
            voice_status = "connected" if el.get("api_key") and el.get("voice_id") else "disconnected"
            integrations.append({
                "id": "elevenlabs",
                "name": "ElevenLabs (Hlas)",
                "type": "voice",
                "icon": "🎙️",
                "status": voice_status,
                "provider": "ElevenLabs",
                "account": el.get("voice_id", "nenastavený"),
                "capabilities": ["text-to-speech", "klonovanie hlasu"],
                "config": {
                    "has_api_key": bool(el.get("api_key")),
                    "voice_id": el.get("voice_id", ""),
                    "auto_voice": el.get("auto_voice", False),
                },
            })

            # Knowledge Agents
            for key, agent_cfg in AGENTS.items():
                try:
                    kb = KnowledgeBase(agent_cfg["name"])
                    stats = kb.get_stats()
                    kb_status = "connected" if stats["chunks"] > 0 else "empty"
                except Exception:
                    stats = {"sources": 0, "chunks": 0, "total_chars": 0}
                    kb_status = "empty"
                integrations.append({
                    "id": f"kb_{key}",
                    "name": f"Znalostná DB: {agent_cfg['name']}",
                    "type": "knowledge",
                    "icon": "📚",
                    "status": kb_status,
                    "provider": "Lokálna RAG",
                    "account": f"{stats['sources']} zdrojov, {stats['chunks']} častí",
                    "capabilities": ["RAG vyhľadávanie", "špecializované odpovede"],
                    "config": {
                        "agent_key": key,
                        "sources": stats["sources"],
                        "chunks": stats["chunks"],
                    },
                })

            # Telegram Bot
            integrations.append({
                "id": "telegram",
                "name": "Telegram Bot",
                "type": "messaging",
                "icon": "💬",
                "status": "connected",
                "provider": "Telegram",
                "account": "J.A.L.Z.A. Bot",
                "capabilities": ["chat", "hlasové správy", "príkazy", "email cez chat"],
                "config": {},
            })

            self._send_json({"integrations": integrations})

        elif self.path == "/integrations/update":
            body = self._read_body()
            integration_id = body.get("id", "")
            cfg = load_config()

            if integration_id == "email":
                email_cfg = cfg.get("email", {})
                imap = email_cfg.get("imap", {})
                smtp = email_cfg.get("smtp", {})
                if "username" in body:
                    imap["username"] = body["username"]
                    smtp["username"] = body["username"]
                if "password" in body:
                    imap["password"] = body["password"]
                    smtp["password"] = body["password"]
                if "imap_server" in body:
                    imap["server"] = body["imap_server"]
                if "smtp_server" in body:
                    smtp["server"] = body["smtp_server"]
                email_cfg["imap"] = imap
                email_cfg["smtp"] = smtp
                cfg["email"] = email_cfg
                save_config(cfg)
                self._send_json({"status": "updated", "id": "email"})

            elif integration_id == "elevenlabs":
                el = cfg.get("elevenlabs", {})
                if "api_key" in body:
                    el["api_key"] = body["api_key"]
                if "voice_id" in body:
                    el["voice_id"] = body["voice_id"]
                if "auto_voice" in body:
                    el["auto_voice"] = body["auto_voice"]
                cfg["elevenlabs"] = el
                save_config(cfg)
                self._send_json({"status": "updated", "id": "elevenlabs"})

            else:
                self._send_json({"error": "Neznáma integrácia"}, 400)

        elif self.path == "/tasks":
            body = self._read_body()
            action = body.get("action", "list")
            cfg = load_config()
            tasks = cfg.get("scheduled_tasks_v2", [])

            if action == "list":
                self._send_json({"tasks": tasks})

            elif action == "create":
                import uuid
                new_task = {
                    "id": str(uuid.uuid4())[:8],
                    "name": body.get("name", ""),
                    "prompt": body.get("prompt", ""),
                    "schedule": body.get("schedule", "daily_morning"),
                    "agent": body.get("agent", ""),
                    "enabled": True,
                    "notify": body.get("notify", True),
                    "last_run": None,
                }
                tasks.append(new_task)
                cfg["scheduled_tasks_v2"] = tasks
                save_config(cfg)
                self._send_json({"status": "created", "task": new_task})

            elif action == "toggle":
                task_id = body.get("id", "")
                enabled = body.get("enabled", True)
                for t in tasks:
                    if t["id"] == task_id:
                        t["enabled"] = enabled
                        break
                cfg["scheduled_tasks_v2"] = tasks
                save_config(cfg)
                self._send_json({"status": "updated"})

            elif action == "delete":
                task_id = body.get("id", "")
                tasks = [t for t in tasks if t["id"] != task_id]
                cfg["scheduled_tasks_v2"] = tasks
                save_config(cfg)
                self._send_json({"status": "deleted"})

            elif action == "run":
                task_id = body.get("id", "")
                task = next((t for t in tasks if t["id"] == task_id), None)
                if not task:
                    self._send_json({"error": "Task not found"}, 404)
                    return
                import requests as req
                from datetime import datetime as dt
                try:
                    messages = [{"role": "user", "content": task["prompt"]}]
                    if task.get("agent") and task["agent"] in AGENTS:
                        agent_cfg = AGENTS[task["agent"]]
                        kb = KnowledgeBase(agent_cfg["name"])
                        results = kb.search(task["prompt"], top_k=3)
                        context = "\n".join(
                            f"Zdroj: {r['title']}\n{r['content']}" for r in results
                        )
                        messages = [
                            {"role": "system", "content": agent_cfg.get("system_prompt", "")},
                            {"role": "user", "content": f"{context}\n\nÚLOHA: {task['prompt']}"},
                        ]

                    r = req.post(
                        "http://localhost:11434/api/chat",
                        json={"model": "jalza", "messages": messages, "stream": False},
                        timeout=300,
                    )
                    result = r.json().get("message", {}).get("content", "Chyba")

                    task["last_run"] = dt.now().strftime("%Y-%m-%d %H:%M")
                    cfg["scheduled_tasks_v2"] = tasks
                    save_config(cfg)

                    self._send_json({"status": "completed", "result": result[:500]})
                except Exception as e:
                    self._send_json({"error": str(e)}, 500)

            else:
                self._send_json({"error": "Unknown action"}, 400)

        elif self.path == "/integrations/tts":
            body = self._read_body()
            text = body.get("text", "")
            if not text:
                self._send_json({"error": "No text"}, 400)
                return
            try:
                from voice_agent import text_to_speech
                audio_path = text_to_speech(text)
                if audio_path and os.path.exists(audio_path):
                    self.send_response(200)
                    self.send_header("Content-Type", "audio/mpeg")
                    self.end_headers()
                    with open(audio_path, "rb") as f:
                        self.wfile.write(f.read())
                else:
                    self._send_json({"error": "TTS failed"}, 500)
            except Exception as e:
                self._send_json({"error": str(e)}, 500)

        elif self.path == "/conversations":
            body = self._read_body()
            action = body.get("action", "list")
            user_id = body.get("user_id", "default")
            conn = sqlite3.connect(CONVERSATIONS_DB)
            conn.row_factory = sqlite3.Row

            if action == "list":
                limit = body.get("limit", 50)
                rows = conn.execute(
                    "SELECT id, user_id, title, agent_key, agent_name, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?",
                    (user_id, limit),
                ).fetchall()
                convos = [dict(r) for r in rows]
                conn.close()
                self._send_json({"conversations": convos})

            elif action == "get":
                conv_id = body.get("id", "")
                row = conn.execute(
                    "SELECT * FROM conversations WHERE id = ? AND user_id = ?",
                    (conv_id, user_id),
                ).fetchone()
                conn.close()
                if row:
                    d = dict(row)
                    d["messages"] = json.loads(decrypt_text(d["messages"]))
                    self._send_json(d)
                else:
                    self._send_json({"error": "not found"}, 404)

            elif action == "save":
                conv_id = body.get("id", "")
                title = body.get("title", "Nová konverzácia")
                agent_key = body.get("agent_key")
                agent_name = body.get("agent_name")
                messages = body.get("messages", [])
                now = body.get("updated_at", "")
                if not now:
                    from datetime import datetime
                    now = datetime.utcnow().isoformat()

                encrypted_messages = encrypt_text(json.dumps(messages, ensure_ascii=False))

                existing = conn.execute(
                    "SELECT id FROM conversations WHERE id = ?", (conv_id,)
                ).fetchone()

                if existing:
                    conn.execute(
                        "UPDATE conversations SET title=?, messages=?, updated_at=?, agent_key=?, agent_name=? WHERE id=?",
                        (title, encrypted_messages, now, agent_key, agent_name, conv_id),
                    )
                else:
                    conn.execute(
                        "INSERT INTO conversations (id, user_id, title, agent_key, agent_name, messages, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
                        (conv_id, user_id, title, agent_key, agent_name, encrypted_messages, now, now),
                    )
                conn.commit()
                conn.close()
                self._send_json({"status": "saved", "id": conv_id})

            elif action == "delete":
                conv_id = body.get("id", "")
                conn.execute(
                    "DELETE FROM conversations WHERE id = ? AND user_id = ?",
                    (conv_id, user_id),
                )
                conn.commit()
                conn.close()
                self._send_json({"status": "deleted", "id": conv_id})

            else:
                conn.close()
                self._send_json({"error": f"Unknown action: {action}"}, 400)

        elif self.path == "/email/check":
            body = self._read_body()
            today_only = body.get("today_only", False)
            limit = body.get("limit", 10)
            try:
                from email_agent import list_emails
                results = list_emails(limit=limit, unseen_only=not today_only, today_only=today_only)
                if isinstance(results, dict) and "error" in results:
                    self._send_json(results, 500)
                else:
                    self._send_json({"emails": results, "count": len(results)})
            except Exception as e:
                self._send_json({"error": str(e)}, 500)

        elif self.path == "/email/send":
            body = self._read_body()
            to_addr = body.get("to", "")
            subject = body.get("subject", "")
            text = body.get("body", "")
            if not to_addr or not subject or not text:
                self._send_json({"error": "Zadaj to, subject, body"}, 400)
                return
            try:
                from email_agent import send_reply, load_email_config
                cfg = load_email_config()
                smtp_cfg = cfg.get("smtp", {})
                send_reply(smtp_cfg, to_addr, subject, text)
                self._send_json({"status": "sent", "to": to_addr, "subject": subject})
            except Exception as e:
                self._send_json({"error": str(e)}, 500)

        elif self.path == "/email/cleanup":
            body = self._read_body()
            dry_run = body.get("dry_run", True)
            try:
                from email_agent import cleanup_emails
                stats = cleanup_emails(
                    delete_marketing=True,
                    delete_older_than_days=365,
                    dry_run=dry_run,
                )
                self._send_json(stats)
            except Exception as e:
                self._send_json({"error": str(e)}, 500)

        else:
            self._send_json({"error": "not found"}, 404)


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


if __name__ == "__main__":
    server = ThreadedHTTPServer(("0.0.0.0", PORT), KnowledgeHandler)
    print(f"Knowledge API beží na porte {PORT} (threaded)")
    print(f"Endpointy: GET /agents, POST /ask, POST /context, POST /search, POST /detect")
    server.serve_forever()
