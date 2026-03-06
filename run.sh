#!/bin/bash
# J.A.L.Z.A. — Start all services
export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
JALZA_DIR="/Users/jurajmartinkovych/Documents/workspaceAI/jalza"
cd "$JALZA_DIR"

echo "=== J.A.L.Z.A. starting at $(date) ==="

# 1) Ollama
if ! curl -sf --max-time 2 http://localhost:11434/api/tags > /dev/null 2>&1; then
  echo "Starting Ollama..."
  ollama serve > /dev/null 2>&1 &
  sleep 3
fi

# 2) Knowledge API
if ! lsof -ti:8765 > /dev/null 2>&1; then
  echo "Starting knowledge_api.py..."
  python3 knowledge_api.py >> "$JALZA_DIR/knowledge_api.log" 2>&1 &
  sleep 2
fi

# 3) Next.js
if ! lsof -ti:3001 > /dev/null 2>&1; then
  echo "Starting Next.js..."
  cd "$JALZA_DIR/ui" && npm run dev >> "$JALZA_DIR/nextjs.log" 2>&1 &
  cd "$JALZA_DIR"
  sleep 3
fi

# 4) Cloudflare Tunnel
if ! pgrep -f cloudflared > /dev/null 2>&1; then
  echo "Starting Cloudflare Tunnel..."
  "$HOME/bin/cloudflared" tunnel --url http://localhost:8765 >> "$JALZA_DIR/tunnel.log" 2>&1 &
  sleep 8
  TUNNEL_URL=$(grep -o 'https://[a-z0-9\-]*\.trycloudflare\.com' "$JALZA_DIR/tunnel.log" | tail -1)
  echo "Tunnel URL: $TUNNEL_URL"
fi

# 5) Telegram bot
pkill -f "python3 bot.py" 2>/dev/null
sleep 1
python3 bot.py >> "$JALZA_DIR/bot.log" 2>&1 &

echo "=== All services started ==="
echo "Ollama:      http://localhost:11434"
echo "API:         http://localhost:8765"
echo "UI:          http://localhost:3001"
echo "Tunnel:      $(grep -o 'https://[a-z0-9\-]*\.trycloudflare\.com' "$JALZA_DIR/tunnel.log" | tail -1)"
