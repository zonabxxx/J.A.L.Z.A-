"""
Knowledge Scraper pre J.A.L.Z.A.
Autonómne vyhľadáva, sťahuje a ukladá znalosti z webu do lokálnej Knowledge base.
"""

import os
import re
import json
import hashlib
import sqlite3
import requests
from datetime import datetime
from duckduckgo_search import DDGS
from html.parser import HTMLParser

KNOWLEDGE_DIR = os.path.join(os.path.dirname(__file__), "knowledge")
KNOWLEDGE_DB = os.path.join(KNOWLEDGE_DIR, "knowledge.db")


class HTMLTextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self._text = []
        self._skip = False
        self._skip_tags = {"script", "style", "nav", "footer", "header", "aside"}

    def handle_starttag(self, tag, attrs):
        if tag in self._skip_tags:
            self._skip = True

    def handle_endtag(self, tag):
        if tag in self._skip_tags:
            self._skip = False
        if tag in ("p", "div", "br", "h1", "h2", "h3", "h4", "li", "tr"):
            self._text.append("\n")

    def handle_data(self, data):
        if not self._skip:
            self._text.append(data)

    def get_text(self):
        text = "".join(self._text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        text = re.sub(r"[ \t]+", " ", text)
        return text.strip()


def init_db():
    os.makedirs(KNOWLEDGE_DIR, exist_ok=True)
    conn = sqlite3.connect(KNOWLEDGE_DB)
    conn.execute("""CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT UNIQUE,
        title TEXT,
        topic TEXT,
        content_hash TEXT,
        file_path TEXT,
        char_count INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )""")
    conn.commit()
    return conn


def extract_text_from_html(html: str) -> str:
    parser = HTMLTextExtractor()
    parser.feed(html)
    return parser.get_text()


def search_web(query: str, num_results: int = 10) -> list[dict]:
    try:
        headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}
        r = requests.post(
            "https://html.duckduckgo.com/html/",
            data={"q": query},
            headers=headers,
            timeout=15,
        )
        results = []
        blocks = re.findall(
            r'<a rel="nofollow" class="result__a" href="([^"]+)"[^>]*>(.*?)</a>.*?'
            r'<a class="result__snippet"[^>]*>(.*?)</a>',
            r.text, re.DOTALL,
        )
        for href, title, snippet in blocks[:num_results]:
            title = re.sub(r"<[^>]+>", "", title).strip()
            snippet = re.sub(r"<[^>]+>", "", snippet).strip()
            results.append({"title": title, "body": snippet, "href": href})
        return results
    except Exception:
        return []


def download_page(url: str) -> tuple[str, str]:
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    }
    r = requests.get(url, headers=headers, timeout=30, allow_redirects=True)
    r.raise_for_status()
    r.encoding = r.apparent_encoding or "utf-8"

    title_match = re.search(r"<title[^>]*>(.*?)</title>", r.text, re.IGNORECASE | re.DOTALL)
    title = title_match.group(1).strip() if title_match else url

    text = extract_text_from_html(r.text)
    return title, text


def scrape_topic(topic: str, queries: list[str] = None, num_results: int = 10) -> dict:
    """
    Vyhľadá tému na webe, stiahne relevantné stránky a uloží ich lokálne.
    
    Args:
        topic: Názov témy (napr. "Daňové zákony SR")
        queries: Zoznam vyhľadávacích dotazov. Ak None, použije topic.
        num_results: Počet výsledkov na dotaz.
    
    Returns:
        Štatistiky o stiahnutých dokumentoch.
    """
    conn = init_db()
    topic_dir = os.path.join(KNOWLEDGE_DIR, re.sub(r"[^\w\-]", "_", topic))
    os.makedirs(topic_dir, exist_ok=True)

    if queries is None:
        queries = [topic]

    stats = {"searched": 0, "downloaded": 0, "skipped": 0, "errors": 0, "total_chars": 0}

    all_urls = []
    for query in queries:
        results = search_web(query, num_results)
        stats["searched"] += len(results)
        for r in results:
            url = r.get("href", "")
            if url and url not in [u[0] for u in all_urls]:
                all_urls.append((url, r.get("title", "")))

    for url, search_title in all_urls:
        existing = conn.execute("SELECT id FROM documents WHERE url = ?", (url,)).fetchone()
        if existing:
            stats["skipped"] += 1
            continue

        try:
            title, text = download_page(url)
            if len(text) < 200:
                stats["skipped"] += 1
                continue

            content_hash = hashlib.md5(text.encode()).hexdigest()
            filename = re.sub(r"[^\w\-]", "_", title)[:80] + ".txt"
            filepath = os.path.join(topic_dir, filename)

            with open(filepath, "w", encoding="utf-8") as f:
                f.write(f"ZDROJ: {url}\n")
                f.write(f"TITULOK: {title}\n")
                f.write(f"STIAHNUTÉ: {datetime.now().isoformat()}\n")
                f.write(f"{'=' * 60}\n\n")
                f.write(text)

            conn.execute(
                "INSERT OR IGNORE INTO documents (url, title, topic, content_hash, file_path, char_count) VALUES (?, ?, ?, ?, ?, ?)",
                (url, title, topic, content_hash, filepath, len(text)),
            )
            conn.commit()
            stats["downloaded"] += 1
            stats["total_chars"] += len(text)

        except Exception as e:
            stats["errors"] += 1

    conn.close()
    return stats


def upload_to_openwebui(topic: str, openwebui_url: str = "http://localhost:3001"):
    """Nahrá stiahnuté dokumenty do Open WebUI Knowledge base."""
    topic_dir = os.path.join(KNOWLEDGE_DIR, re.sub(r"[^\w\-]", "_", topic))
    if not os.path.exists(topic_dir):
        return {"error": f"Priečinok {topic_dir} neexistuje"}

    files = [f for f in os.listdir(topic_dir) if f.endswith(".txt")]
    return {
        "topic": topic,
        "files": len(files),
        "path": topic_dir,
        "instruction": f"Nahraj súbory z {topic_dir} cez Open WebUI → Knowledge → Upload",
    }


def list_knowledge() -> list[dict]:
    """Vypíše všetky stiahnuté znalosti."""
    if not os.path.exists(KNOWLEDGE_DB):
        return []
    conn = sqlite3.connect(KNOWLEDGE_DB)
    rows = conn.execute(
        "SELECT topic, COUNT(*) as docs, SUM(char_count) as chars FROM documents GROUP BY topic"
    ).fetchall()
    conn.close()
    return [{"topic": r[0], "documents": r[1], "characters": r[2]} for r in rows]


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Použitie: python3 knowledge_scraper.py <téma> [dotaz1] [dotaz2] ...")
        print("\nPríklad:")
        print('  python3 knowledge_scraper.py "Daňové zákony SR" "zákon o dani z príjmov 595/2003" "DPH zákon slovensko"')
        sys.exit(1)

    topic = sys.argv[1]
    queries = sys.argv[2:] if len(sys.argv) > 2 else None

    print(f"Hľadám: {topic}")
    stats = scrape_topic(topic, queries)
    print(f"\nHotovo:")
    print(f"  Nájdené: {stats['searched']}")
    print(f"  Stiahnuté: {stats['downloaded']}")
    print(f"  Preskočené: {stats['skipped']}")
    print(f"  Chyby: {stats['errors']}")
    print(f"  Celkovo znakov: {stats['total_chars']:,}")

    info = upload_to_openwebui(topic)
    print(f"\nSúbory uložené v: {info.get('path', '?')}")
    print(f"Počet súborov: {info.get('files', 0)}")
