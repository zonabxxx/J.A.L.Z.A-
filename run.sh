#!/bin/bash
export PATH="$HOME/.local/bin:/usr/local/bin:$PATH"
cd /Users/jurajmartinkovych/Documents/workspaceAI/jalza

# Kill existing instances
pkill -f "python3 bot.py" 2>/dev/null
sleep 2

# Start bot
python3 bot.py >> /Users/jurajmartinkovych/Documents/workspaceAI/jalza/bot.log 2>&1 &
echo "J.A.L.Z.A. started at $(date)" >> /Users/jurajmartinkovych/Documents/workspaceAI/jalza/bot.log
