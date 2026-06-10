#!/usr/bin/env bash
# initiative-lifecycle-smoke.sh
# 验收（PR 2b-1）：okr_initiatives 生命周期状态机
#   1. migration 299 存在且锁定生命周期词汇 + CHECK 约束
#   2. （DB 可达时）无残留旧 in-flight 值，CHECK 约束已生效
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG="$ROOT/migrations/299_okr_initiatives_lifecycle.sql"
PASS=0; FAIL=0
ok()   { echo "✅ $1"; ((PASS++)) || true; }
fail() { echo "❌ $1"; ((FAIL++)) || true; }

# 1. migration 文件存在且含生命周期值 + CHECK（node 读文件，CI 无 DB 也能跑）
echo "── migration 299 内容 ──"
node -e "
const fs=require('fs');
const c=fs.readFileSync('$MIG','utf8');
const need=[\"status = 'running'\",\"status = 'planned'\",\"status = 'done'\",'okr_initiatives_status_check','CHECK (status IN'];
const miss=need.filter(s=>!c.includes(s));
if(miss.length){console.error('缺失: '+miss.join(', '));process.exit(1)}
" && ok "migration 299 含 running/planned/done 映射 + CHECK 约束" \
  || fail "migration 299 内容不完整"

# 2. DB 可达时验证不变量（CI 无 DB 自动跳过）
PGPASSWORD="${PGPASSWORD:-cecelia}"
export PGPASSWORD
DB_HOST="${PGHOST:-localhost}"; DB_USER="${PGUSER:-cecelia}"; DB_NAME="${PGDATABASE:-cecelia}"
if psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" >/dev/null 2>&1; then
  echo "── DB 不变量 ──"
  legacy=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc \
    "SELECT count(*) FROM okr_initiatives WHERE status IN ('active','in_progress','pending','planning','completed')")
  [[ "$legacy" == "0" ]] \
    && ok "okr_initiatives 无残留旧 in-flight 值" \
    || fail "okr_initiatives 仍有 $legacy 行旧 in-flight 值"

  ck=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc \
    "SELECT count(*) FROM pg_constraint WHERE conrelid='okr_initiatives'::regclass AND conname='okr_initiatives_status_check'")
  [[ "$ck" == "1" ]] \
    && ok "CHECK 约束 okr_initiatives_status_check 已生效" \
    || fail "CHECK 约束缺失"
else
  echo "ℹ️  DB 不可达（CI 环境），跳过 DB 不变量检查"
fi

echo ""
echo "smoke 结果：PASS=$PASS FAIL=$FAIL"
[[ "$FAIL" == "0" ]] || exit 1
