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
import logging
import datetime as _dt
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn

logger = logging.getLogger("jalza-api")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
from knowledge_base import KnowledgeBase, list_knowledge_bases
from specialist_agent import ask_specialist, ask_multi_kb, search_multi_kb, build_multi_kb_context, AGENTS

PORT = 8765
BASE_DIR = os.environ.get("JALZA_BASE_DIR", os.path.dirname(os.path.abspath(__file__)))
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
    conn.execute("""CREATE TABLE IF NOT EXISTS usage_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        model TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'ollama',
        route TEXT NOT NULL DEFAULT 'chat',
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        cost_usd REAL DEFAULT 0.0,
        user_id TEXT DEFAULT 'default'
    )""")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage_log(timestamp)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_usage_model ON usage_log(model)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_log(user_id)")
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


# ── Business Agent ─────────────────────────────────────────────────────
def _biz_api_call(action: str, data: dict = None) -> dict:
    """Call business-flow-ai /api/jalza endpoint."""
    import urllib.request, urllib.parse
    biz_url = os.environ.get("BUSINESS_FLOW_URL", "https://business-flow-ai.up.railway.app").rstrip("/")
    biz_token = API_TOKEN

    WRITE_ACTIONS = {"create_customer", "create_project", "create_calculation", "share_calculation", "find_products", "search"}

    if action in WRITE_ACTIONS:
        payload = {"action": action, **(data or {})}
        req_data = json.dumps(payload).encode()
        req = urllib.request.Request(f"{biz_url}/api/jalza", data=req_data, method="POST")
        req.add_header("Content-Type", "application/json")
    else:
        params = {"action": action, **(data or {})}
        qs = urllib.parse.urlencode(params)
        req = urllib.request.Request(f"{biz_url}/api/jalza?{qs}", method="GET")

    req.add_header("X-API-Token", biz_token)
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode())


def _gemini_call(system: str, user_msg: str) -> str:
    """Quick Gemini call for agent reasoning."""
    gemini_key = os.environ.get("GEMINI_API_KEY", "")
    if not gemini_key:
        raise ValueError("GEMINI_API_KEY not set")

    import urllib.request
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={gemini_key}"
    payload = {
        "contents": [
            {"role": "user", "parts": [{"text": f"{system}\n\n{user_msg}"}]},
        ],
        "generationConfig": {"temperature": 0.1, "maxOutputTokens": 2000},
    }
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.loads(resp.read().decode())
    return (result.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")).strip()


def _run_business_agent(prompt: str) -> dict:
    """
    AI agent: analyze prompt -> find products -> create customer + project -> return link to configure.
    The user configures and creates the calculation manually in business-flow-ai UI.
    """
    steps_log = []

    def log_step(tool: str, status: str, data: dict = None):
        steps_log.append({"tool": tool, "status": status, "data": data or {}})
        logger.info(f"[BIZ-AGENT] {tool}: {status}")

    parse_system = """Si business AI asistent. Analyzuj požiadavku a extrahuj štruktúrované údaje vo formáte JSON.

Vráť VÝHRADNE platný JSON (bez markdown, bez vysvetlení) s týmito poľami:
{
  "client_name": "meno klienta alebo firmy (ak je uvedené, inak null)",
  "client_email": "email ak je uvedený, inak null",
  "client_phone": "telefón ak je uvedený, inak null",
  "product_search": "čo klient chce / aký produkt hľadá (kľúčové slová)",
  "project_name": "navrhni krátky názov projektu",
  "quantity": 1,
  "description": "stručný popis požiadavky"
}

Ak niečo nie je jasné, odhadni rozumné hodnoty. Vždy vráť platný JSON."""

    try:
        parsed_text = _gemini_call(parse_system, prompt)
        parsed_text = parsed_text.strip()
        if parsed_text.startswith("```"):
            parsed_text = parsed_text.split("\n", 1)[1] if "\n" in parsed_text else parsed_text[3:]
            if parsed_text.endswith("```"):
                parsed_text = parsed_text[:-3]
        parsed = json.loads(parsed_text)
        log_step("parse_prompt", "ok", parsed)
    except Exception as e:
        log_step("parse_prompt", "error", {"error": str(e)})
        return {"success": False, "error": f"Nepodarilo sa analyzovať požiadavku: {e}", "steps": steps_log}

    result_data = {}

    # Step 1: Find products (templates + EAV products + categories)
    product_search = parsed.get("product_search", "")
    found = {"templates": [], "products": [], "categories": []}
    if product_search:
        try:
            found = _biz_api_call("find_products", {"query": product_search})
            total = len(found.get("templates", [])) + len(found.get("products", [])) + len(found.get("categories", []))
            log_step("find_products", "ok", {"query": product_search, "found": total})
            result_data["found_products"] = found
        except Exception as e:
            log_step("find_products", "error", {"error": str(e)})

    # Step 2: Find or create customer
    client_name = parsed.get("client_name")
    customer_data = None
    if client_name:
        try:
            cust_result = _biz_api_call("create_customer", {
                "name": client_name,
                "email": parsed.get("client_email") or None,
                "phone": parsed.get("client_phone") or None,
            })
            customer_data = cust_result.get("customer", {})
            is_existing = cust_result.get("existing", False)
            log_step("find_or_create_customer", "ok", {"existing": is_existing, "customer": customer_data})
            result_data["customer"] = customer_data
            result_data["customer_existing"] = is_existing
        except Exception as e:
            log_step("find_or_create_customer", "error", {"error": str(e)})

    # Step 3: Create project
    project_name = parsed.get("project_name", f"Projekt - {product_search or prompt[:30]}")
    try:
        project_result = _biz_api_call("create_project", {
            "name": project_name,
            "companyName": client_name or "",
            "clientId": customer_data.get("id") if customer_data else None,
            "clientEntityId": customer_data.get("id") if customer_data else None,
        })
        log_step("create_project", "ok", project_result)
        result_data["project"] = project_result
    except Exception as e:
        log_step("create_project", "error", {"error": str(e)})
        return {"success": False, "error": f"Nepodarilo sa vytvoriť projekt: {e}", "steps": steps_log}

    # Step 4: Get app URL for link
    app_url = ""
    try:
        url_result = _biz_api_call("get_app_url")
        app_url = url_result.get("url", "")
    except:
        app_url = os.environ.get("BUSINESS_FLOW_URL", "https://business-flow-ai.up.railway.app")

    project_id = project_result.get("id", "")
    calc_link = f"{app_url}/calculations/new?projectId={project_id}"
    result_data["calculation_link"] = calc_link

    # Build summary
    summary_parts = []
    summary_parts.append(f"**Projekt vytvorený:** {project_result.get('projectNumber', '')} — {project_name}")

    if customer_data:
        status = "existujúci" if result_data.get("customer_existing") else "nový"
        summary_parts.append(f"**Klient:** {customer_data.get('name', '')} ({status})")

    # Show found products
    templates = found.get("templates", [])
    products = found.get("products", [])
    categories = found.get("categories", [])

    if templates or products or categories:
        summary_parts.append(f"\n**Nájdené produkty pre \"{product_search}\":**")

        if categories:
            summary_parts.append("📂 **Kategórie (workflow):**")
            for c in categories[:5]:
                desc = f" — {c['description'][:80]}" if c.get("description") else ""
                summary_parts.append(f"  • {c['name']}{desc}")

        if products:
            summary_parts.append("🔧 **Produkty (vlastná výroba):**")
            for p in products[:5]:
                variants = p.get("variants", [])
                var_str = f" ({len(variants)} variantov)" if variants else ""
                summary_parts.append(f"  • {p['name']}{var_str}")
                for v in variants[:3]:
                    summary_parts.append(f"    ▸ {v.get('name', '?')}")

        if templates:
            summary_parts.append("🏭 **Šablóny (nakupované):**")
            for t in templates[:5]:
                params = t.get("parameters", [])
                param_str = f" [{', '.join(p['name'] for p in params[:3])}]" if params else ""
                price = f" — {t['basePrice']}€" if t.get("basePrice") else ""
                summary_parts.append(f"  • {t['name']}{price}{param_str}")
    else:
        summary_parts.append(f"\n⚠️ Pre \"{product_search}\" sa nenašli žiadne produkty v katalógu.")

    summary_parts.append(f"\n**👉 [Vytvoriť kalkuláciu]({calc_link})**")
    summary_parts.append("_Klikni na link, vyber produkt z kategórií, nakonfiguruj a ulož._")

    return {
        "success": True,
        "summary": "\n".join(summary_parts),
        "data": result_data,
        "steps": steps_log,
        "total_steps": len(steps_log),
    }


class KnowledgeHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-API-Token")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def _send_json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self._cors_headers()
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length))

    def _read_raw_body(self) -> bytes:
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return b""
        return self.rfile.read(length)

    def _check_token(self) -> bool:
        if not API_TOKEN:
            return True
        token = self.headers.get("X-API-Token", "")
        return hmac.compare_digest(token, API_TOKEN)

    def _proxy_ollama(self, method="POST"):
        """Secure proxy to local Ollama — requires API token, streams response."""
        if not self._check_token():
            self._send_json({"error": "Unauthorized"}, 401)
            return
        ollama_path = self.path[len("/ollama"):]
        ollama_url = f"http://localhost:11434{ollama_path}"
        try:
            import requests as req
            raw_body = self._read_raw_body() if method == "POST" else None
            if method == "POST":
                resp = req.post(
                    ollama_url,
                    data=raw_body,
                    headers={"Content-Type": "application/json"},
                    stream=True,
                    timeout=600,
                )
            else:
                resp = req.get(ollama_url, stream=True, timeout=30)
            self.send_response(resp.status_code)
            ct = resp.headers.get("Content-Type", "application/json")
            self.send_header("Content-Type", ct)
            self.end_headers()
            for chunk in resp.iter_content(chunk_size=4096):
                if chunk:
                    self.wfile.write(chunk)
                    self.wfile.flush()
        except Exception as e:
            self._send_json({"error": f"Ollama nedostupná: {e}"}, 502)

    def _proxy_gemini(self, method="POST"):
        """Secure proxy to Google Gemini API — keeps API key local on Mac Studio."""
        if not self._check_token():
            self._send_json({"error": "Unauthorized"}, 401)
            return
        gemini_key = os.environ.get("GEMINI_API_KEY", "")
        if not gemini_key:
            self._send_json({"error": "GEMINI_API_KEY not configured"}, 500)
            return
        gemini_path = self.path[len("/gemini"):]
        if gemini_path.startswith("/v1"):
            gemini_path = gemini_path[len("/v1"):]
        gemini_url = f"https://generativelanguage.googleapis.com/v1beta/openai{gemini_path}"
        try:
            import requests as req
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {gemini_key}",
            }
            if method == "GET":
                resp = req.get(gemini_url, headers=headers, stream=True, timeout=120)
            else:
                raw_body = self._read_raw_body()
                resp = req.post(gemini_url, data=raw_body, headers=headers, stream=True, timeout=120)
            self.send_response(resp.status_code)
            ct = resp.headers.get("Content-Type", "application/json")
            self.send_header("Content-Type", ct)
            self.end_headers()
            for chunk in resp.iter_content(chunk_size=4096):
                if chunk:
                    self.wfile.write(chunk)
                    self.wfile.flush()
        except Exception as e:
            logger.error(f"Gemini proxy error: {e}")
            self._send_json({"error": f"Gemini nedostupné: {e}"}, 502)

    # ── AI Router ──────────────────────────────────────────────────────

    def _handle_ai_router(self, method="POST"):
        """Central AI Router — routes to the best model based on task_type."""
        if not self._check_token():
            self._send_json({"error": "Unauthorized"}, 401)
            return

        sub = self.path[len("/ai-router"):]

        if sub in ("", "/", "/config"):
            cfg = load_config().get("ai_router", {})
            self._send_json(cfg)
            return

        if sub == "/models":
            try:
                import requests as req
                resp = req.get("http://localhost:11434/api/tags", timeout=5)
                ollama_models = [m["name"] for m in resp.json().get("models", [])]
            except Exception:
                ollama_models = []
            self._send_json({
                "ollama": ollama_models,
                "gemini": ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro", "gemini-2.5-flash"],
            })
            return

        if not sub.endswith("/chat/completions"):
            self._send_json({"error": "Supported: /ai-router/v1/chat/completions"}, 404)
            return

        if method == "GET":
            self._send_json({"status": "ok", "endpoint": "/ai-router/v1/chat/completions"})
            return

        raw_body = self._read_raw_body()
        try:
            body = json.loads(raw_body)
        except Exception:
            self._send_json({"error": "Invalid JSON"}, 400)
            return

        task_type = body.pop("task_type", None)
        cfg = load_config().get("ai_router", {})
        task_models = cfg.get("task_models", {})

        if task_type and task_type in task_models:
            tc = task_models[task_type]
            model = tc["model"]
            provider = tc["provider"]
        else:
            model = body.get("model") or cfg.get("default_model", "gemini-2.5-flash")
            provider = cfg.get("default_provider", "gemini")
            if model.startswith("jalza") or model.startswith("qwen") or model.startswith("llama") or model.startswith("gpt-oss"):
                provider = "ollama"
            elif model.startswith("gemini"):
                provider = "gemini"

        body["model"] = model
        logger.info(f"🧠 AI Router: task={task_type or 'unknown'} → {provider}/{model}")

        if provider == "ollama":
            self._route_to_ollama(body)
        elif provider == "gemini":
            self._route_to_gemini(body)
        else:
            self._send_json({"error": f"Unknown provider: {provider}"}, 400)

    def _route_to_ollama(self, body: dict):
        try:
            import requests as req
            resp = req.post(
                "http://localhost:11434/v1/chat/completions",
                json=body,
                stream=True,
                timeout=600,
            )
            self.send_response(resp.status_code)
            ct = resp.headers.get("Content-Type", "application/json")
            self.send_header("Content-Type", ct)
            self.send_header("X-AI-Provider", "ollama")
            self.send_header("X-AI-Model", body.get("model", "unknown"))
            self.end_headers()
            for chunk in resp.iter_content(chunk_size=4096):
                if chunk:
                    self.wfile.write(chunk)
                    self.wfile.flush()
        except Exception as e:
            logger.error(f"AI Router → Ollama error: {e}")
            logger.info("AI Router: Ollama failed, trying Gemini fallback...")
            body["model"] = load_config().get("ai_router", {}).get("default_model", "gemini-2.5-flash")
            self._route_to_gemini(body)

    def _route_to_gemini(self, body: dict):
        gemini_key = os.environ.get("GEMINI_API_KEY", "")
        if not gemini_key:
            logger.warning("GEMINI_API_KEY not configured, falling back to Ollama")
            body["model"] = "jalza:latest"
            self._route_to_ollama(body)
            return
        try:
            import requests as req
            resp = req.post(
                "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
                json=body,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {gemini_key}",
                },
                stream=True,
                timeout=120,
            )
            if resp.status_code in (401, 403):
                resp.close()
                logger.warning(f"Gemini auth failed ({resp.status_code}), falling back to Ollama")
                body["model"] = "jalza:latest"
                self._route_to_ollama(body)
                return
            self.send_response(resp.status_code)
            ct = resp.headers.get("Content-Type", "application/json")
            self.send_header("Content-Type", ct)
            self.send_header("X-AI-Provider", "gemini")
            self.send_header("X-AI-Model", body.get("model", "unknown"))
            self.end_headers()
            for chunk in resp.iter_content(chunk_size=4096):
                if chunk:
                    self.wfile.write(chunk)
                    self.wfile.flush()
        except Exception as e:
            logger.error(f"AI Router → Gemini error: {e}, falling back to Ollama")
            body["model"] = "jalza:latest"
            try:
                self._route_to_ollama(body)
            except Exception as e2:
                logger.error(f"AI Router → Ollama fallback also failed: {e2}")
                self._send_json({"error": f"Gemini aj Ollama nedostupné: {e}, {e2}"}, 502)

    def do_GET(self):
        if self.path == "/health":
            self._send_json({"status": "ok"})
            return

        if self.path.startswith("/public/"):
            import mimetypes
            safe = self.path.replace("..", "").lstrip("/")
            fpath = os.path.join(BASE_DIR, safe)
            if os.path.isfile(fpath):
                mime, _ = mimetypes.guess_type(fpath)
                self.send_response(200)
                self.send_header("Content-Type", mime or "text/html; charset=utf-8")
                self._cors_headers()
                self.end_headers()
                with open(fpath, "rb") as f:
                    self.wfile.write(f.read())
            else:
                self._send_json({"error": "Not found"}, 404)
            return

        if self.path == "/auth/check":
            conn = sqlite3.connect(CONVERSATIONS_DB)
            count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
            conn.close()
            self._send_json({"has_users": count > 0})
            return

        if self.path.startswith("/ollama/"):
            self._proxy_ollama(method="GET")
            return

        if self.path.startswith("/gemini/"):
            self._proxy_gemini(method="GET")
            return

        if self.path.startswith("/ai-router"):
            self._handle_ai_router(method="GET")
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

        else:
            self._send_json({"error": "not found"}, 404)

    def do_POST(self):
        # Ollama proxy — requires token, streams response
        if self.path.startswith("/ollama/"):
            self._proxy_ollama(method="POST")
            return

        # Gemini proxy — keeps API key local, streams response
        if self.path.startswith("/gemini/"):
            self._proxy_gemini(method="POST")
            return

        # AI Router — central task-based model routing
        if self.path.startswith("/ai-router"):
            self._handle_ai_router(method="POST")
            return

        # AI Web Search — Gemini with google_search grounding
        if self.path == "/ai/web-search":
            if not self._check_token():
                self._send_json({"error": "Unauthorized"}, 401)
                return
            body = self._read_body()
            messages = body.get("messages", [])
            temperature = body.get("temperature", 0.7)
            max_tokens = body.get("max_tokens", 2048)
            stream = body.get("stream", False)

            gemini_key = os.environ.get("GEMINI_API_KEY", "")
            if not gemini_key:
                self._send_json({"error": "GEMINI_API_KEY not configured"}, 500)
                return

            contents = []
            for m in messages:
                role = m.get("role", "user")
                if role == "system":
                    contents.append({"role": "user", "parts": [{"text": m["content"]}]})
                    contents.append({"role": "model", "parts": [{"text": "Rozumiem."}]})
                elif role == "assistant":
                    contents.append({"role": "model", "parts": [{"text": m["content"]}]})
                else:
                    contents.append({"role": "user", "parts": [{"text": m["content"]}]})

            try:
                import requests as req
                endpoint = "streamGenerateContent?alt=sse" if stream else "generateContent"
                resp = req.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:{endpoint}&key={gemini_key}",
                    json={
                        "contents": contents,
                        "tools": [{"google_search": {}}],
                        "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens},
                    },
                    stream=stream,
                    timeout=30,
                )
                if stream:
                    self.send_response(resp.status_code)
                    self.send_header("Content-Type", "text/event-stream")
                    self.send_header("Cache-Control", "no-cache")
                    self.end_headers()
                    for chunk in resp.iter_content(chunk_size=4096):
                        if chunk:
                            self.wfile.write(chunk)
                            self.wfile.flush()
                else:
                    data = resp.json()
                    text_parts = []
                    for cand in data.get("candidates", []):
                        for part in cand.get("content", {}).get("parts", []):
                            if "text" in part:
                                text_parts.append(part["text"])
                    self._send_json({"text": "".join(text_parts)})
            except Exception as e:
                logger.error(f"AI Web Search error: {e}")
                self._send_json({"error": str(e)}, 502)
            return

        # AI Image Generation — Gemini native image model
        if self.path == "/ai/generate-image":
            if not self._check_token():
                self._send_json({"error": "Unauthorized"}, 401)
                return
            body = self._read_body()
            prompt = body.get("prompt", "")
            input_image = body.get("image")

            gemini_key = os.environ.get("GEMINI_API_KEY", "")
            if not gemini_key:
                self._send_json({"error": "GEMINI_API_KEY not configured"}, 500)
                return
            if not prompt:
                self._send_json({"error": "Missing prompt"}, 400)
                return

            parts = []
            if input_image:
                import base64 as b64mod
                raw = input_image
                mime = "image/png"
                if raw.startswith("data:"):
                    header, raw = raw.split(",", 1)
                    mime = header.split(":")[1].split(";")[0]
                parts.append({"inlineData": {"mimeType": mime, "data": raw}})
                parts.append({"text": f"Edit this image: {prompt}"})
            else:
                parts.append({"text": f"Generate an image: {prompt}. Be creative and produce high quality results."})

            try:
                import requests as req
                resp = req.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key={gemini_key}",
                    json={
                        "contents": [{"parts": parts}],
                        "generationConfig": {"responseModalities": ["TEXT", "IMAGE"], "temperature": 1},
                    },
                    timeout=90,
                )
                if not resp.ok:
                    self._send_json({"error": f"Gemini {resp.status_code}: {resp.text[:500]}"}, 502)
                    return

                data = resp.json()
                response_parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
                text = ""
                image_b64 = ""
                mime_type = "image/png"
                for p in response_parts:
                    if "text" in p:
                        text += p["text"]
                    if "inlineData" in p:
                        image_b64 = p["inlineData"]["data"]
                        mime_type = p["inlineData"].get("mimeType", "image/png")

                if not image_b64:
                    self._send_json({"error": "Gemini nevrátil obrázok.", "text": text or None}, 422)
                    return

                self._send_json({"image": f"data:{mime_type};base64,{image_b64}", "text": text})
            except Exception as e:
                logger.error(f"AI Image Generation error: {e}")
                self._send_json({"error": str(e)}, 500)
            return

        # AI Vision — route vision requests through Ollama
        if self.path == "/ai/vision":
            if not self._check_token():
                self._send_json({"error": "Unauthorized"}, 401)
                return
            body = self._read_body()
            prompt = body.get("prompt", "Čo vidíš na tomto obrázku? Odpovedaj po slovensky. Ak vidíš text, prepíš ho.")
            images = body.get("images", [])
            stream = body.get("stream", True)

            try:
                import requests as req
                resp = req.post(
                    "http://localhost:11434/api/chat",
                    json={
                        "model": "llama3.2-vision:11b",
                        "messages": [{"role": "user", "content": prompt, "images": images}],
                        "stream": stream,
                    },
                    stream=stream,
                    timeout=120,
                )
                self.send_response(resp.status_code)
                ct = resp.headers.get("Content-Type", "application/json")
                self.send_header("Content-Type", ct)
                self.end_headers()
                for chunk in resp.iter_content(chunk_size=4096):
                    if chunk:
                        self.wfile.write(chunk)
                        self.wfile.flush()
            except Exception as e:
                logger.error(f"AI Vision error: {e}")
                self._send_json({"error": str(e)}, 502)
            return

        # Whisper STT endpoint
        if self.path == "/transcribe":
            if not self._check_token():
                self._send_json({"error": "Unauthorized"}, 401)
                return
            import cgi
            import tempfile
            ctype, pdict = cgi.parse_header(self.headers.get("Content-Type", ""))
            if ctype != "multipart/form-data":
                self._send_json({"error": "Expected multipart/form-data"}, 400)
                return
            pdict["boundary"] = pdict["boundary"].encode()
            length = int(self.headers.get("Content-Length", 0))
            form = cgi.parse_multipart(self.rfile, pdict)
            audio_data = form.get("file", [None])[0]
            if not audio_data:
                self._send_json({"error": "No audio file"}, 400)
                return
            try:
                import whisper
                _whisper_model = getattr(self.__class__, "_whisper_model", None)
                if _whisper_model is None:
                    _whisper_model = whisper.load_model("base")
                    self.__class__._whisper_model = _whisper_model
                with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
                    tmp.write(audio_data)
                    tmp_path = tmp.name
                result = _whisper_model.transcribe(tmp_path, language="sk")
                os.unlink(tmp_path)
                text = result.get("text", "").strip()
                self._send_json({"text": text})
            except Exception as e:
                self._send_json({"error": f"Whisper error: {e}"}, 500)
            return

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

            linked = cfg.get("linked_kbs", [])
            budget = cfg.get("context_budget", 6)
            if linked:
                answer = ask_multi_kb(kb, linked, question, cfg.get("system_prompt", ""), context_budget=budget)
            else:
                answer = ask_specialist(kb, question, cfg.get("system_prompt", ""))

            self._send_json({
                "agent": agent_key,
                "agent_name": cfg["name"],
                "linked_kbs": linked,
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
            linked = cfg.get("linked_kbs", [])
            budget = cfg.get("context_budget", top_k)

            if linked:
                results = search_multi_kb(kb, linked, question, budget)
                context = build_multi_kb_context(results)
                used_kbs = list({r.get("_source_kb", cfg["name"]) for r in results})
            else:
                results = kb.search(question, top_k=top_k)
                context = f"ZNALOSTNÁ DATABÁZA: {cfg['name']}\n\n"
                for i, r in enumerate(results, 1):
                    context += f"--- Zdroj {i} (relevancia: {r['score']:.2f}) ---\n"
                    context += f"Titulok: {r['title']}\n"
                    context += f"URL: {r['url']}\n"
                    context += f"{r['content']}\n\n"
                used_kbs = [cfg["name"]]

            self._send_json({
                "agent": agent_key,
                "agent_name": cfg["name"],
                "linked_kbs": linked,
                "used_kbs": used_kbs,
                "system_prompt": cfg.get("system_prompt", ""),
                "context": context,
                "sources": kb.get_stats()["sources"],
                "context_chunks": len(results),
                "context_budget": budget,
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
                "adsun_dopyty": ["adsun", "dopyt", "dopyty", "polep", "fóli",
                                 "svetelná reklam", "svetelna reklam", "billboard",
                                 "reklam", "tlač", "tlac", "banner",
                                 "info@adsun", "wrapboys"],
            }
            detected = ""
            for key, triggers in TRIGGERS.items():
                if any(t in text for t in triggers):
                    detected = key
                    break

            if detected and detected in AGENTS:
                kb = KnowledgeBase(AGENTS[detected]["name"])
                stats = kb.get_stats()
                agent_cfg = AGENTS[detected]
                linked = agent_cfg.get("linked_kbs", [])
                has_knowledge = stats["chunks"] > 0
                if not has_knowledge and linked:
                    for lkb_name in linked:
                        try:
                            lkb = KnowledgeBase(lkb_name)
                            if lkb.get_stats()["chunks"] > 0:
                                has_knowledge = True
                                break
                        except Exception:
                            continue
                self._send_json({
                    "agent": detected,
                    "name": agent_cfg["name"],
                    "has_knowledge": has_knowledge,
                    "linked_kbs": linked,
                    "context_budget": agent_cfg.get("context_budget", 6),
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

        elif self.path == "/agents/link":
            body = self._read_body()
            agent_key = body.get("agent", "")
            action = body.get("action", "list")

            if agent_key and agent_key not in AGENTS:
                self._send_json({"error": f"Neznámy agent: {agent_key}"}, 400)
                return

            if action == "list":
                result = {}
                for key, agent_cfg in AGENTS.items():
                    kb = KnowledgeBase(agent_cfg["name"])
                    stats = kb.get_stats()
                    result[key] = {
                        "name": agent_cfg["name"],
                        "linked_kbs": agent_cfg.get("linked_kbs", []),
                        "context_budget": agent_cfg.get("context_budget", 6),
                        "chunks": stats["chunks"],
                        "sources": stats["sources"],
                    }
                self._send_json({"agents": result})

            elif action == "set":
                linked_kbs = body.get("linked_kbs", [])
                budget = body.get("context_budget")

                AGENTS[agent_key]["linked_kbs"] = linked_kbs
                if budget is not None:
                    AGENTS[agent_key]["context_budget"] = int(budget)

                cfg = load_config()
                if agent_key in cfg.get("custom_agents", {}):
                    cfg["custom_agents"][agent_key]["linked_kbs"] = linked_kbs
                    if budget is not None:
                        cfg["custom_agents"][agent_key]["context_budget"] = int(budget)
                    save_config(cfg)

                self._send_json({
                    "status": "updated",
                    "agent": agent_key,
                    "linked_kbs": linked_kbs,
                    "context_budget": AGENTS[agent_key].get("context_budget", 6),
                })

            elif action == "add":
                kb_name = body.get("kb_name", "")
                if not kb_name:
                    self._send_json({"error": "kb_name required"}, 400)
                    return
                linked = AGENTS[agent_key].get("linked_kbs", [])
                if kb_name not in linked:
                    linked.append(kb_name)
                    AGENTS[agent_key]["linked_kbs"] = linked
                    cfg = load_config()
                    if agent_key in cfg.get("custom_agents", {}):
                        cfg["custom_agents"][agent_key]["linked_kbs"] = linked
                        save_config(cfg)
                self._send_json({
                    "status": "linked",
                    "agent": agent_key,
                    "linked_kbs": linked,
                })

            elif action == "remove":
                kb_name = body.get("kb_name", "")
                linked = AGENTS[agent_key].get("linked_kbs", [])
                if kb_name in linked:
                    linked.remove(kb_name)
                    AGENTS[agent_key]["linked_kbs"] = linked
                    cfg = load_config()
                    if agent_key in cfg.get("custom_agents", {}):
                        cfg["custom_agents"][agent_key]["linked_kbs"] = linked
                        save_config(cfg)
                self._send_json({
                    "status": "unlinked",
                    "agent": agent_key,
                    "linked_kbs": linked,
                })

            else:
                self._send_json({"error": f"Unknown action: {action}"}, 400)

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

            # Email / ADsun (Microsoft Graph)
            from email_agent import _ms_graph, _ms_graph_juraj
            adsun_status = "connected" if _ms_graph.configured else "disconnected"
            integrations.append({
                "id": "email_adsun",
                "name": "Email ADsun (Microsoft 365)",
                "type": "email",
                "icon": "📧",
                "status": adsun_status,
                "provider": "Microsoft Graph API",
                "account": _ms_graph.mailbox,
                "capabilities": ["čítanie emailov", "posielanie emailov", "vyhľadávanie", "odpovede na dopyty"],
                "config": {
                    "mailbox": _ms_graph.mailbox,
                    "has_credentials": _ms_graph.configured,
                },
            })

            # Email / Juraj (Microsoft Graph)
            juraj_status = "connected" if _ms_graph_juraj.configured else "disconnected"
            integrations.append({
                "id": "email_juraj",
                "name": "Email Juraj (Microsoft 365)",
                "type": "email",
                "icon": "📧",
                "status": juraj_status,
                "provider": "Microsoft Graph API",
                "account": _ms_graph_juraj.mailbox,
                "capabilities": ["čítanie emailov", "posielanie emailov", "vyhľadávanie"],
                "config": {
                    "mailbox": _ms_graph_juraj.mailbox,
                    "has_credentials": _ms_graph_juraj.configured,
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
                "account": "gemini-2.5-flash",
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
                self._send_json({"tasks": tasks, "scheduler_active": True})

            elif action == "results":
                try:
                    results = _get_task_results(body.get("limit", 20))
                    self._send_json({"results": results})
                except Exception as e:
                    self._send_json({"error": str(e)}, 500)

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

                    _init_task_results_db()
                    _save_task_result(task["id"], task.get("name", ""), result)
                    self._send_json({"status": "completed", "result": result[:500]})
                except Exception as e:
                    _init_task_results_db()
                    _save_task_result(task_id, task.get("name", ""), str(e), "error")
                    self._send_json({"error": str(e)}, 500)

            else:
                self._send_json({"error": "Unknown action"}, 400)

        elif self.path == "/agent-run":
            body = self._read_body()
            prompt = body.get("prompt", "")
            agent_key = body.get("agent", "")
            if not prompt:
                self._send_json({"error": "prompt required"}, 400)
                return
            try:
                from agent import run_agent
                priming = []
                if agent_key and agent_key in AGENTS:
                    agent_cfg = AGENTS[agent_key]
                    kb = KnowledgeBase(agent_cfg["name"])
                    results = kb.search(prompt, top_k=3)
                    context = "\n".join(
                        f"Zdroj: {r['title']}\n{r['content']}" for r in results
                    )
                    if context.strip():
                        priming.append({
                            "role": "system",
                            "content": f"{agent_cfg.get('system_prompt', '')}\n\nKONTEXT:\n{context}",
                        })
                steps = run_agent(prompt, priming_messages=priming if priming else None)
                final = ""
                for s in reversed(steps):
                    if s.get("tool") == "done" and s.get("result"):
                        final = s["result"]
                        break
                if not final and steps:
                    final = steps[-1].get("result", "Agent nedokončil úlohu.")
                self._send_json({
                    "status": "completed",
                    "steps": steps,
                    "final_answer": final,
                    "total_steps": len(steps),
                })
            except Exception as e:
                logger.error(f"Agent run error: {e}")
                self._send_json({"error": str(e)}, 500)

        elif self.path == "/multi-agent":
            body = self._read_body()
            question = body.get("question", "")
            agent_keys = body.get("agents", [])
            if not question:
                self._send_json({"error": "question required"}, 400)
                return
            if not agent_keys:
                agent_keys = list(AGENTS.keys())

            import requests as req
            results_by_agent = {}
            for key in agent_keys:
                if key not in AGENTS:
                    continue
                cfg = AGENTS[key]
                try:
                    kb = KnowledgeBase(cfg["name"])
                    search_results = kb.search(question, top_k=3)
                    context = "\n".join(f"Zdroj: {r['title']}\n{r['content']}" for r in search_results)
                    if not context.strip():
                        results_by_agent[key] = {"agent": cfg["name"], "answer": "", "sources": 0}
                        continue
                    messages = [
                        {"role": "system", "content": cfg.get("system_prompt", "")},
                        {"role": "user", "content": f"{context}\n\nOTÁZKA: {question}"},
                    ]
                    r = req.post(
                        "http://localhost:11434/api/chat",
                        json={"model": "jalza", "messages": messages, "stream": False},
                        timeout=120,
                    )
                    answer = r.json().get("message", {}).get("content", "")
                    results_by_agent[key] = {
                        "agent": cfg["name"],
                        "answer": answer[:2000],
                        "sources": len(search_results),
                    }
                except Exception as e:
                    results_by_agent[key] = {"agent": cfg.get("name", key), "answer": "", "error": str(e)}

            self._send_json({"question": question, "results": results_by_agent})

        elif self.path == "/files":
            body = self._read_body()
            action = body.get("action", "list")
            files_dir = os.path.join(BASE_DIR, "user_files")
            os.makedirs(files_dir, exist_ok=True)

            if action == "list":
                folder = body.get("folder", "")
                target = os.path.join(files_dir, folder) if folder else files_dir
                if not os.path.isdir(target):
                    self._send_json({"files": []})
                    return
                entries = []
                for name in sorted(os.listdir(target)):
                    full = os.path.join(target, name)
                    is_dir = os.path.isdir(full)
                    size = os.path.getsize(full) if not is_dir else 0
                    mtime = os.path.getmtime(full)
                    entries.append({
                        "name": name,
                        "type": "folder" if is_dir else "file",
                        "size": size,
                        "modified": _dt.datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M"),
                    })
                self._send_json({"files": entries, "folder": folder})

            elif action == "upload":
                filename = body.get("filename", "")
                folder = body.get("folder", "")
                content_b64 = body.get("content_base64", "")
                if not filename or not content_b64:
                    self._send_json({"error": "filename and content_base64 required"}, 400)
                    return
                target_dir = os.path.join(files_dir, folder) if folder else files_dir
                os.makedirs(target_dir, exist_ok=True)
                safe_name = re.sub(r'[^\w\-_\. ]', '', filename)[:100]
                target_path = os.path.join(target_dir, safe_name)
                try:
                    data = base64.b64decode(content_b64)
                    with open(target_path, "wb") as f:
                        f.write(data)
                    self._send_json({"status": "uploaded", "filename": safe_name, "size": len(data)})
                except Exception as e:
                    self._send_json({"error": str(e)}, 500)

            elif action == "delete":
                filename = body.get("filename", "")
                folder = body.get("folder", "")
                if not filename:
                    self._send_json({"error": "filename required"}, 400)
                    return
                target_dir = os.path.join(files_dir, folder) if folder else files_dir
                target_path = os.path.join(target_dir, filename)
                if os.path.exists(target_path) and os.path.isfile(target_path):
                    os.remove(target_path)
                    self._send_json({"status": "deleted"})
                else:
                    self._send_json({"error": "File not found"}, 404)

            elif action == "create_folder":
                folder_name = body.get("name", "")
                parent = body.get("folder", "")
                if not folder_name:
                    self._send_json({"error": "name required"}, 400)
                    return
                target = os.path.join(files_dir, parent, folder_name) if parent else os.path.join(files_dir, folder_name)
                os.makedirs(target, exist_ok=True)
                self._send_json({"status": "created", "folder": folder_name})

            elif action == "download":
                filename = body.get("filename", "")
                folder = body.get("folder", "")
                target_dir = os.path.join(files_dir, folder) if folder else files_dir
                target_path = os.path.join(target_dir, filename)
                if os.path.isfile(target_path):
                    with open(target_path, "rb") as f:
                        data = f.read()
                    content_b64 = base64.b64encode(data).decode()
                    self._send_json({"filename": filename, "content_base64": content_b64, "size": len(data)})
                else:
                    self._send_json({"error": "File not found"}, 404)

            else:
                self._send_json({"error": "Unknown action"}, 400)

        elif self.path == "/webhooks":
            body = self._read_body()
            action = body.get("action", "list")
            cfg = load_config()
            webhooks = cfg.get("webhooks", [])

            if action == "list":
                self._send_json({"webhooks": webhooks})

            elif action == "create":
                import uuid
                wh = {
                    "id": str(uuid.uuid4())[:8],
                    "name": body.get("name", ""),
                    "url": body.get("url", ""),
                    "events": body.get("events", []),
                    "secret": body.get("secret", ""),
                    "enabled": True,
                    "created_at": _dt.datetime.now().isoformat(),
                }
                webhooks.append(wh)
                cfg["webhooks"] = webhooks
                save_config(cfg)
                self._send_json({"status": "created", "webhook": wh})

            elif action == "delete":
                wh_id = body.get("id", "")
                cfg["webhooks"] = [w for w in webhooks if w.get("id") != wh_id]
                save_config(cfg)
                self._send_json({"status": "deleted"})

            elif action == "toggle":
                wh_id = body.get("id", "")
                for w in webhooks:
                    if w["id"] == wh_id:
                        w["enabled"] = body.get("enabled", not w.get("enabled", True))
                cfg["webhooks"] = webhooks
                save_config(cfg)
                self._send_json({"status": "updated"})

            elif action == "test":
                wh_id = body.get("id", "")
                wh = next((w for w in webhooks if w.get("id") == wh_id), None)
                if not wh:
                    self._send_json({"error": "Webhook not found"}, 404)
                    return
                import requests as req
                try:
                    payload = {
                        "event": "test",
                        "source": "jalza",
                        "message": "Test webhook from J.A.L.Z.A.",
                        "timestamp": _dt.datetime.now().isoformat(),
                    }
                    headers = {"Content-Type": "application/json"}
                    if wh.get("secret"):
                        import hashlib
                        sig = hashlib.sha256((wh["secret"] + json.dumps(payload)).encode()).hexdigest()
                        headers["X-Webhook-Signature"] = sig
                    r = req.post(wh["url"], json=payload, headers=headers, timeout=10)
                    self._send_json({"status": "sent", "response_code": r.status_code})
                except Exception as e:
                    self._send_json({"error": str(e)}, 500)

            else:
                self._send_json({"error": "Unknown action"}, 400)

        elif self.path == "/webhook/incoming":
            body = self._read_body()
            event = body.get("event", "unknown")
            source = body.get("source", "unknown")
            data = body.get("data", {})
            message = body.get("message", "")
            logger.info(f"Incoming webhook: event={event}, source={source}")
            cfg = load_config()
            wh_log = cfg.get("webhook_log", [])
            wh_log.insert(0, {
                "event": event,
                "source": source,
                "message": message[:500],
                "received_at": _dt.datetime.now().isoformat(),
            })
            cfg["webhook_log"] = wh_log[:50]
            save_config(cfg)
            self._send_json({"status": "received"})

        elif self.path == "/contacts":
            body = self._read_body()
            action = body.get("action", "list")
            contacts_db = os.path.join(BASE_DIR, "contacts.db")
            conn = sqlite3.connect(contacts_db)
            conn.execute("""CREATE TABLE IF NOT EXISTS contacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT DEFAULT '',
                phone TEXT DEFAULT '',
                company TEXT DEFAULT '',
                role TEXT DEFAULT '',
                notes TEXT DEFAULT '',
                created_at TEXT DEFAULT (datetime('now','localtime'))
            )""")

            if action == "list":
                rows = conn.execute("SELECT * FROM contacts ORDER BY name").fetchall()
                cols = ["id", "name", "email", "phone", "company", "role", "notes", "created_at"]
                contacts = [dict(zip(cols, r)) for r in rows]
                conn.close()
                self._send_json({"contacts": contacts})

            elif action == "add":
                name = body.get("name", "").strip()
                if not name:
                    conn.close()
                    self._send_json({"error": "name required"}, 400)
                    return
                conn.execute(
                    "INSERT INTO contacts (name, email, phone, company, role, notes) VALUES (?, ?, ?, ?, ?, ?)",
                    (name, body.get("email", ""), body.get("phone", ""), body.get("company", ""), body.get("role", ""), body.get("notes", ""))
                )
                conn.commit()
                conn.close()
                self._send_json({"status": "added", "name": name})

            elif action == "update":
                cid = body.get("id")
                if not cid:
                    conn.close()
                    self._send_json({"error": "id required"}, 400)
                    return
                fields = []
                values = []
                for f in ["name", "email", "phone", "company", "role", "notes"]:
                    if f in body:
                        fields.append(f"{f} = ?")
                        values.append(body[f])
                if fields:
                    values.append(cid)
                    conn.execute(f"UPDATE contacts SET {', '.join(fields)} WHERE id = ?", values)
                    conn.commit()
                conn.close()
                self._send_json({"status": "updated"})

            elif action == "delete":
                cid = body.get("id")
                if cid:
                    conn.execute("DELETE FROM contacts WHERE id = ?", (cid,))
                    conn.commit()
                conn.close()
                self._send_json({"status": "deleted"})

            elif action == "search":
                q = body.get("query", "")
                rows = conn.execute(
                    "SELECT * FROM contacts WHERE name LIKE ? OR email LIKE ? OR company LIKE ? ORDER BY name LIMIT 20",
                    (f"%{q}%", f"%{q}%", f"%{q}%")
                ).fetchall()
                cols = ["id", "name", "email", "phone", "company", "role", "notes", "created_at"]
                contacts = [dict(zip(cols, r)) for r in rows]
                conn.close()
                self._send_json({"contacts": contacts})

            else:
                conn.close()
                self._send_json({"error": "Unknown action"}, 400)

        elif self.path == "/push/subscribe":
            body = self._read_body()
            sub = body.get("subscription", {})
            if sub:
                cfg = load_config()
                subs = cfg.get("push_subscriptions", [])
                endpoints = [s.get("endpoint") for s in subs]
                if sub.get("endpoint") not in endpoints:
                    subs.append(sub)
                    cfg["push_subscriptions"] = subs
                    save_config(cfg)
                self._send_json({"status": "subscribed"})
            else:
                self._send_json({"error": "No subscription"}, 400)

        elif self.path == "/push/unsubscribe":
            body = self._read_body()
            endpoint = body.get("endpoint", "")
            if endpoint:
                cfg = load_config()
                subs = cfg.get("push_subscriptions", [])
                cfg["push_subscriptions"] = [s for s in subs if s.get("endpoint") != endpoint]
                save_config(cfg)
            self._send_json({"status": "unsubscribed"})

        elif self.path == "/facts":
            body = self._read_body()
            action = body.get("action", "list")
            facts_db = os.path.join(BASE_DIR, "memory", "jalza.db")
            os.makedirs(os.path.join(BASE_DIR, "memory"), exist_ok=True)

            conn = sqlite3.connect(facts_db)
            conn.execute("""CREATE TABLE IF NOT EXISTS facts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                fact TEXT NOT NULL UNIQUE,
                category TEXT DEFAULT 'general',
                created_at TEXT DEFAULT (datetime('now','localtime'))
            )""")

            if action == "list":
                rows = conn.execute(
                    "SELECT id, fact, category, created_at FROM facts ORDER BY id DESC LIMIT ?",
                    (body.get("limit", 100),)
                ).fetchall()
                facts = [{"id": r[0], "fact": r[1], "category": r[2], "created_at": r[3]} for r in rows]
                conn.close()
                self._send_json({"facts": facts, "total": len(facts)})

            elif action == "add":
                fact_text = body.get("fact", "").strip()
                category = body.get("category", "general")
                if not fact_text:
                    conn.close()
                    self._send_json({"error": "fact required"}, 400)
                    return
                try:
                    conn.execute(
                        "INSERT OR IGNORE INTO facts (fact, category, created_at) VALUES (?, ?, ?)",
                        (fact_text, category, _dt.datetime.now().isoformat())
                    )
                    conn.commit()
                    conn.close()
                    self._send_json({"status": "saved", "fact": fact_text})
                except Exception as e:
                    conn.close()
                    self._send_json({"error": str(e)}, 500)

            elif action == "delete":
                fact_id = body.get("id")
                if fact_id:
                    conn.execute("DELETE FROM facts WHERE id = ?", (fact_id,))
                conn.commit()
                conn.close()
                self._send_json({"status": "deleted"})

            elif action == "search":
                query = body.get("query", "")
                rows = conn.execute(
                    "SELECT id, fact, category, created_at FROM facts WHERE fact LIKE ? ORDER BY id DESC LIMIT 20",
                    (f"%{query}%",)
                ).fetchall()
                facts = [{"id": r[0], "fact": r[1], "category": r[2], "created_at": r[3]} for r in rows]
                conn.close()
                self._send_json({"facts": facts})

            else:
                conn.close()
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

        elif self.path == "/usage":
            body = self._read_body()
            action = body.get("action", "log")
            conn = sqlite3.connect(CONVERSATIONS_DB)
            conn.row_factory = sqlite3.Row

            if action == "log":
                conn.execute(
                    "INSERT INTO usage_log (timestamp, model, provider, route, input_tokens, output_tokens, cost_usd, user_id) VALUES (?,?,?,?,?,?,?,?)",
                    (
                        body.get("timestamp", _dt.datetime.now(_dt.timezone.utc).isoformat()),
                        body.get("model", "unknown"),
                        body.get("provider", "ollama"),
                        body.get("route", "chat"),
                        body.get("input_tokens", 0),
                        body.get("output_tokens", 0),
                        body.get("cost_usd", 0.0),
                        body.get("user_id", "default"),
                    ),
                )
                conn.commit()
                conn.close()
                self._send_json({"status": "logged"})

            elif action == "summary":
                period = body.get("period", "month")
                if period == "week":
                    since = (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(days=7)).isoformat()
                elif period == "day":
                    since = (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(days=1)).isoformat()
                else:
                    since = (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(days=30)).isoformat()

                rows = conn.execute(
                    """SELECT model, provider, route,
                       COUNT(*) as requests,
                       SUM(input_tokens) as total_input,
                       SUM(output_tokens) as total_output,
                       SUM(cost_usd) as total_cost,
                       DATE(timestamp) as day
                    FROM usage_log
                    WHERE timestamp >= ?
                    GROUP BY model, provider, route, DATE(timestamp)
                    ORDER BY DATE(timestamp) DESC""",
                    (since,),
                ).fetchall()

                totals = conn.execute(
                    """SELECT
                       COUNT(*) as requests,
                       SUM(input_tokens) as total_input,
                       SUM(output_tokens) as total_output,
                       SUM(cost_usd) as total_cost
                    FROM usage_log WHERE timestamp >= ?""",
                    (since,),
                ).fetchone()

                by_model = conn.execute(
                    """SELECT model, provider,
                       COUNT(*) as requests,
                       SUM(input_tokens) as total_input,
                       SUM(output_tokens) as total_output,
                       SUM(cost_usd) as total_cost
                    FROM usage_log WHERE timestamp >= ?
                    GROUP BY model, provider
                    ORDER BY total_cost DESC""",
                    (since,),
                ).fetchall()

                conn.close()
                self._send_json({
                    "period": period,
                    "since": since,
                    "totals": dict(totals) if totals else {},
                    "by_model": [dict(r) for r in by_model],
                    "daily": [dict(r) for r in rows],
                })
            else:
                conn.close()
                self._send_json({"error": f"Unknown action: {action}"}, 400)

        elif self.path == "/business" or self.path.startswith("/business/"):
            body = self._read_body()
            action = body.get("action", "summary")
            biz_url = os.environ.get("BUSINESS_FLOW_URL", "https://business-flow-ai.up.railway.app").rstrip("/")
            biz_token = API_TOKEN

            WRITE_ACTIONS = {"create_customer", "create_project", "create_calculation", "share_calculation", "find_products"}

            try:
                import urllib.request
                import urllib.parse

                if action in WRITE_ACTIONS or action == "search":
                    req_url = f"{biz_url}/api/jalza"
                    req_data = json.dumps(body).encode()
                    req = urllib.request.Request(req_url, data=req_data, method="POST")
                    req.add_header("Content-Type", "application/json")
                else:
                    params = {"action": action}
                    for k in ["status", "type", "search", "limit", "offset", "period", "id", "query"]:
                        if k in body:
                            params[k] = str(body[k])
                    qs = urllib.parse.urlencode(params)
                    req_url = f"{biz_url}/api/jalza?{qs}"
                    req = urllib.request.Request(req_url, method="GET")

                req.add_header("X-API-Token", biz_token)

                with urllib.request.urlopen(req, timeout=15) as resp:
                    result = json.loads(resp.read().decode())
                    self._send_json(result)
            except Exception as e:
                logger.error(f"Business API error: {e}")
                self._send_json({"error": str(e)}, 502)

        elif self.path == "/business-agent":
            body = self._read_body()
            prompt = body.get("prompt", "")
            if not prompt:
                self._send_json({"error": "Missing prompt"}, 400)
            else:
                try:
                    result = _run_business_agent(prompt)
                    self._send_json(result)
                except Exception as e:
                    logger.error(f"Business agent error: {e}")
                    self._send_json({"error": str(e)}, 500)

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

        # ── ADsun email (info@adsun.sk via Microsoft Graph) ───────
        elif self.path == "/email/adsun/list":
            body = self._read_body()
            try:
                from email_agent import list_adsun_emails
                limit = body.get("limit", 10)
                unseen = body.get("unseen_only", True)
                today = body.get("today_only", False)
                results = list_adsun_emails(limit=limit, unseen_only=unseen, today_only=today)
                if isinstance(results, dict) and "error" in results:
                    self._send_json(results, 500)
                else:
                    self._send_json({"emails": results, "count": len(results), "mailbox": "info@adsun.sk"})
            except Exception as e:
                self._send_json({"error": str(e)}, 500)

        elif self.path == "/email/adsun/read":
            body = self._read_body()
            message_id = body.get("id", "")
            if not message_id:
                self._send_json({"error": "id required"}, 400)
                return
            try:
                from email_agent import read_adsun_email
                result = read_adsun_email(message_id)
                self._send_json(result)
            except Exception as e:
                self._send_json({"error": str(e)}, 500)

        elif self.path == "/email/adsun/search":
            body = self._read_body()
            query = body.get("query", "")
            limit = body.get("limit", 10)
            if not query:
                self._send_json({"error": "query required"}, 400)
                return
            try:
                from email_agent import search_adsun_emails
                results = search_adsun_emails(query, limit)
                if isinstance(results, dict) and "error" in results:
                    self._send_json(results, 500)
                else:
                    self._send_json({"emails": results, "count": len(results)})
            except Exception as e:
                self._send_json({"error": str(e)}, 500)

        elif self.path == "/email/adsun/send":
            body = self._read_body()
            to_addr = body.get("to", "")
            subject = body.get("subject", "")
            text = body.get("body", "")
            if not to_addr or not subject or not text:
                self._send_json({"error": "Zadaj to, subject, body"}, 400)
                return
            try:
                from email_agent import send_adsun_email
                result = send_adsun_email(to_addr, subject, text)
                self._send_json(result)
            except Exception as e:
                self._send_json({"error": str(e)}, 500)

        elif self.path == "/email/adsun/reply":
            body = self._read_body()
            message_id = body.get("id", "")
            text = body.get("body", "")
            if not message_id or not text:
                self._send_json({"error": "id a body sú povinné"}, 400)
                return
            try:
                from email_agent import reply_adsun_email
                result = reply_adsun_email(message_id, text)
                self._send_json(result)
            except Exception as e:
                self._send_json({"error": str(e)}, 500)

        elif self.path == "/email/adsun/check":
            body = self._read_body()
            dry_run = body.get("dry_run", True)
            try:
                from email_agent import check_adsun_and_reply
                results = check_adsun_and_reply(dry_run=dry_run)
                self._send_json({"emails": results, "count": len(results)})
            except Exception as e:
                self._send_json({"error": str(e)}, 500)

        # ── Juraj email (juraj@adsun.sk via Microsoft Graph) ──────
        elif self.path == "/email/juraj/list":
            body = self._read_body()
            try:
                from email_agent import list_juraj_emails
                limit = body.get("limit", 10)
                unseen = body.get("unseen_only", True)
                today = body.get("today_only", False)
                results = list_juraj_emails(limit=limit, unseen_only=unseen, today_only=today)
                if isinstance(results, dict) and "error" in results:
                    self._send_json(results, 500)
                else:
                    self._send_json({"emails": results, "count": len(results), "mailbox": "juraj@adsun.sk"})
            except Exception as e:
                self._send_json({"error": str(e)}, 500)

        elif self.path == "/email/juraj/read":
            body = self._read_body()
            message_id = body.get("id", "")
            if not message_id:
                self._send_json({"error": "id required"}, 400)
                return
            try:
                from email_agent import read_juraj_email
                result = read_juraj_email(message_id)
                self._send_json(result)
            except Exception as e:
                self._send_json({"error": str(e)}, 500)

        elif self.path == "/email/juraj/search":
            body = self._read_body()
            query = body.get("query", "")
            limit = body.get("limit", 10)
            if not query:
                self._send_json({"error": "query required"}, 400)
                return
            try:
                from email_agent import search_juraj_emails
                results = search_juraj_emails(query, limit)
                if isinstance(results, dict) and "error" in results:
                    self._send_json(results, 500)
                else:
                    self._send_json({"emails": results, "count": len(results)})
            except Exception as e:
                self._send_json({"error": str(e)}, 500)

        elif self.path == "/email/juraj/send":
            body = self._read_body()
            to_addr = body.get("to", "")
            subject = body.get("subject", "")
            text = body.get("body", "")
            if not to_addr or not subject or not text:
                self._send_json({"error": "Zadaj to, subject, body"}, 400)
                return
            try:
                from email_agent import send_juraj_email
                result = send_juraj_email(to_addr, subject, text)
                self._send_json(result)
            except Exception as e:
                self._send_json({"error": str(e)}, 500)

        elif self.path == "/email/juraj/reply":
            body = self._read_body()
            message_id = body.get("id", "")
            text = body.get("body", "")
            if not message_id or not text:
                self._send_json({"error": "id a body sú povinné"}, 400)
                return
            try:
                from email_agent import reply_juraj_email
                result = reply_juraj_email(message_id, text)
                self._send_json(result)
            except Exception as e:
                self._send_json({"error": str(e)}, 500)

        # ── Mailboxes config ───────────────────────────────────────────
        elif self.path == "/mailboxes":
            try:
                import json as _json
                cfg_path = os.path.join(BASE_DIR, "config.json")
                with open(cfg_path, "r", encoding="utf-8") as f:
                    cfg = _json.load(f)
                mailboxes = cfg.get("mailboxes", [])
                self._send_json({"mailboxes": mailboxes})
            except Exception as e:
                self._send_json({"error": str(e)}, 500)

        # ── Calendar endpoints ─────────────────────────────────────────
        elif self.path == "/calendar/list":
            body = self._read_body()
            try:
                from calendar_agent import list_calendar_events
                result = list_calendar_events(account=body.get("account", "juraj"), start=body.get("start"), end=body.get("end"), limit=body.get("limit", 20))
                self._send_json({"events": result} if isinstance(result, list) else result)
            except Exception as e:
                self._send_json({"error": str(e)}, 500)

        elif self.path == "/calendar/today":
            body = self._read_body()
            try:
                from calendar_agent import today_calendar
                result = today_calendar(account=body.get("account", "juraj"))
                self._send_json({"events": result} if isinstance(result, list) else result)
            except Exception as e:
                self._send_json({"error": str(e)}, 500)

        elif self.path == "/calendar/week":
            body = self._read_body()
            try:
                from calendar_agent import week_calendar
                result = week_calendar(account=body.get("account", "juraj"))
                self._send_json({"events": result} if isinstance(result, list) else result)
            except Exception as e:
                self._send_json({"error": str(e)}, 500)

        elif self.path == "/calendar/get":
            body = self._read_body()
            event_id = body.get("id", "")
            if not event_id:
                self._send_json({"error": "id je povinné"}, 400)
                return
            try:
                from calendar_agent import get_calendar_event
                self._send_json(get_calendar_event(event_id, account=body.get("account", "juraj")))
            except Exception as e:
                self._send_json({"error": str(e)}, 500)

        elif self.path == "/calendar/create":
            body = self._read_body()
            subject = body.get("subject", "")
            start = body.get("start", "")
            end = body.get("end", "")
            if not subject or not start or not end:
                self._send_json({"error": "subject, start a end sú povinné"}, 400)
                return
            try:
                from calendar_agent import create_calendar_event
                result = create_calendar_event(subject=subject, start=start, end=end, account=body.get("account", "juraj"), location=body.get("location", ""), body=body.get("body", ""), attendees=body.get("attendees"), is_all_day=body.get("is_all_day", False))
                self._send_json(result)
            except Exception as e:
                self._send_json({"error": str(e)}, 500)

        elif self.path == "/calendar/update":
            body = self._read_body()
            event_id = body.get("id", "")
            if not event_id:
                self._send_json({"error": "id je povinné"}, 400)
                return
            try:
                from calendar_agent import update_calendar_event
                self._send_json(update_calendar_event(event_id, body.get("updates", {}), account=body.get("account", "juraj")))
            except Exception as e:
                self._send_json({"error": str(e)}, 500)

        elif self.path == "/calendar/delete":
            body = self._read_body()
            event_id = body.get("id", "")
            if not event_id:
                self._send_json({"error": "id je povinné"}, 400)
                return
            try:
                from calendar_agent import delete_calendar_event
                self._send_json(delete_calendar_event(event_id, account=body.get("account", "juraj")))
            except Exception as e:
                self._send_json({"error": str(e)}, 500)

        elif self.path == "/calendar/search":
            body = self._read_body()
            query = body.get("query", "")
            if not query:
                self._send_json({"error": "query je povinné"}, 400)
                return
            try:
                from calendar_agent import search_calendar
                result = search_calendar(query, account=body.get("account", "juraj"), limit=body.get("limit", 10))
                self._send_json({"events": result} if isinstance(result, list) else result)
            except Exception as e:
                self._send_json({"error": str(e)}, 500)

        else:
            self._send_json({"error": "not found"}, 404)


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


# ── Task Scheduler ──────────────────────────────────────────────────
import threading

SCHEDULE_MAP = {
    "hourly": lambda now: True,
    "daily_morning": lambda now: now.hour == 7 and now.minute < 2,
    "daily_evening": lambda now: now.hour == 19 and now.minute < 2,
    "weekly": lambda now: now.weekday() == 0 and now.hour == 8 and now.minute < 2,
    "monthly": lambda now: now.day == 1 and now.hour == 8 and now.minute < 2,
}

TASK_RESULTS_DB = os.path.join(BASE_DIR, "task_results.db")

def _init_task_results_db():
    conn = sqlite3.connect(TASK_RESULTS_DB)
    conn.execute("""CREATE TABLE IF NOT EXISTS task_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT, task_name TEXT, result TEXT,
        status TEXT DEFAULT 'completed',
        created_at TEXT DEFAULT (datetime('now','localtime'))
    )""")
    conn.commit()
    conn.close()

def _save_task_result(task_id, task_name, result, status="completed"):
    conn = sqlite3.connect(TASK_RESULTS_DB)
    conn.execute(
        "INSERT INTO task_results (task_id, task_name, result, status) VALUES (?, ?, ?, ?)",
        (task_id, task_name, result[:5000], status)
    )
    conn.execute("DELETE FROM task_results WHERE id NOT IN (SELECT id FROM task_results ORDER BY id DESC LIMIT 100)")
    conn.commit()
    conn.close()

def _get_task_results(limit=20):
    conn = sqlite3.connect(TASK_RESULTS_DB)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT * FROM task_results ORDER BY id DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]

def _run_scheduled_task(task):
    import requests as req
    try:
        messages = [{"role": "user", "content": task["prompt"]}]
        agent_key = task.get("agent", "")
        if agent_key and agent_key in AGENTS:
            agent_cfg = AGENTS[agent_key]
            kb = KnowledgeBase(agent_cfg["name"])
            results = kb.search(task["prompt"], top_k=3)
            context = "\n".join(f"Zdroj: {r['title']}\n{r['content']}" for r in results)
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
        _save_task_result(task["id"], task.get("name", ""), result)

        cfg = load_config()
        for t in cfg.get("scheduled_tasks_v2", []):
            if t["id"] == task["id"]:
                t["last_run"] = _dt.datetime.now().strftime("%Y-%m-%d %H:%M")
                break
        save_config(cfg)

        logger.info(f"Task '{task.get('name')}' completed: {result[:100]}")
    except Exception as e:
        _save_task_result(task["id"], task.get("name", ""), str(e), "error")
        logger.error(f"Task '{task.get('name')}' failed: {e}")


def _scheduler_loop():
    _init_task_results_db()
    ran_this_hour = set()
    logger.info("Scheduler thread started")

    while True:
        try:
            now = _dt.datetime.now()
            hour_key = f"{now.year}-{now.month}-{now.day}-{now.hour}"
            cfg = load_config()

            for task in cfg.get("scheduled_tasks_v2", []):
                if not task.get("enabled", False):
                    continue
                schedule = task.get("schedule", "daily_morning")
                task_hour_key = f"{hour_key}-{task['id']}"
                if task_hour_key in ran_this_hour:
                    continue

                should_run = False
                if schedule in SCHEDULE_MAP:
                    should_run = SCHEDULE_MAP[schedule](now)
                elif schedule == "custom":
                    should_run = False

                if schedule == "hourly":
                    if now.minute >= 2:
                        continue

                if should_run:
                    ran_this_hour.add(task_hour_key)
                    logger.info(f"Scheduler: running task '{task.get('name')}' (schedule={schedule})")
                    thread = threading.Thread(target=_run_scheduled_task, args=(task,), daemon=True)
                    thread.start()

            old_keys = [k for k in ran_this_hour if not k.startswith(hour_key)]
            for k in old_keys:
                ran_this_hour.discard(k)

        except Exception as e:
            logger.error(f"Scheduler error: {e}")

        import time
        time.sleep(30)


if __name__ == "__main__":
    scheduler_thread = threading.Thread(target=_scheduler_loop, daemon=True)
    scheduler_thread.start()

    server = ThreadedHTTPServer(("0.0.0.0", PORT), KnowledgeHandler)
    print(f"Knowledge API beží na porte {PORT} (threaded)")
    print(f"Endpointy: GET /agents, POST /ask, POST /context, POST /search, POST /detect")
    print(f"Scheduler: aktívny (kontroluje úlohy každých 30s)")
    server.serve_forever()
