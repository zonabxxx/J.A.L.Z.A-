"""
Email agent pre J.A.L.Z.A.
Sleduje mailbox, odpovedá na emaily cez lokálny model.
Podporuje IMAP (Gmail) aj Microsoft Graph API (Office 365).
"""

import os
import re
import json
import imaplib
import smtplib
import email
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.header import decode_header
import time
import logging
import requests
from datetime import datetime, timezone
from html.parser import HTMLParser
from typing import Union

logger = logging.getLogger("jalza.email")

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config.json")
OLLAMA_URL = "http://localhost:11434/api/chat"
MODEL = "jalza"
KNOWLEDGE_API = "http://localhost:8765"

# ── Load .env ─────────────────────────────────────────────────────────
_env_path = os.path.join(os.path.dirname(__file__), ".env")
if os.path.isfile(_env_path):
    with open(_env_path) as _ef:
        for _line in _ef:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _, _v = _line.partition("=")
                os.environ.setdefault(_k.strip(), _v.strip())


# ── HTML → plain text helper ──────────────────────────────────────────
class _HTMLStripper(HTMLParser):
    BLOCK_TAGS = {"br", "p", "div", "tr", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "hr"}

    def __init__(self):
        super().__init__()
        self._parts: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() in self.BLOCK_TAGS:
            self._parts.append("\n")

    def handle_endtag(self, tag):
        if tag.lower() in ("p", "div", "tr", "li", "blockquote"):
            self._parts.append("\n")

    def handle_data(self, data):
        self._parts.append(data)

    def get_text(self):
        text = "".join(self._parts)
        lines = [ln.strip() for ln in text.splitlines()]
        result = []
        blank = False
        for ln in lines:
            if not ln:
                if not blank:
                    result.append("")
                    blank = True
            else:
                result.append(ln)
                blank = False
        return "\n".join(result).strip()


def _html_to_text(html: str) -> str:
    s = _HTMLStripper()
    s.feed(html)
    return s.get_text()


# ══════════════════════════════════════════════════════════════════════
#  Microsoft Graph API client  (info@adsun.sk)
# ══════════════════════════════════════════════════════════════════════

class MicrosoftGraphEmail:
    """Client credentials flow – app-level access to any mailbox in the tenant."""

    TOKEN_URL = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
    GRAPH_URL = "https://graph.microsoft.com/v1.0"

    def __init__(self):
        self.tenant_id = os.environ.get("MS_TENANT_ID", "")
        self.client_id = os.environ.get("MS_CLIENT_ID", "")
        self.client_secret = os.environ.get("MS_CLIENT_SECRET", "")
        self.mailbox = os.environ.get("MS_MAILBOX", "info@adsun.sk")
        self._token = None
        self._token_expires = 0

    @property
    def configured(self) -> bool:
        return bool(self.tenant_id and self.client_id and self.client_secret)

    def _ensure_token(self):
        if self._token and time.time() < self._token_expires - 60:
            return
        r = requests.post(
            self.TOKEN_URL.format(tenant=self.tenant_id),
            data={
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "scope": "https://graph.microsoft.com/.default",
                "grant_type": "client_credentials",
            },
            timeout=15,
        )
        r.raise_for_status()
        data = r.json()
        self._token = data["access_token"]
        self._token_expires = time.time() + data.get("expires_in", 3600)

    def _headers(self) -> dict:
        self._ensure_token()
        return {"Authorization": f"Bearer {self._token}", "Content-Type": "application/json"}

    def _user_url(self, path: str = "") -> str:
        return f"{self.GRAPH_URL}/users/{self.mailbox}{path}"

    # ── Read ──────────────────────────────────────────────────────────

    def list_emails(self, limit=10, unseen_only=True, folder="inbox", today_only=False) -> list[dict]:
        params = {
            "$top": limit,
            "$orderby": "receivedDateTime desc",
            "$select": "id,subject,from,receivedDateTime,bodyPreview,body,isRead",
        }
        filters = []
        if unseen_only and not today_only:
            filters.append("isRead eq false")
        if today_only:
            today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")
            filters.append(f"receivedDateTime ge {today_start}")
        if filters:
            params["$filter"] = " and ".join(filters)

        r = requests.get(
            self._user_url(f"/mailFolders/{folder}/messages"),
            headers=self._headers(),
            params=params,
            timeout=30,
        )
        r.raise_for_status()
        messages = r.json().get("value", [])

        results = []
        for m in messages:
            sender_data = m.get("from", {}).get("emailAddress", {})
            body_content = m.get("body", {}).get("content", "")
            body_type = m.get("body", {}).get("contentType", "text")
            if body_type == "html":
                body_content = _html_to_text(body_content)

            results.append({
                "id": m["id"],
                "sender": sender_data.get("name", ""),
                "sender_email": sender_data.get("address", ""),
                "subject": m.get("subject", "(bez predmetu)"),
                "date": m.get("receivedDateTime", ""),
                "body": body_content[:500],
                "is_read": m.get("isRead", False),
            })
        return results

    def get_email(self, message_id: str) -> dict:
        r = requests.get(
            self._user_url(f"/messages/{message_id}"),
            headers=self._headers(),
            params={"$select": "id,subject,from,receivedDateTime,body,isRead,toRecipients,ccRecipients"},
            timeout=15,
        )
        r.raise_for_status()
        m = r.json()
        body_content = m.get("body", {}).get("content", "")
        if m.get("body", {}).get("contentType") == "html":
            body_content = _html_to_text(body_content)
        sender_data = m.get("from", {}).get("emailAddress", {})
        return {
            "id": m["id"],
            "sender": sender_data.get("name", ""),
            "sender_email": sender_data.get("address", ""),
            "subject": m.get("subject", ""),
            "date": m.get("receivedDateTime", ""),
            "body": body_content,
            "is_read": m.get("isRead", False),
        }

    def mark_as_read(self, message_id: str):
        requests.patch(
            self._user_url(f"/messages/{message_id}"),
            headers=self._headers(),
            json={"isRead": True},
            timeout=10,
        )

    # ── Send ──────────────────────────────────────────────────────────

    def send_email(self, to: str, subject: str, body: str, reply_to_id: str = None):
        payload = {
            "message": {
                "subject": subject,
                "body": {"contentType": "Text", "content": body},
                "toRecipients": [{"emailAddress": {"address": to}}],
            },
            "saveToSentItems": True,
        }
        r = requests.post(
            self._user_url("/sendMail"),
            headers=self._headers(),
            json=payload,
            timeout=30,
        )
        r.raise_for_status()
        logger.info(f"[Graph] Email odoslaný na {to}: {subject}")

    def reply_to_email(self, message_id: str, body: str):
        payload = {"comment": body}
        r = requests.post(
            self._user_url(f"/messages/{message_id}/reply"),
            headers=self._headers(),
            json=payload,
            timeout=30,
        )
        r.raise_for_status()
        logger.info(f"[Graph] Reply odoslaný na message {message_id[:20]}...")

    # ── Search ────────────────────────────────────────────────────────

    def search_emails(self, query: str, limit=10) -> list[dict]:
        params = {
            "$top": limit,
            "$search": f'"{query}"',
            "$select": "id,subject,from,receivedDateTime,bodyPreview,isRead",
        }
        r = requests.get(
            self._user_url("/messages"),
            headers=self._headers(),
            params=params,
            timeout=30,
        )
        r.raise_for_status()
        messages = r.json().get("value", [])
        results = []
        for m in messages:
            sender_data = m.get("from", {}).get("emailAddress", {})
            results.append({
                "id": m["id"],
                "sender": sender_data.get("name", ""),
                "sender_email": sender_data.get("address", ""),
                "subject": m.get("subject", ""),
                "date": m.get("receivedDateTime", ""),
                "body": m.get("bodyPreview", "")[:300],
                "is_read": m.get("isRead", False),
            })
        return results


# Global instances
_ms_graph = MicrosoftGraphEmail()
_ms_graph_juraj = MicrosoftGraphEmail()
_ms_graph_juraj.mailbox = os.environ.get("MS_MAILBOX_JURAJ", "juraj@adsun.sk")


def load_email_config() -> dict:
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        return cfg.get("email", {})
    except Exception:
        return {}


def decode_subject(subject):
    if not subject:
        return "(bez predmetu)"
    decoded = decode_header(subject)
    parts = []
    for text, charset in decoded:
        if isinstance(text, bytes):
            parts.append(text.decode(charset or "utf-8", errors="replace"))
        else:
            parts.append(text)
    return " ".join(parts)


def get_email_body(msg) -> str:
    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            if content_type == "text/plain":
                payload = part.get_payload(decode=True)
                charset = part.get_content_charset() or "utf-8"
                return payload.decode(charset, errors="replace")
    else:
        payload = msg.get_payload(decode=True)
        charset = msg.get_content_charset() or "utf-8"
        return payload.decode(charset, errors="replace")
    return ""


def detect_knowledge_agent(text: str) -> dict:
    try:
        r = requests.post(
            f"{KNOWLEDGE_API}/detect",
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


def get_knowledge_context(agent_key: str, question: str) -> dict:
    try:
        r = requests.post(
            f"{KNOWLEDGE_API}/context",
            json={"agent": agent_key, "question": question, "top_k": 3},
            timeout=30,
        )
        if r.ok:
            return r.json()
    except Exception:
        pass
    return {}


def generate_reply(subject: str, body: str, sender: str) -> str:
    question = f"{subject}\n\n{body}"

    kb_info = detect_knowledge_agent(question)
    if kb_info:
        ctx = get_knowledge_context(kb_info["agent"], question)
        if ctx and "context" in ctx:
            messages = [
                {"role": "system", "content": ctx.get("system_prompt", "")},
                {"role": "user", "content": f"{ctx['context']}\n\nOTÁZKA Z EMAILU od {sender}:\n{question}"},
            ]
            r = requests.post(OLLAMA_URL, json={"model": MODEL, "messages": messages, "stream": False}, timeout=300)
            if r.ok:
                return r.json().get("message", {}).get("content", "")

    messages = [
        {"role": "system", "content": (
            "Si J.A.L.Z.A., asistent rodiny Martinkových. Odpovedáš na email. "
            "Buď stručný, vecný a profesionálny. Odpovedaj po slovensky."
        )},
        {"role": "user", "content": f"Email od: {sender}\nPredmet: {subject}\n\n{body}"},
    ]
    r = requests.post(OLLAMA_URL, json={"model": MODEL, "messages": messages, "stream": False}, timeout=300)
    if r.ok:
        return r.json().get("message", {}).get("content", "")
    return "Prepáč, nepodarilo sa mi vygenerovať odpoveď."


def send_reply(smtp_cfg: dict, to_addr: str, subject: str, body: str):
    msg = MIMEMultipart()
    msg["From"] = smtp_cfg["username"]
    msg["To"] = to_addr
    msg["Subject"] = f"Re: {subject}" if not subject.startswith("Re:") else subject

    signature = "\n\n---\nOdoslané cez J.A.L.Z.A. (lokálny AI asistent)"
    msg.attach(MIMEText(body + signature, "plain", "utf-8"))

    with smtplib.SMTP_SSL(smtp_cfg["server"], smtp_cfg.get("port", 465)) as server:
        server.login(smtp_cfg["username"], smtp_cfg["password"])
        server.send_message(msg)
    logger.info(f"Email odoslaný: {to_addr}")


def list_emails(limit=10, unseen_only=True, today_only=False):
    """Rýchle listovanie emailov BEZ generovania LLM odpovedí."""
    cfg = load_email_config()
    if not cfg:
        return {"error": "Email nie je nakonfigurovaný. Nastav IMAP v config.json."}

    imap_cfg = cfg.get("imap", {})
    results = []

    try:
        mail = imaplib.IMAP4_SSL(imap_cfg["server"], imap_cfg.get("port", 993))
        mail.login(imap_cfg["username"], imap_cfg["password"])
        mail.select("INBOX", readonly=True)

        if today_only:
            date_str = datetime.now().strftime("%d-%b-%Y")
            criteria = f'(SINCE {date_str})'
        elif unseen_only:
            criteria = "UNSEEN"
        else:
            criteria = "ALL"

        _, msg_nums = mail.search(None, criteria)
        if not msg_nums[0]:
            mail.logout()
            return results

        nums = msg_nums[0].split()
        nums = nums[-limit:]

        for num in reversed(nums):
            try:
                _, data = mail.fetch(num, "(RFC822)")
                raw = data[0][1]
                msg = email.message_from_bytes(raw)

                sender_name, sender_addr = email.utils.parseaddr(msg["From"])
                subject = decode_subject(msg["Subject"])
                body = get_email_body(msg) or ""
                date_str = msg.get("Date", "")

                results.append({
                    "sender": sender_name or sender_addr,
                    "sender_email": sender_addr,
                    "subject": subject,
                    "date": date_str,
                    "body": body[:300],
                })
            except Exception:
                continue

        mail.logout()
    except Exception as e:
        return {"error": str(e)}

    return results


def check_and_reply(dry_run=False):
    cfg = load_email_config()
    if not cfg:
        logger.error("Email nie je nakonfigurovaný.")
        return []

    imap_cfg = cfg.get("imap", {})
    smtp_cfg = cfg.get("smtp", {})
    allowed_senders = cfg.get("allowed_senders", [])
    auto_reply = cfg.get("auto_reply", False)

    results = []

    mail = imaplib.IMAP4_SSL(imap_cfg["server"], imap_cfg.get("port", 993))
    mail.login(imap_cfg["username"], imap_cfg["password"])
    mail.select("INBOX")

    _, msg_nums = mail.search(None, "UNSEEN")
    if not msg_nums[0]:
        mail.logout()
        return results

    for num in msg_nums[0].split():
        _, data = mail.fetch(num, "(RFC822)")
        raw = data[0][1]
        msg = email.message_from_bytes(raw)

        sender = email.utils.parseaddr(msg["From"])[1]
        subject = decode_subject(msg["Subject"])
        body = get_email_body(msg)

        if allowed_senders and sender not in allowed_senders:
            results.append({"sender": sender, "subject": subject, "action": "skipped (not allowed)"})
            continue

        reply_text = generate_reply(subject, body, sender)

        result = {
            "sender": sender,
            "subject": subject,
            "body_preview": body[:200],
            "reply_preview": reply_text[:200],
        }

        if auto_reply and not dry_run:
            try:
                send_reply(smtp_cfg, sender, subject, reply_text)
                result["action"] = "replied"
            except Exception as e:
                result["action"] = f"error: {str(e)[:100]}"
        else:
            result["action"] = "draft (auto_reply off)"

        results.append(result)

    mail.logout()
    return results


MARKETING_KEYWORDS = [
    "unsubscribe", "odhlásiť", "odhlásit", "newsletter", "promo",
    "marketing", "no-reply", "noreply", "notification@",
    "news@", "info@", "mailer-daemon", "digest",
    "sale", "discount", "zľava", "akcia", "výpredaj",
    "special offer", "limited time", "click here",
]

MARKETING_DOMAINS = [
    "mailchimp.com", "sendgrid.net", "amazonses.com", "mailgun.org",
    "constantcontact.com", "hubspot.com", "klaviyo.com",
    "shopify.com", "aliexpress.com", "wish.com", "temu.com",
    "linkedin.com", "facebookmail.com", "twitter.com",
]


def _is_marketing(msg) -> bool:
    sender = (msg.get("From", "") or "").lower()
    subject = (decode_subject(msg.get("Subject", "")) or "").lower()
    list_unsub = msg.get("List-Unsubscribe", "")

    if list_unsub:
        return True
    for kw in MARKETING_KEYWORDS:
        if kw in sender or kw in subject:
            return True
    for domain in MARKETING_DOMAINS:
        if domain in sender:
            return True
    return False


def cleanup_emails(delete_marketing=True, delete_older_than_days=365, dry_run=True) -> dict:
    cfg = load_email_config()
    if not cfg:
        return {"error": "Email nie je nakonfigurovaný"}

    imap_cfg = cfg.get("imap", {})
    mail = imaplib.IMAP4_SSL(imap_cfg["server"], imap_cfg.get("port", 993))
    mail.login(imap_cfg["username"], imap_cfg["password"])
    mail.select("INBOX")

    stats = {"marketing_found": 0, "old_found": 0, "deleted": 0, "dry_run": dry_run}
    marketing_nums = set()

    if delete_marketing:
        # Server-side: emails with List-Unsubscribe header (fast)
        try:
            _, nums = mail.search(None, 'HEADER List-Unsubscribe ""')
            if nums[0]:
                for n in nums[0].split():
                    marketing_nums.add(n)
        except Exception:
            pass

        for domain in MARKETING_DOMAINS:
            try:
                _, nums = mail.search(None, f'FROM "{domain}"')
                if nums[0]:
                    for n in nums[0].split():
                        marketing_nums.add(n)
            except Exception:
                continue

        for kw in ["noreply", "no-reply", "newsletter", "promo", "marketing"]:
            try:
                _, nums = mail.search(None, f'FROM "{kw}"')
                if nums[0]:
                    for n in nums[0].split():
                        marketing_nums.add(n)
            except Exception:
                continue

        stats["marketing_found"] = len(marketing_nums)

        if not dry_run and marketing_nums:
            nums_list = sorted(marketing_nums, key=lambda x: int(x))
            for i in range(0, len(nums_list), 100):
                batch = nums_list[i:i+100]
                msg_set = b",".join(batch)
                try:
                    mail.store(msg_set, "+FLAGS", "\\Deleted")
                    stats["deleted"] += len(batch)
                except Exception:
                    for num in batch:
                        try:
                            mail.store(num, "+FLAGS", "\\Deleted")
                            stats["deleted"] += 1
                        except Exception:
                            continue

    if delete_older_than_days > 0:
        from datetime import timedelta
        cutoff = datetime.now() - timedelta(days=delete_older_than_days)
        date_str = cutoff.strftime("%d-%b-%Y")
        _, old_nums = mail.search(None, f'BEFORE {date_str}')
        if old_nums[0]:
            old_list = old_nums[0].split()
            already_marketing = marketing_nums if delete_marketing else set()
            unique_old = [n for n in old_list if n not in already_marketing]
            stats["old_found"] = len(unique_old)
            if not dry_run:
                for i in range(0, len(unique_old), 100):
                    batch = unique_old[i:i+100]
                    msg_set = b",".join(batch)
                    try:
                        mail.store(msg_set, "+FLAGS", "\\Deleted")
                        stats["deleted"] += len(batch)
                    except Exception:
                        for num in batch:
                            try:
                                mail.store(num, "+FLAGS", "\\Deleted")
                                stats["deleted"] += 1
                            except Exception:
                                continue

    if not dry_run and stats["deleted"] > 0:
        mail.expunge()

    mail.logout()
    return stats


# ══════════════════════════════════════════════════════════════════════
#  Microsoft Graph wrappers (info@adsun.sk)
# ══════════════════════════════════════════════════════════════════════

def list_adsun_emails(limit=10, unseen_only=True, today_only=False) -> Union[list, dict]:
    if not _ms_graph.configured:
        return {"error": "Microsoft Graph nie je nakonfigurovaný. Skontroluj MS_* premenné v .env."}
    try:
        return _ms_graph.list_emails(limit=limit, unseen_only=unseen_only, today_only=today_only)
    except Exception as e:
        return {"error": f"Graph API chyba: {str(e)[:200]}"}


def read_adsun_email(message_id: str) -> dict:
    if not _ms_graph.configured:
        return {"error": "Microsoft Graph nie je nakonfigurovaný."}
    try:
        return _ms_graph.get_email(message_id)
    except Exception as e:
        return {"error": str(e)[:200]}


def search_adsun_emails(query: str, limit=10) -> Union[list, dict]:
    if not _ms_graph.configured:
        return {"error": "Microsoft Graph nie je nakonfigurovaný."}
    try:
        return _ms_graph.search_emails(query, limit)
    except Exception as e:
        return {"error": str(e)[:200]}


def reply_adsun_email(message_id: str, body: str) -> dict:
    if not _ms_graph.configured:
        return {"error": "Microsoft Graph nie je nakonfigurovaný."}
    try:
        _ms_graph.reply_to_email(message_id, body)
        return {"status": "sent"}
    except Exception as e:
        return {"error": str(e)[:200]}


def send_adsun_email(to: str, subject: str, body: str) -> dict:
    if not _ms_graph.configured:
        return {"error": "Microsoft Graph nie je nakonfigurovaný."}
    try:
        _ms_graph.send_email(to, subject, body)
        return {"status": "sent"}
    except Exception as e:
        return {"error": str(e)[:200]}


def check_adsun_and_reply(dry_run=True) -> list:
    """Skontroluje neprečítané emaily v info@adsun.sk a vygeneruje odpovede."""
    if not _ms_graph.configured:
        return [{"error": "Microsoft Graph nie je nakonfigurovaný."}]

    cfg = load_email_config()
    auto_reply = cfg.get("adsun", {}).get("auto_reply", False)
    allowed_senders = cfg.get("adsun", {}).get("allowed_senders", [])

    results = []
    try:
        emails = _ms_graph.list_emails(limit=20, unseen_only=True)
    except Exception as e:
        return [{"error": str(e)[:200]}]

    for em in emails:
        sender = em["sender_email"]
        subject = em["subject"]
        body = em["body"]

        if allowed_senders and sender not in allowed_senders:
            results.append({"sender": sender, "subject": subject, "action": "skipped (not allowed)"})
            continue

        reply_text = generate_reply(subject, body, sender)
        result = {
            "sender": sender,
            "subject": subject,
            "body_preview": body[:200],
            "reply_preview": reply_text[:200],
        }

        if auto_reply and not dry_run:
            try:
                _ms_graph.reply_to_email(em["id"], reply_text + "\n\n---\nOdoslané cez J.A.L.Z.A.")
                _ms_graph.mark_as_read(em["id"])
                result["action"] = "replied"
            except Exception as e:
                result["action"] = f"error: {str(e)[:100]}"
        else:
            result["action"] = "draft (auto_reply off)"

        results.append(result)
    return results


# ══════════════════════════════════════════════════════════════════════
#  juraj@adsun.sk wrappers
# ══════════════════════════════════════════════════════════════════════

def list_juraj_emails(limit=10, unseen_only=True, today_only=False) -> Union[list, dict]:
    if not _ms_graph_juraj.configured:
        return {"error": "Microsoft Graph nie je nakonfigurovaný pre juraj@adsun.sk."}
    try:
        return _ms_graph_juraj.list_emails(limit=limit, unseen_only=unseen_only, today_only=today_only)
    except Exception as e:
        return {"error": f"Graph API chyba: {str(e)[:200]}"}


def read_juraj_email(message_id: str) -> dict:
    if not _ms_graph_juraj.configured:
        return {"error": "Microsoft Graph nie je nakonfigurovaný."}
    try:
        return _ms_graph_juraj.get_email(message_id)
    except Exception as e:
        return {"error": str(e)[:200]}


def search_juraj_emails(query: str, limit=10) -> Union[list, dict]:
    if not _ms_graph_juraj.configured:
        return {"error": "Microsoft Graph nie je nakonfigurovaný."}
    try:
        return _ms_graph_juraj.search_emails(query, limit)
    except Exception as e:
        return {"error": str(e)[:200]}


def send_juraj_email(to: str, subject: str, body: str) -> dict:
    if not _ms_graph_juraj.configured:
        return {"error": "Microsoft Graph nie je nakonfigurovaný."}
    try:
        _ms_graph_juraj.send_email(to, subject, body)
        return {"status": "sent"}
    except Exception as e:
        return {"error": str(e)[:200]}


def reply_juraj_email(message_id: str, body: str) -> dict:
    if not _ms_graph_juraj.configured:
        return {"error": "Microsoft Graph nie je nakonfigurovaný."}
    try:
        _ms_graph_juraj.reply_to_email(message_id, body)
        return {"status": "sent"}
    except Exception as e:
        return {"error": str(e)[:200]}


if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO)

    mode = sys.argv[1] if len(sys.argv) > 1 else "gmail"

    if mode == "adsun":
        print("=== ADsun emails (info@adsun.sk) ===\n")
        if not _ms_graph.configured:
            print("CHYBA: MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET nie sú v .env")
            sys.exit(1)

        action = sys.argv[2] if len(sys.argv) > 2 else "list"

        if action == "list":
            unseen = "--all" not in sys.argv
            emails = list_adsun_emails(limit=10, unseen_only=unseen)
            if isinstance(emails, dict) and "error" in emails:
                print(f"Chyba: {emails['error']}")
            else:
                print(f"Nájdených: {len(emails)} emailov\n")
                for em in emails:
                    status = "📩" if not em.get("is_read") else "📬"
                    print(f"{status} {em['date'][:16]}  Od: {em['sender']} <{em['sender_email']}>")
                    print(f"   Predmet: {em['subject']}")
                    print(f"   {em['body'][:120]}...\n")

        elif action == "search":
            query = " ".join(sys.argv[3:])
            if not query:
                print("Použi: python email_agent.py adsun search <hľadaný výraz>")
                sys.exit(1)
            results = search_adsun_emails(query)
            if isinstance(results, dict) and "error" in results:
                print(f"Chyba: {results['error']}")
            else:
                print(f"Výsledky pre '{query}': {len(results)}\n")
                for em in results:
                    print(f"  {em['date'][:16]}  {em['sender_email']}  {em['subject']}")

        elif action == "check":
            results = check_adsun_and_reply(dry_run="--send" not in sys.argv)
            for r in results:
                print(f"\nOd: {r.get('sender', '?')}")
                print(f"Predmet: {r.get('subject', '?')}")
                print(f"Akcia: {r.get('action', '?')}")
                if "reply_preview" in r:
                    print(f"Odpoveď: {r['reply_preview']}")
        else:
            print(f"Neznáma akcia: {action}")
            print("Dostupné: list, search <výraz>, check [--send]")

    elif mode == "juraj":
        print("=== Juraj emails (juraj@adsun.sk) ===\n")
        if not _ms_graph_juraj.configured:
            print("CHYBA: MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET nie sú v .env")
            sys.exit(1)

        action = sys.argv[2] if len(sys.argv) > 2 else "list"

        if action == "list":
            unseen = "--all" not in sys.argv
            emails = list_juraj_emails(limit=10, unseen_only=unseen)
            if isinstance(emails, dict) and "error" in emails:
                print(f"Chyba: {emails['error']}")
            else:
                print(f"Nájdených: {len(emails)} emailov\n")
                for em in emails:
                    status = "📩" if not em.get("is_read") else "📬"
                    print(f"{status} {em['date'][:16]}  Od: {em['sender']} <{em['sender_email']}>")
                    print(f"   Predmet: {em['subject']}")
                    print(f"   {em['body'][:120]}...\n")

        elif action == "search":
            query = " ".join(sys.argv[3:])
            if not query:
                print("Použi: python email_agent.py juraj search <hľadaný výraz>")
                sys.exit(1)
            results = search_juraj_emails(query)
            if isinstance(results, dict) and "error" in results:
                print(f"Chyba: {results['error']}")
            else:
                print(f"Výsledky pre '{query}': {len(results)}\n")
                for em in results:
                    print(f"  {em['date'][:16]}  {em['sender_email']}  {em['subject']}")
        else:
            print(f"Neznáma akcia: {action}")
            print("Dostupné: list, search <výraz>")

    else:
        results = check_and_reply(dry_run=True)
        for r in results:
            print(f"\nOd: {r['sender']}")
            print(f"Predmet: {r['subject']}")
            print(f"Akcia: {r['action']}")
            if "reply_preview" in r:
                print(f"Odpoveď: {r['reply_preview']}")
