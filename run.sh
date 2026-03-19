#!/bin/bash
# J.A.L.Z.A. — Start all services (local mode, no tunnel)
export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
JALZA_DIR="/Users/jurajmartinkovych/Documents/workspaceAI/jalza"
cd "$JALZA_DIR"

echo "=== J.A.L.Z.A. starting at $(date) ==="

# 1) Ollama (optimalizované: q8_0 KV cache, flash attention, model v pamäti navždy)
if ! curl -sf --max-time 2 http://localhost:11434/api/tags > /dev/null 2>&1; then
  echo "Starting Ollama (keep_alive=forever, q8_0 KV cache, flash attention)..."
  OLLAMA_KEEP_ALIVE=-1 \
  OLLAMA_KV_CACHE_TYPE=q8_0 \
  OLLAMA_FLASH_ATTENTION=1 \
  OLLAMA_NUM_PARALLEL=2 \
  ollama serve > /dev/null 2>&1 &
  sleep 3
fi

# 2) Knowledge API
if ! lsof -ti:8765 > /dev/null 2>&1; then
  echo "Starting knowledge_api.py..."
  python3-local knowledge_api.py >> "$JALZA_DIR/knowledge_api.log" 2>&1 &
  sleep 2
fi

# 3) Next.js
if ! lsof -ti:3001 > /dev/null 2>&1; then
  echo "Starting Next.js..."
  cd "$JALZA_DIR/ui" && npm run dev >> "$JALZA_DIR/nextjs.log" 2>&1 &
  cd "$JALZA_DIR"
  sleep 3
fi

# 4) Telegram bot
pkill -f "python3.*bot.py" 2>/dev/null
sleep 1
python3-local bot.py >> "$JALZA_DIR/bot.log" 2>&1 &

echo "=== All services started ==="
echo "Ollama:      http://localhost:11434"
echo "API:         http://localhost:8765"
echo "UI:          http://localhost:3001"
echo "UI (sieť):  http://192.168.1.62:3001"
 