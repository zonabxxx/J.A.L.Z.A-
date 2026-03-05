#!/bin/bash
# ============================================================
# J.A.L.Z.A. — Inštalácia automatického štartu (macOS)
# ============================================================
# Po spustení sa pri každom zapnutí Mac-u automaticky:
#   1. Spustí knowledge_api.py
#   2. Spustí Cloudflare Tunnel
#   3. Aktualizuje Railway s novou tunnel URL
# ============================================================

set -e

JALZA_DIR="$HOME/Documents/workspaceAI/jalza"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
PLIST="$LAUNCH_AGENTS/com.jalza.tunnel.plist"

mkdir -p "$LAUNCH_AGENTS"
mkdir -p "$JALZA_DIR/logs"

echo "=== J.A.L.Z.A. Auto-Start Installer ==="
echo ""

# Zastav existujúcu službu ak beží
launchctl unload "$PLIST" 2>/dev/null || true

cat > "$PLIST" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.jalza.tunnel</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${JALZA_DIR}/start-tunnel.sh</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${JALZA_DIR}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${JALZA_DIR}/logs/jalza-service.log</string>
    <key>StandardErrorPath</key>
    <string>${JALZA_DIR}/logs/jalza-service.error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:${HOME}/bin</string>
        <key>HOME</key>
        <string>${HOME}</string>
    </dict>
</dict>
</plist>
EOF

launchctl load "$PLIST"

echo "[OK] Služba nainštalovaná a spustená!"
echo ""
echo "  Po reštarte Mac-u sa J.A.L.Z.A. spustí automaticky."
echo ""
echo "  Logy:       cat $JALZA_DIR/logs/jalza-service.log"
echo "  Zastaviť:   launchctl unload $PLIST"
echo "  Spustiť:    launchctl load $PLIST"
echo "  Odinštalovať: rm $PLIST"
echo ""
