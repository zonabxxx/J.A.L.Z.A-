#!/bin/bash
# ============================================================
# J.A.L.Z.A. — Automatické zistenie Railway IDs
# ============================================================
# Stačí zadať Railway API token — skript sám nájde
# project ID, service ID a environment ID.
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

echo "=== Railway Setup ==="
echo ""
echo "Potrebuješ API token z: https://railway.app/account/tokens"
echo ""
read -p "Zadaj Railway API Token: " RAILWAY_TOKEN

if [ -z "$RAILWAY_TOKEN" ]; then
    echo "Token je povinný!"
    exit 1
fi

echo ""
echo "[>>] Hľadám tvoje projekty..."

PROJECTS=$(curl -s -X POST "https://backboard.railway.com/graphql/v2" \
    -H "Authorization: Bearer $RAILWAY_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"query": "{ me { projects { edges { node { id name services { edges { node { id name } } } environments { edges { node { id name } } } } } } } }"}')

# Check for errors
if echo "$PROJECTS" | grep -q '"errors"'; then
    echo "[ERROR] Neplatný token alebo API chyba"
    echo "$PROJECTS"
    exit 1
fi

# Find JALZA project
PROJECT_ID=$(echo "$PROJECTS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for edge in data.get('data',{}).get('me',{}).get('projects',{}).get('edges',[]):
    node = edge['node']
    if 'jalza' in node['name'].lower() or 'j.a.l.z.a' in node['name'].lower():
        print(node['id'])
        break
" 2>/dev/null)

if [ -z "$PROJECT_ID" ]; then
    echo "[WARN] Nepodarilo sa nájsť JALZA projekt automaticky."
    echo "Dostupné projekty:"
    echo "$PROJECTS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for edge in data.get('data',{}).get('me',{}).get('projects',{}).get('edges',[]):
    node = edge['node']
    print(f'  - {node[\"name\"]} (ID: {node[\"id\"]})')
" 2>/dev/null
    echo ""
    read -p "Zadaj Project ID: " PROJECT_ID
fi

SERVICE_ID=$(echo "$PROJECTS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for edge in data.get('data',{}).get('me',{}).get('projects',{}).get('edges',[]):
    node = edge['node']
    if node['id'] == '$PROJECT_ID':
        for svc in node.get('services',{}).get('edges',[]):
            print(svc['node']['id'])
            break
" 2>/dev/null)

ENV_ID=$(echo "$PROJECTS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for edge in data.get('data',{}).get('me',{}).get('projects',{}).get('edges',[]):
    node = edge['node']
    if node['id'] == '$PROJECT_ID':
        for env in node.get('environments',{}).get('edges',[]):
            if env['node']['name'].lower() == 'production':
                print(env['node']['id'])
                break
" 2>/dev/null)

if [ -z "$PROJECT_ID" ] || [ -z "$SERVICE_ID" ] || [ -z "$ENV_ID" ]; then
    echo "[ERROR] Nepodarilo sa nájsť všetky ID"
    echo "  Project: $PROJECT_ID"
    echo "  Service: $SERVICE_ID"
    echo "  Environment: $ENV_ID"
    exit 1
fi

echo ""
echo "[OK] Nájdené:"
echo "  Project ID:     $PROJECT_ID"
echo "  Service ID:     $SERVICE_ID"
echo "  Environment ID: $ENV_ID"
echo ""

# Update .env
if grep -q "^# RAILWAY_API_TOKEN=" "$ENV_FILE" 2>/dev/null || grep -q "^RAILWAY_API_TOKEN=" "$ENV_FILE" 2>/dev/null; then
    # Replace commented lines
    sed -i '' "s|^# RAILWAY_API_TOKEN=.*|RAILWAY_API_TOKEN=$RAILWAY_TOKEN|" "$ENV_FILE"
    sed -i '' "s|^# RAILWAY_PROJECT_ID=.*|RAILWAY_PROJECT_ID=$PROJECT_ID|" "$ENV_FILE"
    sed -i '' "s|^# RAILWAY_SERVICE_ID=.*|RAILWAY_SERVICE_ID=$SERVICE_ID|" "$ENV_FILE"
    sed -i '' "s|^# RAILWAY_ENV_ID=.*|RAILWAY_ENV_ID=$ENV_ID|" "$ENV_FILE"
    # Also replace non-commented
    sed -i '' "s|^RAILWAY_API_TOKEN=.*|RAILWAY_API_TOKEN=$RAILWAY_TOKEN|" "$ENV_FILE"
    sed -i '' "s|^RAILWAY_PROJECT_ID=.*|RAILWAY_PROJECT_ID=$PROJECT_ID|" "$ENV_FILE"
    sed -i '' "s|^RAILWAY_SERVICE_ID=.*|RAILWAY_SERVICE_ID=$SERVICE_ID|" "$ENV_FILE"
    sed -i '' "s|^RAILWAY_ENV_ID=.*|RAILWAY_ENV_ID=$ENV_ID|" "$ENV_FILE"
else
    echo "" >> "$ENV_FILE"
    echo "RAILWAY_API_TOKEN=$RAILWAY_TOKEN" >> "$ENV_FILE"
    echo "RAILWAY_PROJECT_ID=$PROJECT_ID" >> "$ENV_FILE"
    echo "RAILWAY_SERVICE_ID=$SERVICE_ID" >> "$ENV_FILE"
    echo "RAILWAY_ENV_ID=$ENV_ID" >> "$ENV_FILE"
fi

echo "[OK] .env aktualizovaný"
echo ""
echo "Teraz spusti: ./start-tunnel.sh"
echo "Tunnel automaticky aktualizuje Railway pri každom štarte."
