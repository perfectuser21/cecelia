#!/usr/bin/env bash
# preview-environments-smoke.sh — per-branch preview 环境 API 冒烟验证
set -euo pipefail

# 真 Brain 写入必须显式授权，并核对本机测试容器。
if ! node "$(dirname "${BASH_SOURCE[0]}")/../lib/smoke-production-guard.mjs" "${BRAIN_URL:-http://localhost:5221}"; then
  exit 0
fi

BASE_URL="${BRAIN_URL:-http://localhost:5221}/api/brain"
PR_NUM=9999
BRANCH="smoke-test-branch"
REPO="cecelia"

echo "🔍 preview-environments smoke: $BASE_URL"

# 1. 分配端口
RESP=$(curl -q -s -X POST "$BASE_URL/preview/allocate" \
  -H "Content-Type: application/json" \
  -d "{\"pr_number\":$PR_NUM,\"branch_name\":\"$BRANCH\",\"base_repo\":\"$REPO\"}")
PORT=$(echo "$RESP" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const p=JSON.parse(d).port;if(!p||p<5300||p>5399){process.stderr.write('invalid port: '+d);process.exit(1)}console.log(p)})")
echo "  ✅ allocate: port=$PORT"

# 2. 列出活跃环境（含刚分配的）
LIST=$(curl -q -s "$BASE_URL/preview")
echo "$LIST" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const rows=JSON.parse(d);const found=rows.find(r=>r.pr_number===$PR_NUM);if(!found){process.stderr.write('allocated row not in list');process.exit(1)}console.log('  ✅ list: found pr_number='+(found.pr_number))})"

# 3. 停止并确认 status=stopped
curl -q -s -X DELETE "$BASE_URL/preview/$PR_NUM" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const r=JSON.parse(d);if(!r.stopped){process.stderr.write('expected stopped:true, got: '+d);process.exit(1)}console.log('  ✅ delete: stopped=true')})"

# 4. 确认停止后不再出现在活跃列表
LIST2=$(curl -q -s "$BASE_URL/preview")
echo "$LIST2" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const rows=JSON.parse(d);const found=rows.find(r=>r.pr_number===$PR_NUM);if(found){process.stderr.write('stopped row still in active list');process.exit(1)}console.log('  ✅ after stop: not in active list')})"

echo "✅ preview-environments smoke 通过"
