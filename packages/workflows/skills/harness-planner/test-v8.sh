#!/bin/bash
set -e
FILE="/Users/administrator/perfect21/cecelia/packages/workflows/skills/harness-planner/SKILL.md"
grep -q "version: 8.0.0" "$FILE" || { echo "FAIL: 版本不是 8.0.0"; exit 1; }
grep -q "Golden Path（核心场景）" "$FILE" || { echo "FAIL: PRD 未改为 Golden Path 格式"; exit 1; }
node -e "const c=require('fs').readFileSync('$FILE','utf8');if(c.includes('## Step 3: 拆 Task DAG'))process.exit(1)" || { echo "FAIL: v8 不应有 Step 3 拆 Task DAG"; exit 1; }
node -e "const c=require('fs').readFileSync('$FILE','utf8');if(c.includes('task-plan.json'))process.exit(1)" || { echo "FAIL: v8 不应有 task-plan.json"; exit 1; }
echo "PASS"
