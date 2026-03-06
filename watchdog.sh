#!/bin/bash
# J.A.L.Z.A. Watchdog — monitors, auto-restarts, and keeps model warm
# Run via launchd every 2 minutes

export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
JALZA_DIR="/Users/jurajmartinkovych/Documents/workspaceAI/jalza"
LOG="$JALZA_DIR/watchdog.log"
UI_DIR="$JALZA_DIR/ui"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG"; }

restart_count=0

# 1) Ollama process
if ! curl -sf --max-time 3 http://localhost:11434/api/tags > /dev/null 2>&1; then
  log "RESTART Ollama — not responding"
  pkill -f "ollama serve" 2>/dev/null
  sleep 2
  OLLAMA_KEEP_ALIVE=24h ollama serve > /dev/null 2>&1 &
  sleep 5
  restart_count=$((restart_count + 1))
fi

# 2) knowledge_api.py (port 8765)
if ! lsof -ti:8765 > /dev/null 2>&1; then
  log "RESTART knowledge_api.py — not running"
  cd "$JALZA_DIR"
  python3 knowledge_api.py >> "$JALZA_DIR/knowledge_api.log" 2>&1 &
  sleep 3
  restart_count=$((restart_count + 1))
fi

# 3) Keep jalza model warm — prevent GPU unload
if curl -sf --max-time 3 http://localhost:11434/api/tags > /dev/null 2>&1; then
  response=$(curl -s --max-time 45 http://localhost:11434/api/chat \
    -d '{"model":"jalza","messages":[{"role":"user","content":"ok"}],"stream":false,"options":{"num_predict":1}}' 2>&1)
  if [ $? -ne 0 ] || echo "$response" | grep -q '"error"'; then
    log "RESTART Ollama — model jalza frozen, restarting"
    pkill -f "ollama serve" 2>/dev/null
    sleep 3
    OLLAMA_KEEP_ALIVE=24h ollama serve > /dev/null 2>&1 &
    sleep 8
    # Pre-load model
    curl -s --max-time 60 http://localhost:11434/api/chat \
      -d '{"model":"jalza","messages":[{"role":"user","content":"ok"}],"stream":false,"options":{"num_predict":1}}' > /dev/null 2>&1
    restart_count=$((restart_count + 1))
  fi
fi

# 4) Localtunnel (fixed URL: jalza-api.loca.lt)
if ! pgrep -f "localtunnel.*jalza-api" > /dev/null 2>&1; then
  log "RESTART Localtunnel (jalza-api.loca.lt)"
  npx localtunnel --port 8765 --subdomain jalza-api >> "$JALZA_DIR/tunnel.log" 2>&1 &
  sleep 5
  restart_count=$((restart_count + 1))
fi

# 5) Next.js dev server (port 3001)
if ! lsof -ti:3001 > /dev/null 2>&1; then
  log "RESTART Next.js dev server"
  cd "$UI_DIR"
  npm run dev >> "$JALZA_DIR/nextjs.log" 2>&1 &
  sleep 5
  restart_count=$((restart_count + 1))
fi

if [ $restart_count -gt 0 ]; then
  log "Watchdog restarted $restart_count service(s)"
fi
