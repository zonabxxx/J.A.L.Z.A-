"""
Znalostná databáza pre špecializovaných agentov J.A.L.Z.A.
Každý agent má svoju vlastnú DB s embeddingami a semantickým vyhľadávaním.
"""

import os
import re
import json
import math
import hashlib
import sqlite3
import requests
from datetime import datetime

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False

OLLAMA_URL = "http://localhost:11434"
EMBED_MODEL = "nomic-embed-text"
BASES_DIR = os.path.join(os.path.dirname(__file__), "knowledge_bases")


class KnowledgeBase:
    def __init__(self, name: str, description: str = ""):
        self.name = name
        self.description = description
        self.db_dir = os.path.join(BASES_DIR, re.sub(r"[^\w\-]", "_", name))
        os.makedirs(self.db_dir, exist_ok=True)
        self.db_path = os.path.join(self.db_dir, "knowledge.db")
        self._init_db()

    def _init_db(self):
        conn = sqlite3.connect(self.db_path)
        conn.execute("""CREATE TABLE IF NOT EXISTS chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_url TEXT,
            title TEXT,
            chunk_index INTEGER,
            content TEXT,
            embedding TEXT,
            char_count INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS sources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT UNIQUE,
            title TEXT,
            total_chars INTEGER,
            chunks_count INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )""")
        conn.execute("""CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT
        )""")
        conn.execute(
            "INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)",
            ("description", self.description),
        )
        conn.commit()
        conn.close()

    def _get_embedding(self, text: str) -> list[float]:
        r = requests.post(
            f"{OLLAMA_URL}/api/embed",
            json={"model": EMBED_MODEL, "input": text},
            timeout=30,
        )
        r.raise_for_status()
        data = r.json()
        return data.get("embeddings", [[]])[0]

    @staticmethod
    def _cosine_similarity(a: list[float], b: list[float]) -> float:
        dot = sum(x * y for x, y in zip(a, b))
        norm_a = math.sqrt(sum(x * x for x in a))
        norm_b = math.sqrt(sum(x * x for x in b))
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return dot / (norm_a * norm_b)

    @staticmethod
    def _chunk_text(text: str, chunk_size: int = 1000, overlap: int = 200) -> list[str]:
        chunks = []
        start = 0
        while start < len(text):
            end = start + chunk_size
            chunk = text[start:end]
            if len(chunk.strip()) > 50:
                chunks.append(chunk.strip())
            start = end - overlap
        return chunks

    def add_document(self, url: str, title: str, text: str) -> dict:
        conn = sqlite3.connect(self.db_path)
        existing = conn.execute("SELECT id FROM sources WHERE url = ?", (url,)).fetchone()
        if existing:
            conn.close()
            return {"status": "skipped", "reason": "already exists"}

        chunks = self._chunk_text(text)
        added = 0
        for i, chunk in enumerate(chunks):
            try:
                embedding = self._get_embedding(chunk)
                conn.execute(
                    "INSERT INTO chunks (source_url, title, chunk_index, content, embedding, char_count) VALUES (?, ?, ?, ?, ?, ?)",
                    (url, title, i, chunk, json.dumps(embedding), len(chunk)),
                )
                added += 1
            except Exception:
                continue

        conn.execute(
            "INSERT OR IGNORE INTO sources (url, title, total_chars, chunks_count) VALUES (?, ?, ?, ?)",
            (url, title, len(text), added),
        )
        conn.commit()
        conn.close()
        return {"status": "added", "chunks": added, "chars": len(text)}

    _embedding_cache = {}

    def _load_embeddings_matrix(self):
        cache_key = self.db_path
        if cache_key in KnowledgeBase._embedding_cache:
            cached = KnowledgeBase._embedding_cache[cache_key]
            conn = sqlite3.connect(self.db_path)
            current_count = conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
            conn.close()
            if cached["count"] == current_count:
                return cached

        conn = sqlite3.connect(self.db_path)
        rows = conn.execute("SELECT id, source_url, title, content, embedding FROM chunks").fetchall()
        conn.close()

        ids = []
        urls = []
        titles = []
        contents = []
        embeddings = []
        for row in rows:
            ids.append(row[0])
            urls.append(row[1])
            titles.append(row[2])
            contents.append(row[3])
            embeddings.append(json.loads(row[4]))

        if HAS_NUMPY and embeddings:
            matrix = np.array(embeddings, dtype=np.float32)
            norms = np.linalg.norm(matrix, axis=1, keepdims=True)
            norms[norms == 0] = 1.0
            matrix = matrix / norms
        else:
            matrix = embeddings

        cached = {
            "ids": ids, "urls": urls, "titles": titles, "contents": contents,
            "matrix": matrix, "count": len(rows),
        }
        KnowledgeBase._embedding_cache[cache_key] = cached
        return cached

    def search(self, query: str, top_k: int = 5) -> list[dict]:
        query_embedding = self._get_embedding(query)
        data = self._load_embeddings_matrix()

        if not data["ids"]:
            return []

        if HAS_NUMPY:
            qvec = np.array(query_embedding, dtype=np.float32)
            qnorm = np.linalg.norm(qvec)
            if qnorm > 0:
                qvec = qvec / qnorm
            scores = data["matrix"] @ qvec
            top_indices = np.argsort(scores)[-top_k:][::-1]
            return [
                {
                    "id": data["ids"][i],
                    "url": data["urls"][i],
                    "title": data["titles"][i],
                    "content": data["contents"][i],
                    "score": float(scores[i]),
                }
                for i in top_indices
            ]
        else:
            scored = []
            for i, emb in enumerate(data["matrix"]):
                score = self._cosine_similarity(query_embedding, emb)
                scored.append((i, score))
            scored.sort(key=lambda x: x[1], reverse=True)
            return [
                {
                    "id": data["ids"][i],
                    "url": data["urls"][i],
                    "title": data["titles"][i],
                    "content": data["contents"][i],
                    "score": s,
                }
                for i, s in scored[:top_k]
            ]

    @staticmethod
    def _get_domain(url: str) -> str:
        try:
            from urllib.parse import urlparse
            return urlparse(url).netloc.lower().replace("www.", "")
        except Exception:
            return ""

    def _is_url_allowed(self, url: str, priority_domains: list = None, blocked_domains: list = None) -> bool:
        domain = self._get_domain(url)
        if not domain:
            return False
        if blocked_domains:
            for bd in blocked_domains:
                if bd in domain:
                    return False
        return True

    def _score_url(self, url: str, priority_domains: list = None) -> int:
        domain = self._get_domain(url)
        if priority_domains:
            for i, pd in enumerate(priority_domains):
                if pd in domain:
                    return 100 - i
        return 0

    def scrape_and_add(self, queries: list[str], num_results: int = 10,
                       priority_domains: list = None, blocked_domains: list = None) -> dict:
        from knowledge_scraper import search_web, download_page

        stats = {"searched": 0, "downloaded": 0, "skipped": 0, "errors": 0, "blocked": 0}
        seen_urls = set()
        candidates = []

        for query in queries:
            results = search_web(query, num_results)
            stats["searched"] += len(results)

            for r in results:
                url = r.get("href", "")
                if not url or url in seen_urls:
                    continue
                seen_urls.add(url)

                if not self._is_url_allowed(url, priority_domains, blocked_domains):
                    stats["blocked"] += 1
                    continue

                score = self._score_url(url, priority_domains)
                candidates.append((score, url, r.get("title", "")))

        candidates.sort(key=lambda x: x[0], reverse=True)

        for score, url, search_title in candidates:
            try:
                title, text = download_page(url)
                if len(text) < 200:
                    stats["skipped"] += 1
                    continue
                result = self.add_document(url, title, text)
                if result["status"] == "added":
                    stats["downloaded"] += 1
                else:
                    stats["skipped"] += 1
            except Exception:
                stats["errors"] += 1

        return stats

    def refresh(self) -> dict:
        conn = sqlite3.connect(self.db_path)
        sources = conn.execute("SELECT COUNT(*) FROM sources").fetchone()[0]
        chunks = conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
        conn.execute("DELETE FROM chunks")
        conn.execute("DELETE FROM sources")
        conn.commit()
        conn.close()
        if self.db_path in KnowledgeBase._embedding_cache:
            del KnowledgeBase._embedding_cache[self.db_path]
        return {"deleted_sources": sources, "deleted_chunks": chunks}

    def list_sources(self) -> list[dict]:
        conn = sqlite3.connect(self.db_path)
        rows = conn.execute(
            "SELECT id, url, title, total_chars, chunks_count, created_at FROM sources ORDER BY created_at DESC"
        ).fetchall()
        conn.close()
        return [
            {
                "id": r[0],
                "url": r[1],
                "title": r[2],
                "total_chars": r[3],
                "chunks_count": r[4],
                "created_at": r[5],
            }
            for r in rows
        ]

    def delete_source(self, source_id: int) -> dict:
        conn = sqlite3.connect(self.db_path)
        row = conn.execute("SELECT url, title FROM sources WHERE id = ?", (source_id,)).fetchone()
        if not row:
            conn.close()
            return {"status": "not_found"}
        url = row[0]
        deleted_chunks = conn.execute("SELECT COUNT(*) FROM chunks WHERE source_url = ?", (url,)).fetchone()[0]
        conn.execute("DELETE FROM chunks WHERE source_url = ?", (url,))
        conn.execute("DELETE FROM sources WHERE id = ?", (source_id,))
        conn.commit()
        conn.close()
        if self.db_path in KnowledgeBase._embedding_cache:
            del KnowledgeBase._embedding_cache[self.db_path]
        return {"status": "deleted", "url": url, "title": row[1], "deleted_chunks": deleted_chunks}

    def get_stats(self) -> dict:
        conn = sqlite3.connect(self.db_path)
        sources = conn.execute("SELECT COUNT(*) FROM sources").fetchone()[0]
        chunks = conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
        total_chars = conn.execute("SELECT COALESCE(SUM(char_count), 0) FROM chunks").fetchone()[0]
        conn.close()
        return {
            "name": self.name,
            "sources": sources,
            "chunks": chunks,
            "total_chars": total_chars,
            "db_path": self.db_path,
        }


def list_knowledge_bases() -> list[dict]:
    if not os.path.exists(BASES_DIR):
        return []
    result = []
    for name in os.listdir(BASES_DIR):
        db_path = os.path.join(BASES_DIR, name, "knowledge.db")
        if os.path.exists(db_path):
            kb = KnowledgeBase(name)
            result.append(kb.get_stats())
    return result
