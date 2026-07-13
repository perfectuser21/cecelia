#!/usr/bin/env bash
# migration-339-drop-abilities-gp-priority-smoke.sh
# Migration 339 真库验收（decision 13013a49，能力轴新定义）：
#   M1: 死表 abilities 已被 DROP（不存在）
#   M3: golden_paths 新增 priority INTEGER 列
#   M3: status CHECK 接受新态 'live'，仍拒绝非法值 bogus
# L3 真库：psql 直探 pg_catalog / information_schema + CHECK 约束事务回滚验证。
set -uo pipefail

DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
PASS=0; FAIL=0
ok()   { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }

# ── 前置：psql 可用 + DB 可达 ──
if ! command -v psql >/dev/null 2>&1; then
  echo "[smoke] SKIP: psql 不可用"
  exit 0
fi
if ! psql "$DB" -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "[smoke] SKIP: DB 不可达 ($DB)"
  exit 0
fi

# ── M1: 死表 abilities 已不存在（migration 339 DROP TABLE IF EXISTS）──
echo "── M1: abilities 死表已 DROP ──"
REG=$(psql "$DB" -tAc "SELECT to_regclass('public.abilities')" 2>/dev/null | tr -d '[:space:]')
if [ -z "$REG" ]; then
  ok "abilities 表不存在（已被 339 DROP）"
else
  fail "abilities 表仍存在（to_regclass=$REG）——migration 339 未生效"
fi

# ── M3a: golden_paths 有 priority INTEGER 列 ──
echo "── M3a: golden_paths.priority 列 ──"
COLTYPE=$(psql "$DB" -tAc "SELECT data_type FROM information_schema.columns WHERE table_name='golden_paths' AND column_name='priority'" 2>/dev/null | tr -d '[:space:]')
if [ "$COLTYPE" = "integer" ]; then
  ok "golden_paths.priority 存在且为 integer"
else
  fail "golden_paths.priority 缺失或类型不符（得='$COLTYPE'，期望 integer）"
fi

# ── M3b: status CHECK 接受新态 'live' ──
echo "── M3b: status CHECK 接受 'live' ──"
if psql "$DB" -tAc "BEGIN; INSERT INTO golden_paths(title, one_liner, status) VALUES('smoke339 live','smoke','live'); ROLLBACK;" >/dev/null 2>&1; then
  ok "status='live' 被接受（CHECK 已扩 live 态）"
else
  fail "status='live' 被拒——migration 339 的 CHECK 扩容未生效"
fi

# ── M3c: status CHECK 仍拒绝非法值 bogus ──
echo "── M3c: status CHECK 拒绝非法值 bogus ──"
if psql "$DB" -tAc "BEGIN; INSERT INTO golden_paths(title, one_liner, status) VALUES('smoke339 bogus','smoke','bogus'); ROLLBACK;" >/dev/null 2>&1; then
  fail "非法值 bogus 竟被接受（CHECK 失效）"
else
  ok "非法值 bogus 被拒（CHECK 生效）"
fi

echo ""
echo "结果：PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
