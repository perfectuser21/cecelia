#!/usr/bin/env bash
# notion-property-map-smoke.sh
# 验收：Brain Notion 属性映射修复 — Initiative ID / Name / Order 三处属性名正确
set -uo pipefail

API="${BRAIN_URL:-http://localhost:5221}/api/brain"
PASS=0; FAIL=0

ok()   { echo "✅ $1"; ((PASS++)) || true; }
fail() { echo "❌ $1"; ((FAIL++)) || true; }

# 1. POST /api/brain/notes 缺 title → 400
echo "── notes validation ──"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/notes" \
  -H "Content-Type: application/json" -d '{"content":"body"}')
[[ "$CODE" == "400" ]] \
  && ok "POST /notes missing title → 400" \
  || fail "POST /notes missing title → 期望 400，得 $CODE"

# 2. POST /api/brain/notion/task 缺 title → 400
echo "── notion/task validation ──"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/notion/task" \
  -H "Content-Type: application/json" -d '{}')
[[ "$CODE" == "400" ]] \
  && ok "POST /notion/task missing title → 400" \
  || fail "POST /notion/task missing title → 期望 400，得 $CODE"

# 3. ARTIFACT: notion-property-map.js 存在且导出正确符号
echo "── notion-property-map.js artifact ──"
node -e "
const c = require('fs').readFileSync('packages/brain/src/notion-property-map.js', 'utf8');
if (!c.includes('NOTION_PROPERTY_MAP') || !c.includes('stripUnknownProperties')) process.exit(1);
console.log('OK');
" && ok "notion-property-map.js 导出 NOTION_PROPERTY_MAP + stripUnknownProperties" \
  || fail "notion-property-map.js 导出符号缺失"

# 4. ARTIFACT: /notes 路由不含硬编码 'Initiative ID'（单引号形式）
echo "── routes/notes.js initiative ID check ──"
node -e "
const src = require('fs').readFileSync('packages/brain/src/routes/notes.js', 'utf8');
const s = src.indexOf(\"router.post('/notes'\");
const e = src.indexOf('\nrouter.', s + 1);
const body = src.slice(s, e > 0 ? e : undefined);
if (body.includes(\"'Initiative ID'\")) { console.error('FAIL'); process.exit(1); }
console.log('OK');
" && ok "/notes 路由不含硬编码 'Initiative ID'" \
  || fail "/notes 路由仍含硬编码 'Initiative ID'"

# 5. ARTIFACT: /notion/task 路由使用 Name 不用 Title
echo "── routes/notes.js notion/task Name check ──"
node -e "
const src = require('fs').readFileSync('packages/brain/src/routes/notes.js', 'utf8');
const s = src.indexOf(\"router.post('/notion/task'\");
const e1 = src.indexOf('\nrouter.', s + 1);
const e2 = src.indexOf('\nexport ', s + 1);
const body = src.slice(s, e1 > 0 ? e1 : (e2 > 0 ? e2 : undefined));
if (/\bTitle\s*:\s*\{/.test(body)) { console.error('FAIL: 仍含 Title:'); process.exit(1); }
if (!/\bName\s*:\s*\{/.test(body)) { console.error('FAIL: 缺 Name:'); process.exit(1); }
console.log('OK');
" && ok "/notion/task 使用 Name 属性（不用 Title）" \
  || fail "/notion/task 属性名不正确"

# 6. ARTIFACT: pushJourneyStepLinks 不含 Order 属性
echo "── notion-push-sync.js Order check ──"
node -e "
const src = require('fs').readFileSync('packages/brain/src/notion-push-sync.js', 'utf8');
const s = src.indexOf('async function pushJourneyStepLinks');
const e = src.indexOf('\nasync function ', s + 1);
const body = src.slice(s, e > 0 ? e : undefined);
if (/\bOrder\s*:\s*\{/.test(body)) { console.error('FAIL: 仍含 Order:'); process.exit(1); }
console.log('OK');
" && ok "pushJourneyStepLinks 不含 Order 属性" \
  || fail "pushJourneyStepLinks 仍含 Order 属性"

echo ""
echo "── 结果：PASS=$PASS FAIL=$FAIL ──"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
