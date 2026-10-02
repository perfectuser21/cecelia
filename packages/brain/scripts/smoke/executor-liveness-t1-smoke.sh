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
    && ok "EXECUTOR_CONTRACTS 十二合同结构正确" \
    || fail "executor-contracts.js 导入/结构检查失败"
import { EXECUTOR_CONTRACTS, VALID_EXECUTOR_KINDS, assessTaskLiveness } from '${CONTRACTS_JS}';
// PR1-B 由七增八：openclaw-agent = 秋米中文 GTD 任务的执行者（Brain 经 ssh 在 MMV 起 agent）
// 棒3 由八增九：script = executor=script 一等任务类型（Brain 经 ssh 在跑场机执行确定性脚本）
const EXPECTED = ['brain-local','relay-container','kernel-process','headed-session','bridge','external-worker','codex-review-local','openclaw-agent','script','preview-janitor','app-server-controller','image-janitor','phone-ssh-controller','linux-pool-controller'];
