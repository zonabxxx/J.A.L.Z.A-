#!/bin/bash
# J.A.L.Z.A. Watchdog — monitors and auto-restarts services
# Run via: launchctl or cron every 2 minutes

export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
JALZA_DIR="/Users/jurajmartinkovych/Documents/workspaceAI/jalza"
LOG="$JALZA_DIR/watchdog.log"
UI_DIR="$JALZA_DIR/ui"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG"; }

restart_count=0

# 1) Ollama
if ! curl -sf --max-time 3 http://localhost:11434/api/tags > /dev/null 2>&1; then
  log "RESTART Ollama — not responding"
  pkill -f "ollama serve" 2>/dev/null
  sleep 2
  ollama serve > /dev/null 2>&1 &
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

# 3) Ollama model health (quick ping)
if curl -sf --max-time 3 http://localhost:11434/api/tags > /dev/null 2>&1; then
  response=$(curl -s --max-time 20 http://localhost:11434/api/chat \
    -d '{"model":"jalza","messages":[{"role":"user","content":"ping"}],"stream":false}' 2>&1)
  if [ $? -ne 0 ] || echo "$response" | grep -q '"error"'; then
    log "RESTART Ollama — model jalza not responding, restarting"
    pkill -f "ollama serve" 2>/dev/null
    sleep 2
    ollama serve > /dev/null 2>&1 &
    sleep 5
    restart_count=$((restart_count + 1))
  fi
fi

# 4) Cloudflare Tunnel
if ! pgrep -f cloudflared > /dev/null 2>&1; then
  log "RESTART Cloudflare Tunnel"
  "$HOME/bin/cloudflared" tunnel --url http://localhost:8765 >> "$JALZA_DIR/tunnel.log" 2>&1 &
  sleep 8
  new_url=$(grep -o 'https://[a-z0-9\-]*\.trycloudflare\.com' "$JALZA_DIR/tunnel.log" | tail -1)
  if [ -n "$new_url" ]; then
    log "New tunnel URL: $new_url"
  fi
  restart_count=$((restart_count + 1))
fi

# 5) Next.js dev server (port 3000) — only if local
if ! lsof -ti:3000 > /dev/null 2>&1; then
  log "RESTART Next.js dev server"
  cd "$UI_DIR"
  npm run dev >> "$JALZA_DIR/nextjs.log" 2>&1 &
  sleep 5
  restart_count=$((restart_count + 1))
fi

if [ $restart_count -gt 0 ]; then
  log "Watchdog restarted $restart_count service(s)"
fi
