#!/usr/bin/env bash
# harness-initiative-migrate-smoke.sh
# 验收（PR 2b-2a）：harness_initiative → okr_initiatives 纯加数据迁移（migration 300）
# 用相对不变量（不写死行数，CI 空库也成立）：
#   1. migration 300 文件存在且为纯加（映射表 + INSERT okr_initiatives + ADD COLUMN）
#   2. (DB 可达) 每个 harness 任务都有映射；映射均指向存在的 okr_initiative；
#      每个指向 harness 任务的 run 都已回填 okr_initiative_id
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG="$ROOT/migrations/300_harness_initiative_migrate_additive.sql"
PASS=0; FAIL=0
ok()   { echo "✅ $1"; ((PASS++)) || true; }
fail() { echo "❌ $1"; ((FAIL++)) || true; }

# 1. migration 文件结构（node 读文件，CI 无 DB 也跑）
echo "── migration 300 结构 ──"
node -e "
const fs=require('fs');
const raw=fs.readFileSync('$MIG','utf8');
const need=['CREATE TABLE IF NOT EXISTS harness_initiative_migration_map','INSERT INTO okr_initiatives','ADD COLUMN IF NOT EXISTS okr_initiative_id','harness_migration_2b2a'];
const miss=need.filter(s=>!raw.includes(s));
if(miss.length){console.error('缺失: '+miss.join(', '));process.exit(1)}
// 纯加守卫：剥离 -- 注释行后，可执行语句不得含破坏性操作
const code=raw.split('\n').filter(l=>!l.trim().startsWith('--')).join('\n');
const danger=[/DELETE\s+FROM/i,/DROP\s+TABLE(?!\s+IF)/i,/UPDATE\s+tasks/i];
const hit=danger.filter(r=>r.test(code));
if(hit.length){console.error('含破坏性语句，违反纯加');process.exit(1)}
" && ok "migration 300 含映射表+INSERT+ADD COLUMN，无破坏性语句" \
  || fail "migration 300 结构不符或含破坏性语句"

# 2. DB 不变量（CI 无 DB 自动跳过）
PGPASSWORD="${PGPASSWORD:-cecelia}"; export PGPASSWORD
DB_HOST="${PGHOST:-localhost}"; DB_USER="${PGUSER:-cecelia}"; DB_NAME="${PGDATABASE:-cecelia}"
q() { psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "$1" 2>/dev/null; }
if psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" >/dev/null 2>&1; then
  echo "── DB 不变量 ──"

  unmapped=$(q "SELECT count(*) FROM tasks t WHERE t.task_type='harness_initiative' AND t.created_at < COALESCE((SELECT applied_at FROM schema_version WHERE version='300'), 'infinity'::timestamptz) AND NOT EXISTS (SELECT 1 FROM harness_initiative_migration_map m WHERE m.harness_task_id=t.id)")
  [[ "$unmapped" == "0" ]] && ok "migration 300 之前的 harness_initiative 均已映射（未映射=0）" || fail "$unmapped 个存量 harness 任务未映射"

  badmap=$(q "SELECT count(*) FROM harness_initiative_migration_map m WHERE NOT EXISTS (SELECT 1 FROM okr_initiatives o WHERE o.id=m.okr_initiative_id)")
  [[ "$badmap" == "0" ]] && ok "映射均指向存在的 okr_initiative（悬空=0）" || fail "$badmap 条映射悬空"

  unfilled=$(q "SELECT count(*) FROM initiative_runs ir JOIN harness_initiative_migration_map m ON ir.initiative_id=m.harness_task_id WHERE ir.okr_initiative_id IS NULL")
  [[ "$unfilled" == "0" ]] && ok "指向 harness 任务的 run 均已回填 okr_initiative_id（未回填=0）" || fail "$unfilled 个 run 未回填"

  badstatus=$(q "SELECT count(*) FROM okr_initiatives WHERE custom_props->>'source'='harness_migration_2b2a' AND status NOT IN ('planned','queued','running','done','failed','archived','cancelled')")
  [[ "$badstatus" == "0" ]] && ok "迁移行 status 均为合法生命周期值" || fail "$badstatus 行非法 status"
else
  echo "ℹ️  DB 不可达（CI 环境），跳过 DB 不变量检查"
fi

echo ""
echo "smoke 结果：PASS=$PASS FAIL=$FAIL"
[[ "$FAIL" == "0" ]] || exit 1
