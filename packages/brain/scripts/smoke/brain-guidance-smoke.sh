#!/usr/bin/env bash
# Smoke: brain-guidance — brain_guidance 基础设施（两层架构握手表）
# 验证：guidance.js 存在 getGuidance/setGuidance/clearExpired，migration 262 已部署
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DB_HOST="${DB_HOST:-localhost}"
DB_USER="${DB_USER:-cecelia}"
DB_NAME="${DB_NAME:-cecelia}"
DB_PASSWORD="${DB_PASSWORD:-cecelia}"

echo "[guidance-smoke] 1. 检查 Brain 健康"
STATUS=$(curl -sf "${BRAIN_URL}/api/brain/health" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(d.status||'unknown')")
if [[ "$STATUS" != "ok" && "$STATUS" != "healthy" ]]; then
  echo "[guidance-smoke] FAIL: Brain 不健康，status=${STATUS}"
  exit 1
fi
echo "[guidance-smoke] Brain 健康 ✓"

echo "[guidance-smoke] 2. 验证 guidance.js 导出三函数"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/guidance.js', 'utf8');
const required = ['getGuidance', 'setGuidance', 'clearExpired', 'brain_guidance'];
const missing = required.filter(fn => !src.includes(fn));
if (missing.length > 0) { console.error('FAIL: guidance.js 缺少:', missing.join(', ')); process.exit(1); }
console.log('guidance.js 含所有函数 ✓');
"

echo "[guidance-smoke] 3. 验证 migration 262 存在"
node -e "
const fs = require('fs');
if (!fs.existsSync('packages/brain/migrations/262_brain_guidance.sql')) {
  console.error('FAIL: migration 262_brain_guidance.sql 不存在'); process.exit(1);
}
console.log('migration 262 存在 ✓');
"

echo "[guidance-smoke] 4. 验证 brain_guidance 表已部署"
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -c "SELECT COUNT(*) FROM brain_guidance" > /dev/null 2>&1 && \
  echo "brain_guidance 表存在 ✓" || \
  { echo "FAIL: brain_guidance 表不可访问"; exit 1; }

echo "[guidance-smoke] 全部检查通过 ✓"
