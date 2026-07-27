#!/usr/bin/env bash
# executor-liveness-t1-smoke.sh
# T1 executor_kind 列 + executor-contracts 合同模块冒烟验证
#
# 验证：
#   1. executor-contracts.js 可被 Node 解析（EXECUTOR_CONTRACTS 五合同导出正确）
#   2. external-worker probe 永远 alive
#   3. null executor_kind → fail-open（不抛异常）
#   4. EXECUTOR_KIND_FOR 打标映射含关键 key
# Brain 在线时额外验证 tasks API 响应结构

set -euo pipefail
BRAIN="${BRAIN_URL:-http://localhost:5221}"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }
skip() { echo "  ⏭  $1 (跳过)"; }

echo "── executor-liveness T1 smoke ──"

# 探测 Brain 是否在线（非必须）
BRAIN_ONLINE=false
curl -sf --max-time 3 "$BRAIN/api/brain/context" >/dev/null 2>&1 && BRAIN_ONLINE=true || true

if $BRAIN_ONLINE; then
  ok "Brain /api/brain/context 可达"
  # tasks API 响应 executor_kind 字段
  tasks=$(curl -sf "$BRAIN/api/brain/tasks?limit=1" 2>/dev/null) || tasks="[]"
  if echo "$tasks" | python3 -c "
import sys,json
d=json.load(sys.stdin)
ts=(d.get('tasks') or []) if isinstance(d,dict) else (d if isinstance(d,list) else [])
if ts and 'executor_kind' in ts[0]: raise SystemExit(0)
raise SystemExit(1)
" 2>/dev/null; then
    ok "in_progress 任务含 executor_kind 字段"
  else
    skip "无 in_progress 任务，字段检查跳过"
  fi
else
  skip "Brain 离线 — 跳过 API 检查（CI 无 DB 时正常）"
fi

# 静态检查：executor-contracts.js 六合同结构
# （2026-07-27 由五增六：kernel-process = Kernel v1 的裸 Node 进程，不是 docker 容器）
REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
CONTRACTS_JS="$REPO_ROOT/packages/brain/src/executor-contracts.js"

if [[ ! -f "$CONTRACTS_JS" ]]; then
  fail "executor-contracts.js 不存在: $CONTRACTS_JS"
else
  node --input-type=module <<EOF 2>/dev/null \
    && ok "EXECUTOR_CONTRACTS 六合同结构正确" \
    || fail "executor-contracts.js 导入/结构检查失败"
import { EXECUTOR_CONTRACTS, VALID_EXECUTOR_KINDS, assessTaskLiveness } from '${CONTRACTS_JS}';
const EXPECTED = ['brain-local','relay-container','kernel-process','headed-session','bridge','external-worker'];
if (VALID_EXECUTOR_KINDS.length !== 6) throw new Error('VALID_EXECUTOR_KINDS 长度不对');
for (const k of EXPECTED) {
  const c = EXECUTOR_CONTRACTS[k];
  if (!c) throw new Error('missing contract: ' + k);
  if (typeof c.probe !== 'function') throw new Error('probe not fn: ' + k);
  if (!('staleMinutes' in c)) throw new Error('missing staleMinutes: ' + k);
  if (typeof c.onStale !== 'string') throw new Error('onStale not string: ' + k);
}
if (typeof assessTaskLiveness !== 'function') throw new Error('assessTaskLiveness not exported');
EOF

  # external-worker probe 永远 alive
  node --input-type=module <<EOF 2>/dev/null \
    && ok "external-worker probe 返回 alive" \
    || fail "external-worker probe 异常"
import { EXECUTOR_CONTRACTS } from '${CONTRACTS_JS}';
const r = await EXECUTOR_CONTRACTS['external-worker'].probe(null, null);
if (r !== 'alive') throw new Error('expected alive, got ' + r);
EOF

  # null executor_kind fail-open
  node --input-type=module <<EOF 2>/dev/null \
    && ok "null executor_kind fail-open 不抛" \
    || fail "null executor_kind 处理异常"
import { assessTaskLiveness } from '${CONTRACTS_JS}';
const r = await assessTaskLiveness({ id: 'smoke-test', executor_kind: null }, {});
if (r.verdict !== 'unknown') throw new Error('expected unknown, got ' + r.verdict);
if (r.reason !== 'no_executor_kind') throw new Error('wrong reason: ' + r.reason);
EOF

  # EXECUTOR_KIND_FOR 打标映射
  node --input-type=module <<EOF 2>/dev/null \
    && ok "EXECUTOR_KIND_FOR 打标映射含关键 key" \
    || fail "EXECUTOR_KIND_FOR 映射缺失"
import { EXECUTOR_KIND_FOR } from '${CONTRACTS_JS}';
const checks = {
  'harness_initiative': 'relay-container',
  'dev': 'brain-local',
  'content-pipeline': 'external-worker',
  '__bridge_path': 'bridge',
  '__local_spawn': 'brain-local',
};
for (const [k,v] of Object.entries(checks)) {
  if (EXECUTOR_KIND_FOR[k] !== v) throw new Error(k + ' → ' + EXECUTOR_KIND_FOR[k] + ' (expected ' + v + ')');
}
EOF

  # kernel-process：按 payload.harness_runtime 分派 + 判活 fail-open（事故 51836fb2）
  node --input-type=module <<EOF 2>/dev/null \
    && ok "kernel-v1 任务解析为 kernel-process 且判活 fail-open" \
    || fail "kernel-process 分派/fail-open 异常"
import { resolveExecutorKind, resolveLivenessKind, assessTaskLiveness, EXECUTOR_CONTRACTS } from '${CONTRACTS_JS}';
const kt = { id: 'smoke-kernel', task_type: 'harness_initiative', payload: { harness_runtime: 'kernel-v1' } };
if (resolveExecutorKind(kt) !== 'kernel-process') throw new Error('打标点未分派 kernel-process');
if (resolveLivenessKind({ ...kt, executor_kind: 'relay-container' }) !== 'kernel-process') {
  throw new Error('存量 relay-container 误标未被判活点纠正');
}
if (resolveExecutorKind({ task_type: 'harness_initiative', payload: {} }) !== 'relay-container') {
  throw new Error('旧 relay 路径被改变');
}
const c = EXECUTOR_CONTRACTS['kernel-process'];
if (c.onStale !== EXECUTOR_CONTRACTS['relay-container'].onStale) throw new Error('kernel-process 比 relay-container 更容易被杀');
// 无 pool → 必须 unknown（fail-open），绝不能 dead
const r = await assessTaskLiveness({ ...kt, executor_kind: 'relay-container' }, { pool: null, allowDefaultPool: false });
if (r.verdict !== 'unknown') throw new Error('无 pool 时应 fail-open unknown，实际 ' + r.verdict);
EOF
fi

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
