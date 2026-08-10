#!/usr/bin/env bash
# smoke: harness PR 归属求证端点 GET /api/brain/harness/pr-ownership（合并权单一裁决闸）。
# 真机断言（real-env-smoke 起真 cecelia-brain 容器 + 真 postgres）：
#   - 缺参 → HTTP 400
#   - 随机不存在分支 → owned:false（/dev 不回归的端点侧信号）
# 另加代码面断言（路由已挂载），无 Brain 环境也保底不误绿。
set -euo pipefail
cd "$(dirname "$0")/../../../.."
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

# 代码面：路由已挂载
node -e "const c=require('fs').readFileSync('packages/brain/src/routes/harness.js','utf8');if(!/pr-ownership/.test(c)){console.error('FAIL: harness.js 未挂载 pr-ownership 路由');process.exit(1)}"

# 真机：缺参 → 400
CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BRAIN_URL}/api/brain/harness/pr-ownership")
[ "$CODE" = "400" ] || { echo "FAIL: 缺 branch/pr_url 未返回 400（实际 $CODE）"; exit 1; }

# 真机：随机不存在分支 → owned:false + run_id:null
curl -sf "${BRAIN_URL}/api/brain/harness/pr-ownership?branch=cp-smoke-nonexistent-$RANDOM-$$" \
  | jq -e '.owned==false and .run_id==null' >/dev/null \
  || { echo "FAIL: 随机分支未判 owned:false"; exit 1; }

echo "OK: pr-ownership smoke passed"
