#!/bin/bash
cd "$(dirname "$0")"
export PATH="/usr/local/bin:/usr/bin:/bin:/Applications/Ollama.app/Contents/Resources:$PATH"

# Wait for Ollama to be ready
for i in {1..30}; do
    curl -s http://localhost:11434/api/tags > /dev/null 2>&1 && break
    sleep 2
done

exec python3 bot.py
