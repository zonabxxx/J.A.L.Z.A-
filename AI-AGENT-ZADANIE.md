# J.A.L.Z.A. — Juraj Adam Livinka Zuzka Assistant

## Hardware
- **Mac Studio M3 Ultra** – 96 GB RAM, 28-jadrový CPU, 60-jadrová GPU, 1TB SSD
- Memory bandwidth: ~800 GB/s

---

## 1. Lokálny LLM (Ollama)

### Modely:
| Model | Účel | Veľkosť | Stav |
|-------|------|---------|------|
| `deepseek-r1:70b` | Reasoning, analýza, kód — premýšľa krok po kroku | ~42 GB | ✅ Stiahnutý |
| `llama4:scout` | Multimodal (text + obrázky), dlhé dokumenty, 10M context | ~67 GB | ⏳ Sťahuje sa |
| `nomic-embed-text` | Embeddingy pre RAG pamäť | ~0.3 GB | ✅ Stiahnutý |

### Poznámky k modelom:
- **DeepSeek R1 70B** — najlepší open-source reasoning model, ukazuje celý thought process (chain-of-thought), 79.8% na math olympiáde
- **Llama 4 Scout** — MoE 109B/17B active, rozumie obrázkom, 10M token context window
- Modely sa načítavajú do RAM len keď sa používajú, nie všetky naraz
- Všetko beží 100% lokálne, žiadne dáta neodchádzajú z počítača

### Požiadavky:
- Beží 24/7 na pozadí
- API na `localhost:11434`
- Žiadne tokeny, žiadne poplatky

---

## 2. Telegram Bot (Osobný asistent)

### Funkcie:
- Chat cez Telegram s lokálnym modelom
- **Dlhodobá pamäť** – SQLite databáza na históriu konverzácií
- **Fakty o používateľovi** – ukladanie a pripomínanie osobných faktov
- **Web search** – DuckDuckGo vyhľadávanie keď model niečo nevie
- **Sumarizácia** – zhrnutie výsledkov z webu

### Príkazy:
| Príkaz | Funkcia |
|--------|---------|
| `/start` | Štart konverzácie |
| `/reset` | Vymazanie konverzácie |
| `/facts` | Zobraz čo si o mne pamätáš |
| `/remember [text]` | Zapamätaj si fakt o mne |
| `/search [text]` | Hľadaj na webe a zhrň výsledky |

### Technológie:
- Python + `python-telegram-bot`
- `ollama` Python knižnica
- `duckduckgo-search` pre web
- SQLite pre pamäť (conversations + facts tabuľky)

---

## 3. Coding Agent (Aider)

### Funkcie:
- Číta kód z projektu
- Programuje podľa zadania
- Auto-commit zmien
- Používa lokálny model (žiadne tokeny)

### Konfigurácia (.aider.conf.yml):
```yaml
model: ollama/deepseek-r1:70b
auto-commits: true
edit-format: diff
```

### Konvencie projektu (CONVENTIONS.md):
- Next.js 14, TypeScript, Drizzle ORM, SQLite/Turso, TailwindCSS
- Komponenty v kebab-case
- React Server Components prioritne
- API Routes pre DB volania
- EAV model pre dynamické dáta
- Port 3000
- PP prefix pre projekty, CC prefix pre kalkulácie
- Slovenský jazyk

---

## 4. Open WebUI (Lokálny ChatGPT)

### Funkcie:
- Web rozhranie na `localhost:3001`
- Chat s lokálnymi modelmi
- História konverzácií
- RAG – nahrávanie dokumentov
- Web search integrácia

### Inštalácia:
- Docker kontajner
- `ghcr.io/open-webui/open-webui:main`

---

## 5. RAG Pamäť (Notebook LM o mne)

### Čo si pamätá:
- **Osobné fakty** – nie svetový kontext, iba o mne
- **Záujmy a preferencie**
- **Analýzy z webu** – sumarizované výsledky vyhľadávaní
- **Projektové kontexty** – pravidlá, konvencie, architektúra

### Technológie:
- SQLite databáza pre fakty a konverzácie
- Vector databáza (Chroma) pre dokumenty a embeddingy
- `nomic-embed-text` model pre embeddingy

---

## 6. Business Agent (Napojenie na aplikáciu)

### Funkcie:
- Ovládanie firemnej aplikácie cez API
- Získavanie objednávok, klientov, faktúr
- Vytváranie objednávok
- Posielanie emailov

### API Tools pre LLM:
| Tool | Endpoint | Metóda |
|------|----------|--------|
| `get_orders` | `/api/orders` | GET |
| `create_order` | `/api/orders` | POST |
| `get_clients` | `/api/clients` | GET |
| `get_invoices` | `/api/invoices` | GET |
| `send_email` | `/api/send-email` | POST |

### Bezpečnosť:
- API key autorizácia (`x-api-key` header)
- Middleware ochrana v Next.js
- Agent musí potvrdiť pred vytvorením/zmazaním

---

## 7. Web Agent (Automatizácia webu)

### Funkcie:
- Prehliadanie webstránok cez Playwright
- Objednávanie na weboch (s potvrdením)
- Monitoring cien a zmien
- Pravidelné notifikácie (správa za týždeň)

### Prístup:
- HTML/DOM parsing pre štruktúrované stránky
- Vision AI (screenshot analýza) pre komplexné stránky — Llama 4 Scout
- Agent loop: Observe → Think → Act → Done

### Bezpečnosť:
- Samostatný macOS účet alebo Docker kontajner
- Žiadny prístup k osobným účtom (Apple ID, GitHub, Google)
- Potvrdenie pred platbami a citlivými akciami

---

## 8. Fine-tuning (Učenie sa z môjho kódu)

### Proces:
1. Export commit histórie z Git
2. Formátovanie ako trénovacie dáta (JSONL)
3. Fine-tuning cez LoRA adapter
4. Vytvorenie custom modelu v Ollama

### Simultánny prístup:
- Programujem v Cursor + Claude
- Aider na pozadí sa učí z commitov
- Model sa postupne zlepšuje v mojom coding štýle

---

## 9. Agenty (3 súčasne)

| Agent | Účel | Model |
|-------|------|-------|
| **Telegram Bot** | Osobný asistent, chat, web search | deepseek-r1:70b |
| **Coding Agent** | Programovanie, Aider | deepseek-r1:70b |
| **Business Agent** | Firemná aplikácia, automatizácia | deepseek-r1:70b |
| **Web Agent** | Vision, analýza obrázkov | llama4:scout |

Modely sa načítavajú podľa potreby — 96 GB RAM stačí na 1 veľký model + agenty.

---

## Inštalačné poradie

1. ✅ Mac Studio M3 Ultra (kúpené)
2. ✅ Ollama v0.17.5 (nainštalovaná)
3. ✅ DeepSeek R1 70B (stiahnutý — 42 GB)
4. ✅ nomic-embed-text (stiahnutý — 274 MB)
5. ⏳ Llama 4 Scout (sťahuje sa — ~67 GB)
6. ⬜ Test modelov v termináli
7. ⬜ Open WebUI (Docker)
8. ⬜ Telegram bot s pamäťou
9. ⬜ Aider coding agent
10. ⬜ Business agent s API tools
11. ⬜ Web agent (Playwright)
12. ⬜ Fine-tuning z commitov
13. ⬜ RAG pamäť (osobný kontext)

---

## Požiadavky

- ✅ Úplne zadarmo (iba hardware)
- ✅ Bez tokenov a poplatkov
- ✅ Lokálne, offline schopné
- ✅ 100% bezpečné — žiadne dáta neopúšťajú počítač
- ✅ Osobná pamäť (nie svetový kontext)
- ✅ Web search keď niečo nevie
- ✅ Slovenský jazyk
- ✅ Bezpečné – izolované od osobných účtov
