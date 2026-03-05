#!/bin/bash
# ============================================================
# J.A.L.Z.A. — Secure Tunnel + Backend Startup
# ============================================================
# Spúšťa:
#   1. knowledge_api.py (port 8765)
#   2. Cloudflare Tunnel (bezpečný tunel na internet)
#
# Ollama musí bežať samostatne: ollama serve
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLOUDFLARED="${HOME}/bin/cloudflared"

if [ ! -f "$CLOUDFLARED" ]; then
    CLOUDFLARED="$(which cloudflared 2>/dev/null || echo "")"
fi

if [ -z "$CLOUDFLARED" ]; then
    echo "ERROR: cloudflared nie je nainštalovaný"
    exit 1
fi

# Load .env
if [ -f "$SCRIPT_DIR/.env" ]; then
    set -a
    source "$SCRIPT_DIR/.env"
    set +a
fi

echo "=== J.A.L.Z.A. Secure Tunnel ==="
echo ""

# Check if knowledge_api is already running
if lsof -ti:8765 > /dev/null 2>&1; then
    echo "[OK] knowledge_api.py už beží na porte 8765"
else
    echo "[>>] Spúšťam knowledge_api.py..."
    cd "$SCRIPT_DIR"
    python3 knowledge_api.py &
    BACKEND_PID=$!
    sleep 2
    if kill -0 $BACKEND_PID 2>/dev/null; then
        echo "[OK] knowledge_api.py beží (PID: $BACKEND_PID)"
    else
        echo "[ERROR] knowledge_api.py sa nepodarilo spustiť"
        exit 1
    fi
fi

# Check Ollama
if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "[OK] Ollama beží na localhost:11434"
else
    echo "[WARN] Ollama nebeží! Spusti: ollama serve"
fi

echo ""
echo "[>>] Spúšťam Cloudflare Tunnel..."
echo "    Tunnel URL sa zobrazí nižšie — nastav ju ako KNOWLEDGE_API_URL v Railway"
echo ""

# Quick tunnel (no Cloudflare account needed, URL changes on restart)
# For persistent URL, use: cloudflared tunnel create jalza
"$CLOUDFLARED" tunnel --url http://localhost:8765 --no-autoupdate

# Cleanup on exit
trap "kill $BACKEND_PID 2>/dev/null; echo 'Stopped.'" EXIT
