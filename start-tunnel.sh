#!/bin/bash
# ============================================================
# J.A.L.Z.A. — Secure Tunnel + Auto-update Railway
# ============================================================
# Spúšťa:
#   1. knowledge_api.py (port 8765)
#   2. Cloudflare Tunnel
#   3. Automaticky aktualizuje KNOWLEDGE_API_URL v Railway
#
# Ollama musí bežať samostatne: ollama serve
#
# Konfigurácia Railway (doplň do .env):
#   RAILWAY_API_TOKEN=...    (z https://railway.app/account/tokens)
#   RAILWAY_PROJECT_ID=...   (z URL: railway.app/project/<ID>)
#   RAILWAY_SERVICE_ID=...   (z Settings → Service ID)
#   RAILWAY_ENV_ID=...       (z Settings → Environment ID)
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLOUDFLARED="${HOME}/bin/cloudflared"
LOG_FILE="$SCRIPT_DIR/logs/cloudflared.log"

mkdir -p "$SCRIPT_DIR/logs"

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

# ── 1. Backend ────────────────────────────────────────────────
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

# ── 2. Ollama check ──────────────────────────────────────────
if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "[OK] Ollama beží na localhost:11434"
else
    echo "[WARN] Ollama nebeží! Spusti: ollama serve"
fi

# ── 3. Tunnel + auto-update Railway ──────────────────────────
echo ""
echo "[>>] Spúšťam Cloudflare Tunnel..."

update_railway() {
    local TUNNEL_URL="$1"

    if [ -z "$RAILWAY_API_TOKEN" ] || [ -z "$RAILWAY_PROJECT_ID" ] || [ -z "$RAILWAY_SERVICE_ID" ] || [ -z "$RAILWAY_ENV_ID" ]; then
        echo "[INFO] Railway konfigurácia chýba v .env — URL musíš nastaviť manuálne:"
        echo "       KNOWLEDGE_API_URL=$TUNNEL_URL"
        return
    fi

    echo "[>>] Aktualizujem Railway KNOWLEDGE_API_URL..."

    RESPONSE=$(curl -s -X POST "https://backboard.railway.com/graphql/v2" \
        -H "Authorization: Bearer $RAILWAY_API_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{
            \"query\": \"mutation { variableUpsert(input: { projectId: \\\"$RAILWAY_PROJECT_ID\\\", serviceId: \\\"$RAILWAY_SERVICE_ID\\\", environmentId: \\\"$RAILWAY_ENV_ID\\\", name: \\\"KNOWLEDGE_API_URL\\\", value: \\\"$TUNNEL_URL\\\" }) }\"
        }")

    if echo "$RESPONSE" | grep -q '"variableUpsert":true'; then
        echo "[OK] Railway KNOWLEDGE_API_URL aktualizovaná na: $TUNNEL_URL"
        echo "[>>] Railway sa automaticky redeployne..."
    else
        echo "[WARN] Railway update zlyhal. Nastav manuálne:"
        echo "       KNOWLEDGE_API_URL=$TUNNEL_URL"
        echo "       Response: $RESPONSE"
    fi
}

# Spustí cloudflared a sleduje log pre tunnel URL
"$CLOUDFLARED" tunnel --url http://localhost:8765 --no-autoupdate 2>&1 | tee "$LOG_FILE" &
TUNNEL_PID=$!

# Čakaj na tunnel URL
echo "[>>] Čakám na tunnel URL..."
TUNNEL_URL=""
for i in $(seq 1 30); do
    sleep 1
    TUNNEL_URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG_FILE" 2>/dev/null | head -1)
    if [ -n "$TUNNEL_URL" ]; then
        break
    fi
done

if [ -n "$TUNNEL_URL" ]; then
    echo ""
    echo "============================================"
    echo "  Tunnel URL: $TUNNEL_URL"
    echo "============================================"
    echo ""
    update_railway "$TUNNEL_URL"
else
    echo "[ERROR] Tunnel URL sa nepodarilo získať"
    echo "        Skontroluj: cat $LOG_FILE"
fi

echo ""
echo "[OK] Všetko beží. Ctrl+C na zastavenie."

# Cleanup
trap "kill $TUNNEL_PID $BACKEND_PID 2>/dev/null; echo 'Stopped.'" EXIT INT TERM

# Drží skript aktívny
wait $TUNNEL_PID
