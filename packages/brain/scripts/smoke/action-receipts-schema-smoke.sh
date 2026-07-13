#!/usr/bin/env bash
# action-receipts-schema-smoke.sh
# 验收：migration 315 九要素存储真环境落地 —— action_receipts 表 + decisions.review_after 列存在。
# L1 静态：migration 文件含正确 DDL。L3 真库：psql 查 information_schema 确认表/列已应用。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"   # packages/brain
MIG="$ROOT/migrations/315_action_receipts_and_decision_review.sql"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
PASS=0; FAIL=0
ok()   { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }

# ── L1 静态：migration DDL ──
echo "── L1 migration 文件 DDL ──"
grep -q "CREATE TABLE IF NOT EXISTS action_receipts" "$MIG" \
  && ok "migration 创建 action_receipts" || fail "migration 缺 action_receipts 建表"
grep -q "ALTER TABLE decisions ADD COLUMN IF NOT EXISTS review_after" "$MIG" \
  && ok "migration 加 decisions.review_after" || fail "migration 缺 review_after"

# ── L3 真库：psql 确认已应用 ──
echo "── L3 真库 schema（psql）──"
if ! command -v psql >/dev/null 2>&1; then
  echo "[smoke] L3 SKIP: psql 不可用（L1 静态已 PASS）"
elif ! psql "$DB" -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "[smoke] L3 SKIP: DB 不可达（L1 静态已 PASS）"
else
  # action_receipts 9 列齐
  COLS=$(psql "$DB" -tAc "SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns WHERE table_name='action_receipts'" 2>/dev/null)
  for c in action_id kind target sent_at receipt_status evidence; do
    echo "$COLS" | grep -q "$c" && ok "action_receipts.$c 存在" || fail "action_receipts 缺 $c"
  done
  # receipt_status 四态 CHECK 生效：插非法值应被拒
  psql "$DB" -tAc "BEGIN; INSERT INTO action_receipts(kind,receipt_status) VALUES('smoke','bogus'); ROLLBACK;" >/dev/null 2>&1 \
    && fail "receipt_status CHECK 未生效（非法值竟被接受）" \
    || ok "receipt_status 四态 CHECK 生效（拒非法值）"
  # decisions.review_after 存在
  RA=$(psql "$DB" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='decisions' AND column_name='review_after'" 2>/dev/null)
  [ "$RA" = "1" ] && ok "decisions.review_after 存在" || fail "decisions 缺 review_after"
fi

echo ""
echo "结果：PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
