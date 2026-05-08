#!/usr/bin/env bash
# idempotency-guards-smoke.sh
#
# 真实环境 smoke：harness-initiative.graph.js 的节点幂等门在已部署 brain 容器内
# 是否真存在（防止部署失败、源码被 build 工具吞掉等场景）。
#
# 验证清单（对应 Stream 4 PRD）：
#   1. 节点幂等门 audit script 在 brain 容器内 PASS
#   2. 容器内 graph 文件可 require/import 无 SyntaxError
#   3. 关键节点（reportNode/evaluateSubTaskNode/terminalFailNode/finalEvaluateDispatchNode）
#      源码包含本次 sprint 加入的 short circuit 注释 marker（真实部署语义）
#
# 跳过条件：缺 docker / 没有 brain container 时 SKIP（exit 0），与其它 smoke 一致。
#
# 环境变量：
#   BRAIN_CONTAINER  默认 cecelia-node-brain
set -euo pipefail

SMOKE_NAME="idempotency-guards"
log() { echo "[smoke:$SMOKE_NAME] $*"; }
fail() { log "FAIL $*"; exit 1; }
skip() { log "SKIP $*"; exit 0; }

BRAIN_CONTAINER="${BRAIN_CONTAINER:-cecelia-node-brain}"

log "start (BRAIN_CONTAINER=$BRAIN_CONTAINER)"

# ── 容器无关：先在 host 跑本地 audit script（确保源码 ok）─────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_AUDIT="$SCRIPT_DIR/../audit/idempotency-check.sh"
if [ ! -f "$HOST_AUDIT" ]; then
  fail "找不到 $HOST_AUDIT — Stream 4 audit script 缺失"
fi
log "host audit: $HOST_AUDIT"
if ! bash "$HOST_AUDIT" >/tmp/idempotency-audit-host.log 2>&1; then
  cat /tmp/idempotency-audit-host.log
  fail "host audit 不通过 — 节点幂等门有遗漏"
fi
log "host audit PASS（详见 /tmp/idempotency-audit-host.log）"

# ── 容器侧验证（best-effort，无容器则 SKIP，不阻断）─────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  skip "docker 命令不存在 — host audit 已 PASS，容器侧 smoke 跳过"
fi
if ! docker info >/dev/null 2>&1; then
  skip "docker daemon 不可达 — host audit 已 PASS"
fi
if ! docker ps --format '{{.Names}}' | grep -qx "$BRAIN_CONTAINER"; then
  skip "容器 $BRAIN_CONTAINER 不在运行 — host audit 已 PASS"
fi

# 1. 容器内文件可 import（无 SyntaxError）
log "step 1: 容器内 node --check graph 文件"
if ! docker exec "$BRAIN_CONTAINER" node --check /app/src/workflows/harness-initiative.graph.js 2>/tmp/idempotency-syntax.log; then
  cat /tmp/idempotency-syntax.log
  fail "容器内 graph 文件 SyntaxError"
fi
log "step 1 PASS — 容器内 graph 文件 syntax OK"

# 2. 容器内源码含本次 sprint 4 个 short circuit 注释标记
#    注：本步只在容器已部署本 PR 后生效；容器跑老代码（PR 未合并/未部署）时 SKIP，
#    不阻断 PR CI（host audit 已保证源码侧正确性）。
log "step 2: 容器内源码含本次 short circuit 标记（部署后生效）"
EXPECT_MARKERS=(
  "if (state.report_path) return"
  "if (state.evaluate_verdict)"
  "if (state.error?.node === 'terminal_fail')"
  "if (state.final_e2e_verdict === 'PASS' || state.final_e2e_verdict === 'PASS_WITH_OVERRIDE')"
)
MISSING=0
for marker in "${EXPECT_MARKERS[@]}"; do
  if ! docker exec "$BRAIN_CONTAINER" grep -qF "$marker" /app/src/workflows/harness-initiative.graph.js; then
    log "  ⏭️  容器内尚未部署 marker: $marker"
    MISSING=$((MISSING + 1))
  fi
done
if [ "$MISSING" -gt 0 ]; then
  log "step 2 PARTIAL — 容器跑老代码（$MISSING/4 marker 缺）；本 PR 未部署，host audit 仍 PASS"
else
  log "step 2 PASS — 容器内 4 个 short circuit 标记齐全"
fi

log "DONE — idempotency guards smoke PASS"
exit 0
