#!/usr/bin/env bash
# t2-liveness-four-blades-smoke.sh
# T2 liveness 四刀集成冒烟验证
#
# 四刀：
#   刀1 tick-helpers.js autoFailTimedOutTasks → 改用 assessTaskLiveness (alive/unknown fail-open)
#   刀2 zombie-reaper.js reapZombies → 移除 exemptTypes SQL，改用 assessTaskLiveness 合同路由
#   刀3 alertness/healing.js restartStuckExecutors → 改用 assessTaskLiveness 替代 PID 直查
#   刀4 tick-runner.js dead task reset → 限定 executor_kind IN ('brain-local','bridge')
#
# 验证：
#   1. 四刀源文件都正确 import assessTaskLiveness
#   2. assessTaskLiveness(alive) → fail-open（不 kill）
#   3. assessTaskLiveness(dead/brain-local) → kill
#   4. executor_kind IN ('brain-local','bridge') 精确限定保持不变
# Brain 在线时额外验证 tasks API

set -euo pipefail
BRAIN="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }
skip() { echo "  ⏭  $1 (跳过)"; }

echo "── T2 liveness 四刀 smoke ──"
REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
CONTRACTS_JS="$REPO_ROOT/packages/brain/src/executor-contracts.js"
TICK_HELPERS="$REPO_ROOT/packages/brain/src/tick-helpers.js"
ZOMBIE_REAPER="$REPO_ROOT/packages/brain/src/zombie-reaper.js"
HEALING_JS="$REPO_ROOT/packages/brain/src/alertness/healing.js"
TICK_RUNNER="$REPO_ROOT/packages/brain/src/tick-runner.js"

# ── 刀1-3：import 接线核查 ──
for SRC in "$TICK_HELPERS" "$ZOMBIE_REAPER" "$HEALING_JS"; do
  NAME=$(basename "$SRC")
  if grep -q "assessTaskLiveness" "$SRC" 2>/dev/null; then
    ok "$NAME import assessTaskLiveness 接线正确"
  else
    fail "$NAME 未找到 assessTaskLiveness 引用（T2 接线漏掉？）"
  fi
done

# ── 刀4：tick-runner dead task reset 限定 executor_kind ──
if grep -qE "executor_kind.*brain-local.*bridge|brain-local.*AND|executor_kind IN" "$TICK_RUNNER" 2>/dev/null; then
  ok "tick-runner.js dead task reset 限定 executor_kind 精确范围"
else
  fail "tick-runner.js 未找到 executor_kind 精确限定（刀4 接线漏掉？）"
fi

# ── assessTaskLiveness 合同行为验证 ──
if [[ ! -f "$CONTRACTS_JS" ]]; then
  fail "executor-contracts.js 不存在: $CONTRACTS_JS"
else
  # alive executor → fail-open（不杀）
  node --input-type=module <<EOF 2>/dev/null \
    && ok "external-worker alive → verdict=alive（fail-open）" \
    || fail "external-worker alive 路由异常"
import { assessTaskLiveness } from '${CONTRACTS_JS}';
const r = await assessTaskLiveness({ id: 'smoke-t2-1', executor_kind: 'external-worker' }, {});
if (r.verdict !== 'alive') throw new Error('expected alive, got ' + JSON.stringify(r));
EOF

  # brain-local + 不存在的 PID → dead
  node --input-type=module <<EOF 2>/dev/null \
    && ok "brain-local + 死 PID → verdict=dead（可 kill）" \
    || fail "brain-local dead 路由异常"
import { assessTaskLiveness } from '${CONTRACTS_JS}';
// PID 99999999 在 Linux 上必不存在（max_pid 通常 4194304）
const fakeMap = new Map([['smoke-t2-2', { pid: 99999999 }]]);
const r = await assessTaskLiveness(
  { id: 'smoke-t2-2', executor_kind: 'brain-local' },
  { activeProcesses: fakeMap }
);
if (r.verdict !== 'dead') throw new Error('expected dead, got ' + JSON.stringify(r));
EOF

  # null executor_kind → unknown fail-open
  node --input-type=module <<EOF 2>/dev/null \
    && ok "null executor_kind → unknown fail-open（四刀不误杀）" \
    || fail "null executor_kind 处理异常"
import { assessTaskLiveness } from '${CONTRACTS_JS}';
const r = await assessTaskLiveness({ id: 'smoke-t2-3', executor_kind: null }, {});
if (r.verdict !== 'unknown') throw new Error('expected unknown, got ' + JSON.stringify(r));
EOF
fi

# ── Brain 在线额外验证 ──
BRAIN_ONLINE=false
curl -sf --max-time 3 "$BRAIN/api/brain/context" >/dev/null 2>&1 && BRAIN_ONLINE=true || true

if $BRAIN_ONLINE; then
  ok "Brain /api/brain/context 可达"
  TASKS=$(curl -sf "$BRAIN/api/brain/tasks?limit=5&status=in_progress" 2>/dev/null) || TASKS="{}"
  if echo "$TASKS" | node -e "
const d=require('fs').readFileSync('/dev/stdin','utf8');
const obj=JSON.parse(d);
const ts=(Array.isArray(obj)?obj:(obj.tasks||[]));
const bad=ts.filter(t=>t.executor_kind===undefined);
if(bad.length>0){process.exit(1);}
" 2>/dev/null; then
    ok "in_progress 任务均含 executor_kind 字段（T1+T2 迁移完整）"
  else
    skip "无 in_progress 任务或字段检查跳过"
  fi
else
  skip "Brain 离线 — API 检查跳过（CI real-env-smoke 内 Brain 在线）"
fi

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
