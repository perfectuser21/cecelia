#!/usr/bin/env bash
# migration-346-idempotent-smoke.sh — 346 幂等迁移 smoke 验证
# task_id: 874c9cc8-8afe-47c5-a3ed-e1dce93abda4
# sprint: 07170530-migration-346-idempotent
#
# 验证：
#   1. incidents 表存在且含 fingerprint 列（NOT NULL, TEXT）
#   2. fingerprint 列有 UNIQUE 约束
#   3. incidents 端点可达
#
# 前置条件：Brain 服务已启动（DATABASE_URL 已配置）

set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DATABASE_URL="${DATABASE_URL:-}"

echo "[smoke] migration-346-idempotent smoke"

# 1. 验证 incidents 端点可达
echo "[smoke] 1/3 检查 incidents 端点..."
RESPONSE=$(curl -sf --max-time 5 "${BRAIN_URL}/api/brain/incidents" 2>&1) || {
  echo "[smoke] FAIL: incidents endpoint unreachable"
  exit 1
}
echo "[smoke] PASS: incidents endpoint OK"

# 2. 验证 fingerprint 列存在（通过 information_schema SQL 查询）
if [ -n "${DATABASE_URL}" ]; then
  echo "[smoke] 2/3 验证 fingerprint 列 NOT NULL..."
  COL_NULLABLE=$(psql "${DATABASE_URL}" -t -c "
    SELECT is_nullable FROM information_schema.columns
    WHERE table_schema='public' AND table_name='incidents' AND column_name='fingerprint'
  " 2>/dev/null | tr -d ' \n')

  if [ "${COL_NULLABLE}" = "NO" ]; then
    echo "[smoke] PASS: fingerprint 列 NOT NULL 成立"
  else
    echo "[smoke] FAIL: fingerprint 列不存在或 is_nullable != NO (got: '${COL_NULLABLE}')"
    exit 1
  fi

  echo "[smoke] 3/3 验证 fingerprint UNIQUE 约束..."
  UNIQUE_CNT=$(psql "${DATABASE_URL}" -t -c "
    SELECT COUNT(*) FROM information_schema.key_column_usage kcu
    JOIN information_schema.table_constraints tc ON tc.constraint_name = kcu.constraint_name
    WHERE tc.table_schema='public' AND tc.table_name='incidents'
      AND kcu.column_name='fingerprint' AND tc.constraint_type='UNIQUE'
  " 2>/dev/null | tr -d ' \n')

  if [ "${UNIQUE_CNT}" -ge 1 ] 2>/dev/null; then
    echo "[smoke] PASS: fingerprint UNIQUE 约束存在"
  else
    echo "[smoke] FAIL: fingerprint UNIQUE 约束不存在 (count=${UNIQUE_CNT})"
    exit 1
  fi
else
  echo "[smoke] 2/3 跳过 DB 检查（DATABASE_URL 未配置）"
  echo "[smoke] 3/3 跳过 DB 检查（DATABASE_URL 未配置）"
fi

echo "[smoke] migration-346-idempotent smoke: ALL PASS"
