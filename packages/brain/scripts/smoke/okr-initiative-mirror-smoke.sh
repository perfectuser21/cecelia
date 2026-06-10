#!/usr/bin/env bash
# okr-initiative-mirror-smoke.sh
# 验收（PR 2b-2b）：harness → okr_initiatives 活态镜像
#   1. okr-initiative-sync.js 导出 resolveOrCreateOkrInitiative + syncOkrInitiativeStatus，
#      且 syncOkrInitiativeStatus 拒绝非法生命周期值（防写坏 299 CHECK）
#   2. 接线点存在：executor 起点 sync running、reportNode sync done/failed
#   3. (DB 可达) 活态镜像不变量：harness_live 来源的 okr_initiatives status 均合法
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SYNC="$ROOT/src/okr-initiative-sync.js"
EXEC="$ROOT/src/executor.js"
GRAPH="$ROOT/src/workflows/harness-initiative.graph.js"
PASS=0; FAIL=0
ok()   { echo "✅ $1"; ((PASS++)) || true; }
fail() { echo "❌ $1"; ((FAIL++)) || true; }

# 1. helper 导出 + 非法值防护（node 加载真实模块逻辑，不连 DB）
echo "── helper 导出与防护 ──"
node -e "
const m = require('$SYNC');
" 2>/dev/null
# ESM 模块用动态 import 检查
node --input-type=module -e "
import('file://$SYNC').then(async (m) => {
  if (typeof m.resolveOrCreateOkrInitiative !== 'function') { console.error('缺 resolveOrCreateOkrInitiative'); process.exit(1); }
  if (typeof m.syncOkrInitiativeStatus !== 'function') { console.error('缺 syncOkrInitiativeStatus'); process.exit(1); }
  // 非法生命周期值必须抛错（mock pool 不会被触达，先撞校验）
  let threw = false;
  try { await m.syncOkrInitiativeStatus({ query: async () => ({rows:[]}) }, 'x', 'active'); } catch { threw = true; }
  if (!threw) { console.error('非法 status 未抛错'); process.exit(1); }
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
" && ok "helper 导出两函数 + 拒绝非法生命周期值" || fail "helper 导出/防护不符"

# 2. 接线点存在（grep 源码）
echo "── 接线点 ──"
node -e "
const fs=require('fs');
const ex=fs.readFileSync('$EXEC','utf8');
const gr=fs.readFileSync('$GRAPH','utf8');
const checks=[
  [ex.includes(\"syncOkrInitiativeStatus(dbPool, task.id, 'running')\"), 'executor 起点 sync running'],
  [ex.includes(\"syncOkrInitiativeStatus(dbPool, taskId, 'failed')\"), 'markInitiativeTerminalFailed sync failed'],
  [gr.includes('syncOkrInitiativeStatus(client, state.initiativeId'), 'reportNode sync done/failed'],
  [gr.includes('okr_initiative_id') && gr.includes('harness_initiative_migration_map'), 'initiative_runs 回填 okr_initiative_id'],
];
const miss=checks.filter(c=>!c[0]).map(c=>c[1]);
if(miss.length){console.error('缺接线: '+miss.join('; '));process.exit(1)}
" && ok "executor/graph 四处接线齐全（均 non-fatal）" || fail "接线点缺失"

# 3. DB 不变量（CI 无 DB 自动跳过）
PGPASSWORD="${PGPASSWORD:-cecelia}"; export PGPASSWORD
DB_HOST="${PGHOST:-localhost}"; DB_USER="${PGUSER:-cecelia}"; DB_NAME="${PGDATABASE:-cecelia}"
if psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" >/dev/null 2>&1; then
  echo "── DB 不变量 ──"
  bad=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT count(*) FROM okr_initiatives WHERE custom_props->>'source'='harness_live' AND status NOT IN ('planned','queued','running','done','failed','archived','cancelled')")
  [[ "$bad" == "0" ]] && ok "harness_live 镜像行 status 均合法" || fail "$bad 行非法 status"
else
  echo "ℹ️  DB 不可达（CI 环境），跳过 DB 不变量检查"
fi

echo ""
echo "smoke 结果：PASS=$PASS FAIL=$FAIL"
[[ "$FAIL" == "0" ]] || exit 1
