#!/bin/bash
# PostToolUse hook: 当 Write/Edit 修改了 SKILL.md 时，自动同步到 Notion

HOOK_DATA=$(cat)

FILE_PATH=$(echo "$HOOK_DATA" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    inp = d.get('tool_input', d)
    print(inp.get('file_path','') or inp.get('path',''))
except:
    print('')
" 2>/dev/null)

if [[ "$FILE_PATH" != *"SKILL.md" ]]; then
    exit 0
fi

SKILL_ID=$(python3 -c "
p = '$FILE_PATH'
parts = p.split('/')
idx = [i for i,x in enumerate(parts) if x=='SKILL.md']
if idx:
    print(parts[idx[0]-1])
" 2>/dev/null)

[[ -z "$SKILL_ID" ]] && exit 0

# 直接读取 key，避免 source 在子 shell 失效
export NOTION_API_KEY=$(grep -m1 '^NOTION_API_KEY=' ~/.credentials/notion.env | cut -d= -f2-)
[[ -z "$NOTION_API_KEY" ]] && exit 0

echo "[skill-sync] 检测到 $SKILL_ID/SKILL.md 变更，同步到 Notion..." >&2
node /Users/administrator/perfect21/cecelia/packages/workflows/scripts/sync-skills-notion.mjs \
  --skill "$SKILL_ID" >> /tmp/skill-notion-sync.log 2>&1 &

exit 0
