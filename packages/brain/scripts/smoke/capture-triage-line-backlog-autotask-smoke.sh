#!/usr/bin/env bash
# capture-triage-line-backlog-autotask-smoke.sh — 决策57d296a1真环境验证
#
# 验证 capture-triage.js 的 line_backlog 分支真的调用 createTask 建出
# task_type='harness_initiative' 的 Brain task（而不是只标记 atom），
# 并验证生产环境护栏真的挡住了敏感条目。
#
# Case 1（结构）：isProductionSensitive / createTask 接线都在源码里
# Case 2（真环境）：插入真实 capture_atoms + 源 task → 跑 runCaptureTriage →
#                    查 tasks 表真的多出一条 harness_initiative task，
#                    atom 真的被改写为 routed_to_table='tasks'
# Case 3（真环境）：命中生产护栏关键词的 atom → 不产生新 task，仍走 journeys 标记
#
# 用法：bash capture-triage-line-backlog-autotask-smoke.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRAIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TRIAGE_SRC="$BRAIN_ROOT/src/capture-triage.js"

PASSED=0
FAILED=0
pass() { echo "  ✅ $1"; PASSED=$((PASSED+1)); }
fail() { echo "  ❌ $1"; FAILED=$((FAILED+1)); }

echo "── capture-triage line_backlog 自动建task smoke（决策57d296a1）──"

# ─── Case 1: 结构接线 ────────────────────────────────
echo "[Case 1] 源码接线：isProductionSensitive + createTask"
node -e "
const js = require('fs').readFileSync('$TRIAGE_SRC', 'utf8');
if (!/export function isProductionSensitive/.test(js)) throw new Error('缺 isProductionSensitive 导出');
if (!/import \{ createTask \} from '\.\/actions\.js'/.test(js)) throw new Error('缺 createTask import');
if (!/task_type: 'harness_initiative'/.test(js)) throw new Error('缺 harness_initiative task_type');
if (!/buildCeceliaMutationRoute/.test(js)) throw new Error('缺统一 coding route builder');
console.log('PASS');
" && pass "Case 1: 源码接线齐全" || fail "Case 1"
echo ""

# ─── Case 2/3: 真环境（DB 可达时） ────────────────────
PGHOST="${DB_HOST:-localhost}"; PGPORT="${DB_PORT:-5432}"
PGUSER="${DB_USER:-cecelia}"; PGDB="${DB_NAME:-cecelia_test}"
export PGPASSWORD="${DB_PASSWORD:-cecelia}"

if ! pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" >/dev/null 2>&1; then
  echo "  SKIP Case 2/3: DB 不可达（$PGHOST:$PGPORT），跳过真环境验证（结构校验已覆盖）"
else
  export DB_HOST="$PGHOST" DB_PORT="$PGPORT" DB_USER="$PGUSER" DB_NAME="$PGDB" DB_PASSWORD="$PGPASSWORD"
  export NODE_ENV="${NODE_ENV:-test}"
  export CECELIA_CAPTURE_TRIAGE_LLM=off

  RESULT=$(cd "$BRAIN_ROOT" && node -e "
import('./src/capture-triage.js').then(async (triage) => {
  const pool = (await import('./src/db.js')).default;
  const srcTaskId = require('crypto').randomUUID();
  const journeyId = require('crypto').randomUUID();
  const atomOkId = require('crypto').randomUUID();
  const atomProdId = require('crypto').randomUUID();
  const cleanup = async () => {
    await pool.query('DELETE FROM capture_atoms WHERE id = ANY(\$1::uuid[])', [[atomOkId, atomProdId]]);
    await pool.query("UPDATE tasks SET status='cancelled', updated_at=NOW() WHERE payload->>'thin_prd' = \$1 AND status NOT IN ('completed','cancelled')", ['smoke:决策57d296a1line_backlog真环境验证']);
    await pool.query('DELETE FROM tasks WHERE id = \$1::uuid', [srcTaskId]);
  };
  try {
    await pool.query(
      \"INSERT INTO tasks (id, title, description, priority, task_type, status, payload, trigger_source) VALUES (\$1::uuid, 'smoke源task', 'smoke', 'P2', 'dev', 'completed', \$2::jsonb, 'test')\",
      [srcTaskId, JSON.stringify({ journey_id: journeyId })]
    );
    await pool.query(
      \"INSERT INTO capture_atoms (id, content, target_type, target_subtype, routed_to_table, routed_to_id, status) VALUES (\$1::uuid, \$2, 'handoff', 'FAIL', 'tasks', \$3::uuid, 'pending_review')\",
      [atomOkId, 'smoke:决策57d296a1line_backlog真环境验证', srcTaskId]
    );
    await pool.query(
      \"INSERT INTO capture_atoms (id, content, target_type, target_subtype, routed_to_table, routed_to_id, status) VALUES (\$1::uuid, \$2, 'handoff', 'FAIL', 'tasks', \$3::uuid, 'pending_review')\",
      [atomProdId, '这是生产环境变更 smoke:决策57d296a1', srcTaskId]
    );

    triage.__resetCaptureTriageForTest();
    await triage.runCaptureTriage(pool);

    const { rows: okRows } = await pool.query('SELECT status, routed_to_table, routed_to_id, ai_reason FROM capture_atoms WHERE id = \$1::uuid', [atomOkId]);
    const okAtom = okRows[0];
    const okTaskCreated = okAtom && okAtom.status === 'confirmed' && okAtom.routed_to_table === 'tasks' && okAtom.routed_to_id !== srcTaskId;
    let okTaskRow = null;
    if (okTaskCreated) {
      const { rows } = await pool.query('SELECT task_type, priority, payload FROM tasks WHERE id = \$1::uuid', [okAtom.routed_to_id]);
      okTaskRow = rows[0];
    }
    const okTaskValid = okTaskRow && okTaskRow.task_type === 'harness_initiative' && okTaskRow.priority === 'P1' && okTaskRow.payload && okTaskRow.payload.harness_runtime === 'kernel-v1' && typeof okTaskRow.payload.routing_receipt_id === 'string';

    const { rows: prodRows } = await pool.query('SELECT status, routed_to_table, routed_to_id FROM capture_atoms WHERE id = \$1::uuid', [atomProdId]);
    const prodAtom = prodRows[0];
    const prodGuarded = prodAtom && prodAtom.status === 'confirmed' && prodAtom.routed_to_table === 'journeys' && prodAtom.routed_to_id === journeyId;

    await cleanup();
    console.log('CASE2=' + okTaskCreated + ' CASE2_TASK=' + okTaskValid + ' CASE3=' + prodGuarded);
  } catch (e) {
    await cleanup().catch(() => {});
    console.log('ERR=' + e.message);
  }
  process.exit(0);
}).catch(e => { console.log('ERR=' + e.message); process.exit(0); });
" 2>&1 | tail -5)

  echo "  $RESULT"
  if echo "$RESULT" | grep -q "CASE2=true CASE2_TASK=true CASE3=true"; then
    pass "Case 2: line_backlog 真建出 harness_initiative task，atom 改写 tasks/新id"
    pass "Case 3: 生产护栏命中 → 不建task，仍走 journeys 标记"
  else
    fail "Case 2/3: $RESULT"
  fi
fi

echo ""
echo "📊 capture-triage-line-backlog-autotask-smoke: PASSED=$PASSED FAILED=$FAILED"
exit "$FAILED"
