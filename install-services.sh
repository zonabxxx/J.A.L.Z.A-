#!/bin/bash
# ============================================================
# J.A.L.Z.A. — Inštalácia systémových služieb (macOS launchd)
# ============================================================
# Po spustení sa knowledge_api.py a cloudflared spustia
# automaticky pri každom zapnutí Mac-u.
#
# Ollama sa spúšťa samostatne (má vlastný service).
# ============================================================

set -e

USER_NAME=$(whoami)
JALZA_DIR="$HOME/Documents/workspaceAI/jalza"
CLOUDFLARED="$HOME/bin/cloudflared"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"

mkdir -p "$LAUNCH_AGENTS"
mkdir -p "$JALZA_DIR/logs"

echo "=== J.A.L.Z.A. Service Installer ==="
echo ""

# ── 1. knowledge_api.py ──────────────────────────────────────
cat > "$LAUNCH_AGENTS/com.jalza.knowledge-api.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.jalza.knowledge-api</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/python3</string>
        <string>${JALZA_DIR}/knowledge_api.py</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${JALZA_DIR}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${JALZA_DIR}/logs/knowledge-api.log</string>
    <key>StandardErrorPath</key>
    <string>${JALZA_DIR}/logs/knowledge-api.error.log</string>
</dict>
</plist>
PLIST

echo "[OK] knowledge_api.py service vytvorený"

# ── 2. Cloudflare Tunnel ─────────────────────────────────────
cat > "$LAUNCH_AGENTS/com.jalza.cloudflared.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.jalza.cloudflared</string>
    <key>ProgramArguments</key>
    <array>
        <string>${CLOUDFLARED}</string>
        <string>tunnel</string>
        <string>--url</string>
        <string>http://localhost:8765</string>
        <string>--no-autoupdate</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${JALZA_DIR}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${JALZA_DIR}/logs/cloudflared.log</string>
    <key>StandardErrorPath</key>
    <string>${JALZA_DIR}/logs/cloudflared.error.log</string>
</dict>
</plist>
PLIST

echo "[OK] cloudflared service vytvorený"

# ── 3. Načítanie služieb ─────────────────────────────────────
launchctl unload "$LAUNCH_AGENTS/com.jalza.knowledge-api.plist" 2>/dev/null || true
launchctl unload "$LAUNCH_AGENTS/com.jalza.cloudflared.plist" 2>/dev/null || true

launchctl load "$LAUNCH_AGENTS/com.jalza.knowledge-api.plist"
launchctl load "$LAUNCH_AGENTS/com.jalza.cloudflared.plist"

echo "[OK] Služby načítané a spustené"
echo ""

# ── 4. Čakanie na tunnel URL ─────────────────────────────────
echo "[>>] Čakám na tunnel URL..."
sleep 5

TUNNEL_URL=""
for i in $(seq 1 12); do
    if [ -f "$JALZA_DIR/logs/cloudflared.error.log" ]; then
        TUNNEL_URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$JALZA_DIR/logs/cloudflared.error.log" | tail -1)
    fi
    if [ -n "$TUNNEL_URL" ]; then
        break
    fi
    sleep 2
done

echo ""
echo "============================================"
echo "  J.A.L.Z.A. služby bežia!"
echo "============================================"
echo ""
if [ -n "$TUNNEL_URL" ]; then
    echo "  Tunnel URL: $TUNNEL_URL"
    echo ""
    echo "  POZOR: Quick tunnel URL sa mení pri reštarte!"
    echo "  Pre stabilnú URL si vytvor Cloudflare účet"
    echo "  a použi named tunnel."
else
    echo "  Tunnel URL ešte nie je dostupná."
    echo "  Skontroluj: cat $JALZA_DIR/logs/cloudflared.error.log"
fi
echo ""
echo "  Logy:    $JALZA_DIR/logs/"
echo "  Zastaviť: launchctl unload ~/Library/LaunchAgents/com.jalza.*.plist"
echo ""
