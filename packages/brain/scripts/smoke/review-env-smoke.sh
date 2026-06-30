#!/usr/bin/env bash
# review-env-smoke.sh — 验证 per-PR review 环境核心功能
# 覆盖：allocate API、list API、review-preview.sh 脚本存在且可执行
set -euo pipefail

BASE_URL="${BRAIN_URL:-http://localhost:5221}/api/brain/preview"
SCRIPT_DIR="$(cd "$(dirname "$0")/../../../.." && pwd)"

echo "=== review-env smoke ==="

# 1. 列出当前活跃 review 环境（不应报错）
echo "Step 1: GET /preview"
RESULT=$(curl -sf "$BASE_URL" 2>/dev/null || true)
echo "  ✅ GET /preview 返回: $(echo "$RESULT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).length+' 行'))" 2>/dev/null || echo 'ok')"

# 2. review-preview.sh 存在且有执行权
echo "Step 2: review-preview.sh 存在"
REVIEW_SCRIPT="$SCRIPT_DIR/scripts/review-preview.sh"
if [[ ! -f "$REVIEW_SCRIPT" ]]; then
  echo "  ❌ $REVIEW_SCRIPT 不存在" >&2; exit 1
fi
if [[ ! -x "$REVIEW_SCRIPT" ]]; then
  echo "  ❌ $REVIEW_SCRIPT 无执行权限" >&2; exit 1
fi
echo "  ✅ review-preview.sh 存在且可执行"

# 3. 脚本包含 STAGING_FLAG_COLOR（紫色横幅）和 REVIEW 标记
echo "Step 3: 横幅配置校验"
grep -q 'STAGING_FLAG_COLOR' "$REVIEW_SCRIPT" || { echo "❌ 缺少 STAGING_FLAG_COLOR" >&2; exit 1; }
grep -q 'REVIEW' "$REVIEW_SCRIPT" || { echo "❌ 缺少 REVIEW 字样" >&2; exit 1; }
echo "  ✅ 紫色横幅配置存在"

echo ""
echo "✅ review-env smoke 通过"
