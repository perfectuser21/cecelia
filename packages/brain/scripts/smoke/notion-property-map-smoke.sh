#!/usr/bin/env bash
# notion-property-map-smoke.sh — Notion property map endpoints smoke test
# 接受 201（有 NOTION_API_KEY）或 502（无 key，CI 环境）
set -euo pipefail
BASE="http://localhost:5221"

echo "=== notion-property-map smoke ==="

CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BASE/api/brain/notes" \
  -H "Content-Type: application/json" \
  -d '{"title":"[smoke] notion-map notes","content":"smoke test","type":"Note"}')
[ "$CODE" = "201" ] || [ "$CODE" = "502" ] || { echo "FAIL: /notes got $CODE"; exit 1; }
echo "✓ POST /api/brain/notes: $CODE"

CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BASE/api/brain/notion/task" \
  -H "Content-Type: application/json" \
  -d '{"title":"[smoke] notion-map task"}')
[ "$CODE" = "201" ] || [ "$CODE" = "502" ] || { echo "FAIL: /notion/task got $CODE"; exit 1; }
echo "✓ POST /api/brain/notion/task: $CODE"

CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BASE/api/brain/notes" \
  -H "Content-Type: application/json" \
  -d '{}')
[ "$CODE" = "400" ] || { echo "FAIL: missing title should return 400, got $CODE"; exit 1; }
echo "✓ POST /api/brain/notes (missing title): 400"

node -e "
import('./packages/brain/src/notion-property-map.js').then(m => {
  if (typeof m.stripUnknownProperties !== 'function') process.exit(1);
  if (!m.NOTION_PROPERTY_MAP || m.NOTION_PROPERTY_MAP.notionTask?.allowedKeys?.includes('Status')) process.exit(1);
  console.log('notion-property-map.js OK');
}).catch(() => process.exit(1));
"

echo "=== notion-property-map smoke PASS ==="
