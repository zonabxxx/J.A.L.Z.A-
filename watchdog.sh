#!/bin/bash
# J.A.L.Z.A. Watchdog — monitors, auto-restarts, keeps tunnel alive
# Run via launchd every 45 seconds

export PATH="$HOME/.local/bin:$HOME/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
JALZA_DIR="/Users/jurajmartinkovych/Documents/workspaceAI/jalza"
LOG="$JALZA_DIR/watchdog.log"
UI_DIR="$JALZA_DIR/ui"
TUNNEL_URL="https://jalza-api.loca.lt"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG"; }

restart_count=0

# 1) Ollama
if ! curl -sf --max-time 3 http://localhost:11434/api/tags > /dev/null 2>&1; then
  log "RESTART Ollama — not responding"
  pkill -f "ollama serve" 2>/dev/null
  sleep 2
  OLLAMA_KEEP_ALIVE=24h ollama serve > /dev/null 2>&1 &
  sleep 5
  restart_count=$((restart_count + 1))
fi

# 2) knowledge_api.py
if ! curl -sf --max-time 3 http://localhost:8765/health > /dev/null 2>&1; then
  log "RESTART knowledge_api.py — not responding"
  pkill -f "knowledge_api.py" 2>/dev/null
  sleep 1
  cd "$JALZA_DIR"
  python3 knowledge_api.py >> "$JALZA_DIR/knowledge_api.log" 2>&1 &
  sleep 3
  restart_count=$((restart_count + 1))
fi

# 3) Keep jalza model warm
if curl -sf --max-time 3 http://localhost:11434/api/tags > /dev/null 2>&1; then
  response=$(curl -s --max-time 45 http://localhost:11434/api/chat \
    -d '{"model":"jalza","messages":[{"role":"user","content":"ok"}],"stream":false,"options":{"num_predict":1}}' 2>&1)
  if [ $? -ne 0 ] || echo "$response" | grep -q '"error"'; then
    log "RESTART Ollama — model jalza frozen"
    pkill -f "ollama serve" 2>/dev/null
    sleep 3
    OLLAMA_KEEP_ALIVE=24h ollama serve > /dev/null 2>&1 &
    sleep 8
    curl -s --max-time 60 http://localhost:11434/api/chat \
      -d '{"model":"jalza","messages":[{"role":"user","content":"ok"}],"stream":false,"options":{"num_predict":1}}' > /dev/null 2>&1
    restart_count=$((restart_count + 1))
  fi
fi

# 4) Localtunnel — health check + keepalive + auto-restart
tunnel_ok=false
tunnel_retries=0

if pgrep -f "localtunnel.*jalza-api" > /dev/null 2>&1; then
  tunnel_response=$(curl -s --max-time 5 -o /dev/null -w "%{http_code}" -H "Bypass-Tunnel-Reminder: yes" "$TUNNEL_URL/health" 2>&1)
  if [ "$tunnel_response" = "200" ]; then
    tunnel_ok=true
  fi
fi

if [ "$tunnel_ok" = false ]; then
  log "RESTART Localtunnel — dead or not responding (http=$tunnel_response)"
  pkill -f "localtunnel.*8765" 2>/dev/null
  pkill -f "lt.*8765" 2>/dev/null
  sleep 3

  while [ $tunnel_retries -lt 3 ]; do
    npx localtunnel --port 8765 --subdomain jalza-api >> "$JALZA_DIR/tunnel.log" 2>&1 &
    sleep 6
    verify=$(curl -s --max-time 5 -o /dev/null -w "%{http_code}" -H "Bypass-Tunnel-Reminder: yes" "$TUNNEL_URL/health" 2>&1)
    if [ "$verify" = "200" ]; then
      log "Localtunnel restarted OK (attempt $((tunnel_retries + 1)))"
      tunnel_ok=true
      break
    else
      log "Localtunnel attempt $((tunnel_retries + 1)) failed (http=$verify)"
      pkill -f "localtunnel.*8765" 2>/dev/null
      pkill -f "lt.*8765" 2>/dev/null
      sleep 2
    fi
    tunnel_retries=$((tunnel_retries + 1))
  done

  if [ "$tunnel_ok" = false ]; then
    log "Localtunnel FAILED after 3 attempts — will retry next cycle"
  fi
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
