#!/usr/bin/env bash
set -euo pipefail
BRAIN="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── relay-runs summary smoke ──"

# 1. 端点可达且返回 200
r=$(curl -sf "$BRAIN/api/brain/orchestrator/relay-runs/summary") || { fail "summary GET 不可达"; echo "PASS: $PASS  FAIL: $FAIL"; exit 1; }

# 2. 返回 JSON 对象（非数组）
echo "$r" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); if(typeof d!=='object'||Array.isArray(d)) process.exit(1)" 2>/dev/null \
  && ok "返回 JSON 对象" || fail "响应非 JSON 对象"

# 3. 含 phases 字段
echo "$r" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); if(!d.phases) process.exit(1)" 2>/dev/null \
  && ok "含 phases 字段" || fail "缺 phases 字段"

# 4. phases 含六个固定 key
echo "$r" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const keys=['planning','gan','generate','evaluate','done','failed'];
const missing=keys.filter(k=>!(k in d.phases));
if(missing.length>0){console.error('missing:',missing);process.exit(1);}
" 2>/dev/null && ok "phases 含六个固定 key" || fail "phases 缺少固定 key"

# 5. total === sum(phases)
echo "$r" | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const sum=Object.values(d.phases).reduce((a,b)=>a+b,0);
if(d.total!==sum){console.error('total',d.total,'!=sum',sum);process.exit(1);}
" 2>/dev/null && ok "total === sum(phases)" || fail "total 与 phases 之和不一致"

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
