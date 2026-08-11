#!/usr/bin/env bash
# Smoke: GP锚定闭环刀4 — Brain层gp_anchor硬校验 + harness-judge.js机械核对
#
# 3 层验证：
#   L1 (静态)  : executor.js 的 _driveHarnessInitiative 含 gp_anchor 硬校验锚点
#                （missing_gp_anchor 判断先于 spawnSkillRelaySession 分支）；
#                harness-judge.js 的 runMechanicalGate 含 GP-Anchor 一致性核查锚点
#   L2 (gate)  : Brain 健康 + DB 可连；不可达 SKIP exit 0 with reason
#   L3 (真验)  : INSERT 一个 base_repo=zenithjoy-workspace 且无 gp_anchor 的
#                harness_initiative task → 真调 runHarnessInitiativeRouter →
#                断言立即 terminal failed → SELECT tasks.status/failure_class
#                确认落库 → cleanup
#
# 不覆盖：base_repo 不含 zenithjoy-workspace 的零回归路径——已由
# packages/brain/src/__tests__/harness-orchestrator-lockdown.test.js SC-209 单测覆盖。
set -euo pipefail

EXECUTOR_FILE="packages/brain/src/executor.js"
JUDGE_FILE="packages/brain/src/harness-judge.js"
BRAIN="${BRAIN_URL:-http://localhost:5221}"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"

# ── L1 静态断言（无网络，永远跑）─────────────────────────────────────────
echo "[smoke] L1: 静态拓扑断言"
test -f "$EXECUTOR_FILE" || { echo "[smoke] L1 FAIL: $EXECUTOR_FILE 不存在"; exit 1; }
test -f "$JUDGE_FILE" || { echo "[smoke] L1 FAIL: $JUDGE_FILE 不存在"; exit 1; }

node -e "
const fs=require('fs');
const src=fs.readFileSync('$EXECUTOR_FILE','utf8');
const fnMatch=src.match(/async function _driveHarnessInitiative[\s\S]*?\n}\n/);
if(!fnMatch){console.error('_driveHarnessInitiative 函数找不到');process.exit(1)}
const body=fnMatch[0];
const guardIdx=body.indexOf('missing_gp_anchor');
const relayIdx=body.indexOf('spawnSkillRelaySession');
if(guardIdx===-1){console.error('L1 FAIL: 缺 missing_gp_anchor 硬校验锚点');process.exit(1)}
if(relayIdx===-1){console.error('L1 FAIL: spawnSkillRelaySession 分支找不到');process.exit(1)}
if(guardIdx>=relayIdx){console.error('L1 FAIL: gp_anchor 硬校验必须先于 spawnSkillRelaySession 分支');process.exit(1)}
if(!body.includes('zenithjoy-workspace')){console.error('L1 FAIL: 缺 base_repo 限定zenithjoy-workspace的scope判断');process.exit(1)}
console.log('[smoke] L1a PASS: gp_anchor 硬校验先于 skill-relay 分支，且按 base_repo 限定范围');
" || exit 1

node -e "
const fs=require('fs');
const src=fs.readFileSync('$JUDGE_FILE','utf8');
if(!src.includes('gp_anchor_missing')){console.error('L1 FAIL: runMechanicalGate 缺 gp_anchor_missing 检查锚点');process.exit(1)}
if(!src.includes('gp_anchor_id_notfound')){console.error('L1 FAIL: runMechanicalGate 缺 gp_anchor_id_notfound 检查锚点');process.exit(1)}
if(!src.includes('product-map/generated/product-map.json')){console.error('L1 FAIL: 缺file-existence gated的product-map.json路径引用');process.exit(1)}
console.log('[smoke] L1b PASS: runMechanicalGate 含 GP-Anchor 一致性核查锚点（file-existence gated）');
" || exit 1

# ── L2 Brain health gate ───────────────────────────────────────────────
if ! curl -sf "$BRAIN/api/brain/health" >/dev/null 2>&1; then
  echo "[smoke] L2 SKIP: Brain 不可达（$BRAIN）— L1 静态已 PASS，L3 跳过"
  exit 0
fi
echo "[smoke] L2 PASS: Brain healthy"

# ── L3 真环境验证 ─────────────────────────────────────────────────────
if ! command -v psql >/dev/null 2>&1; then
  echo "[smoke] L3 SKIP: psql 不可用，L3 跳过（L1 静态已 PASS）"
  exit 0
fi

if ! psql "$DB" -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "[smoke] L3 SKIP: DB 连接失败（$DB 凭据/host 不对，CI env 缺 DATABASE_URL）；L1 静态已 PASS"
  exit 0
fi

TID=$(uuidgen 2>/dev/null | tr 'A-Z' 'a-z' || node -e "console.log(require('crypto').randomUUID())")
echo "[smoke] L3: task=${TID}, base_repo=zenithjoy-workspace, no gp_anchor"

cleanup() {
  psql "$DB" -tAc "DELETE FROM tasks WHERE id='$TID'::uuid" >/dev/null 2>&1 || true
}
trap cleanup EXIT

psql "$DB" -tAc "INSERT INTO tasks(id, title, status, task_type, priority, payload, created_at, updated_at) VALUES ('$TID'::uuid, '[smoke] gp-anchor lockdown', 'in_progress', 'harness_initiative', 'P2', '{\"orchestrator\":\"skill-relay\",\"base_repo\":\"https://github.com/perfectuser21/zenithjoy-workspace.git\"}'::jsonb, NOW(), NOW())" >/dev/null

RESULT=$(node --input-type=module -e "
import { runHarnessInitiativeRouter } from './packages/brain/src/executor.js';
import pg from 'pg';
const pool = new pg.Pool({ connectionString: '$DB' });
const { rows } = await pool.query(\"SELECT * FROM tasks WHERE id='$TID'::uuid\");
const task = rows[0];
task.payload = task.payload || {};
const result = await runHarnessInitiativeRouter(task, { pool });
console.log(JSON.stringify(result));
await pool.end();
" 2>&1 | tail -1)

echo "[smoke] router 返回: $RESULT"

node -e "
const r = JSON.parse(process.argv[1]);
if (r.ok !== false) { console.error('L3 FAIL: 期望 ok=false，实际', r.ok); process.exit(1); }
if (r.terminal !== true) { console.error('L3 FAIL: 期望 terminal=true，实际', r.terminal); process.exit(1); }
if (r.error !== 'missing_gp_anchor') { console.error('L3 FAIL: 期望 error=missing_gp_anchor，实际', r.error); process.exit(1); }
console.log('[smoke] L3 PASS: base_repo含zenithjoy-workspace且无gp_anchor的harness_initiative被立即terminal failed');
" "$RESULT" || exit 1

STATUS=$(psql "$DB" -tAc "SELECT status FROM tasks WHERE id='$TID'::uuid")
FAILURE_CLASS=$(psql "$DB" -tAc "SELECT result->>'failure_class' FROM tasks WHERE id='$TID'::uuid")

if [[ "$STATUS" != "failed" ]]; then
  echo "[smoke] L3 FAIL: tasks.status='$STATUS' (期望 'failed')"
  exit 1
fi
if [[ "$FAILURE_CLASS" != "missing_gp_anchor" ]]; then
  echo "[smoke] L3 FAIL: failure_class='$FAILURE_CLASS' (期望 'missing_gp_anchor')"
  exit 1
fi

echo "[smoke] L3 PASS: tasks.status='failed' + failure_class='missing_gp_anchor' 真落库"
echo "[smoke] gp-anchor-lockdown OK (L1+L2+L3)"
exit 0
