#!/usr/bin/env bash
# skill-eval-smoke.sh — Skill Eval 服务 smoke 验证
# 验证：端点存在 / 无 token 返回 403 / evals 表存在

set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DB_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/cecelia}"

echo "[smoke] Skill Eval Service 健康检查..."

# 1. 验证端点存在（无 token → 403）
echo "[smoke] 1/3 验证 POST /api/brain/skill-eval/upload 返回 403（无 token）..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BRAIN_URL}/api/brain/skill-eval/upload")
if [ "$STATUS" != "403" ]; then
  echo "[smoke] FAIL: 期望 403，得到 $STATUS"
  exit 1
fi
echo "[smoke]   OK: 返回 403"

# 2. 验证 GET status 端点存在（不存在的 task → 404 或 400）
echo "[smoke] 2/3 验证 GET /api/brain/skill-eval/status/:id 端点存在..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${BRAIN_URL}/api/brain/skill-eval/status/00000000-0000-0000-0000-000000000000")
if [ "$STATUS" != "404" ] && [ "$STATUS" != "400" ]; then
  echo "[smoke] FAIL: 期望 404/400，得到 $STATUS"
  exit 1
fi
echo "[smoke]   OK: 返回 $STATUS（端点存在）"

# 3. 验证 evals 表存在
echo "[smoke] 3/3 验证 evals 表存在..."
TABLE_EXISTS=$(psql "${DB_URL}" -tAc "SELECT to_regclass('public.evals')" 2>/dev/null || echo "")
if [ -z "$TABLE_EXISTS" ] || [ "$TABLE_EXISTS" = "" ]; then
  echo "[smoke] FAIL: evals 表不存在（迁移 317 未运行？）"
  exit 1
fi
echo "[smoke]   OK: evals 表存在"

echo "[smoke] 全部通过 ✓"
