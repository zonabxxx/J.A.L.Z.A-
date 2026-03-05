"""
Skript na naplnenie znalostnej bázy ADsun dopytmi z email analýzy.
Spustenie: python3 populate_adsun_kb.py
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from knowledge_base import KnowledgeBase

ANALYSIS_FILE = os.path.join(
    os.path.dirname(__file__),
    "..", "business-flow-ai", "web-inquiries-analysis.json",
)

KB_NAME = "ADsun — Dopyty a zákazníci"
KB_DESCRIPTION = "Analýza dopytov z webu adsun.sk, zákazníci, trendy, kategórie služieb"


def load_analysis() -> dict:
    with open(ANALYSIS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def build_documents(data: dict) -> list[tuple[str, str, str]]:
    """Returns list of (url, title, text) tuples for KnowledgeBase.add_document."""
    docs = []

    # 1. Company overview
    docs.append((
        "adsun://overview",
        "ADsun s.r.o. — Prehľad spoločnosti",
        """ADsun s.r.o. (adsun.sk) je slovenská reklamná spoločnosť so sídlom v Pezinku (Bratislavská 90, 902 01).
Obchodné meno: AD Sun, s.r.o.
Web: adsun.sk, wrapboys.sk
Email: info@adsun.sk

Hlavné služby:
- Polepy vozidiel (car wrapping) — najväčší podiel dopytov (~59%)
- Svetelná reklama (LED nápisy, svetelné boxy, neónové reklamy) — ~27%
- Tlačové služby (veľkoformátová tlač, bannery, plachty) — ~5%
- Špeciálne projekty (eventové inštalácie, interiérové fólie)
- Grafický dizajn

Kľúčoví ľudia:
- Jozef Tomášek (Chief Sales Officer) — tomasek@adsun.sk, +421 903 222 751
- Branislav Stojkov — stojkov@adsun.at (AT pobočka)

WordPress kontaktný formulár na adsun.sk posiela dopyty cez adsun@bentobox.sk s predmetom "Nová správa od ADsun".
""",
    ))

    # 2. Category breakdown
    categories = data.get("categories", {})
    cat_text = f"Celkový počet dopytov: {data['total']}\n\n"
    cat_text += "Rozdelenie podľa kategórií:\n"
    total = data["total"]
    for cat, count in sorted(categories.items(), key=lambda x: x[1], reverse=True):
        pct = (count / total * 100) if total > 0 else 0
        cat_text += f"- {cat}: {count} dopytov ({pct:.1f}%)\n"
    cat_text += f"\nNajžiadanejšia služba: Polepy vozidiel ({categories.get('Polepy vozidiel', 0)} dopytov)\n"
    cat_text += f"Druhá najžiadanejšia: Svetelná reklama ({categories.get('Sve', 0)} dopytov)\n"

    docs.append((
        "adsun://categories",
        "ADsun — Kategórie dopytov a služby",
        cat_text,
    ))

    # 3. Monthly trends
    monthly = data.get("monthly", {})
    trend_text = "Mesačný trend dopytov (z WordPress formulára adsun.sk):\n\n"
    for month, count in sorted(monthly.items()):
        trend_text += f"- {month}: {count} dopytov\n"
    if len(monthly) >= 2:
        months_sorted = sorted(monthly.items())
        first_val = months_sorted[0][1]
        last_val = months_sorted[-1][1]
        if first_val > 0:
            growth = ((last_val - first_val) / first_val) * 100
            trend_text += f"\nRast od {months_sorted[0][0]} do {months_sorted[-1][0]}: {growth:+.0f}%\n"
    trend_text += "\nTrend: Počet dopytov rastie, najsilnejšie mesiace sú január a február.\n"

    docs.append((
        "adsun://monthly-trends",
        "ADsun — Mesačné trendy dopytov",
        trend_text,
    ))

    # 4. Inquiries by category (batched)
    by_category = {}
    for inq in data.get("inquiries", []):
        cat = inq.get("category", "N/A")
        by_category.setdefault(cat, []).append(inq)

    for cat, inquiries in by_category.items():
        safe_cat = cat.replace(" ", "_").replace("/", "_")
        text = f"Dopyty v kategórii: {cat}\nPočet: {len(inquiries)}\n\n"
        for i, inq in enumerate(inquiries, 1):
            text += f"--- Dopyt {i} ({inq['date']}) ---\n"
            if inq.get("name") and inq["name"] != "N/A":
                text += f"Meno: {inq['name']}\n"
            if inq.get("email") and inq["email"] != "N/A":
                text += f"Email: {inq['email']}\n"
            if inq.get("phone"):
                text += f"Telefón: {inq['phone']}\n"
            msg = inq.get("message", "")[:300]
            if msg:
                text += f"Správa: {msg}\n"
            text += "\n"

        docs.append((
            f"adsun://inquiries/{safe_cat}",
            f"ADsun — Dopyty: {cat}",
            text,
        ))

    # 5. Customer analysis
    emails_list = [
        inq["email"] for inq in data.get("inquiries", [])
        if inq.get("email") and inq["email"] != "N/A"
    ]
    domains = {}
    for em in emails_list:
        domain = em.split("@")[-1] if "@" in em else "unknown"
        domains[domain] = domains.get(domain, 0) + 1

    cust_text = f"Analýza zákazníkov z dopytov:\n\n"
    cust_text += f"Celkom dopytov s emailom: {len(emails_list)}\n\n"
    cust_text += "Top emailové domény:\n"
    for domain, count in sorted(domains.items(), key=lambda x: x[1], reverse=True)[:15]:
        cust_text += f"- {domain}: {count}x\n"
    cust_text += "\nB2B vs B2C:\n"
    b2c_domains = {"gmail.com", "outlook.com", "yahoo.com", "hotmail.com", "icloud.com", "zoznam.sk", "azet.sk", "centrum.sk"}
    b2c = sum(1 for em in emails_list if em.split("@")[-1] in b2c_domains)
    b2b = len(emails_list) - b2c
    cust_text += f"- B2C (osobné emaily): {b2c} ({b2c/len(emails_list)*100:.0f}%)\n" if emails_list else ""
    cust_text += f"- B2B (firemné emaily): {b2b} ({b2b/len(emails_list)*100:.0f}%)\n" if emails_list else ""
    int_count = sum(1 for em in emails_list if not em.endswith(".sk") and not em.endswith(".cz"))
    if int_count:
        cust_text += f"- Medzinárodní: {int_count} ({int_count/len(emails_list)*100:.0f}%)\n"

    docs.append((
        "adsun://customers",
        "ADsun — Analýza zákazníkov",
        cust_text,
    ))

    return docs


def main():
    print(f"Načítavam analýzu z {ANALYSIS_FILE}...")
    data = load_analysis()
    print(f"Celkom dopytov: {data['total']}")

    kb = KnowledgeBase(KB_NAME, KB_DESCRIPTION)
    print(f"Knowledge base: {kb.db_path}")

    docs = build_documents(data)
    print(f"Pripravených {len(docs)} dokumentov na vloženie\n")

    for url, title, text in docs:
        print(f"  Vkladám: {title} ({len(text)} znakov)...", end=" ", flush=True)
        result = kb.add_document(url, title, text)
        print(f"→ {result['status']}" + (f" ({result.get('chunks', 0)} chunks)" if result["status"] == "added" else ""))

    stats = kb.get_stats()
    print(f"\n✅ Hotovo!")
    print(f"   Zdroje: {stats['sources']}")
    print(f"   Časti (chunks): {stats['chunks']}")
    print(f"   Znakov: {stats['total_chars']:,}")
    print(f"   DB: {stats['db_path']}")


if __name__ == "__main__":
    main()
