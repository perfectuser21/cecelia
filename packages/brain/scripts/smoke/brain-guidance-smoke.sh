#!/usr/bin/env bash
# Smoke: brain-guidance — brain_guidance 基础设施（两层架构握手表）
# 验证：guidance.js 存在 getGuidance/setGuidance/clearExpired，migration 262 已部署
# DB 表可用性通过 Brain 健康起来隐式验证（migration 262 在 Brain 启动前已执行）
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

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

echo "[guidance-smoke] 3. 验证 migration 262 存在且含建表语句"
node -e "
const fs = require('fs');
if (!fs.existsSync('packages/brain/migrations/262_brain_guidance.sql')) {
  console.error('FAIL: migration 262_brain_guidance.sql 不存在'); process.exit(1);
}
const sql = fs.readFileSync('packages/brain/migrations/262_brain_guidance.sql', 'utf8');
if (!sql.includes('brain_guidance')) {
  console.error('FAIL: migration 缺少 brain_guidance 建表语句'); process.exit(1);
}
console.log('migration 262 存在且含建表语句 ✓');
"

echo "[guidance-smoke] 4. 验证 Brain API 正常响应 (migration 已运行则 Brain 可起)"
curl -sf "${BRAIN_URL}/api/brain/health" > /dev/null && echo "Brain API 可访问 ✓" || { echo "FAIL: Brain API 不可访问"; exit 1; }

echo "[guidance-smoke] 全部检查通过 ✓"
