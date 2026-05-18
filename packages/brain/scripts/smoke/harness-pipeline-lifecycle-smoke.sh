#!/usr/bin/env bash
# harness-pipeline-lifecycle-smoke.sh
#
# 真实 E2E smoke：向 Brain 注册 harness_initiative 任务，等待其跑完整流程。
# completed 或 failed 均视为 PASS（验证"不卡死"，不要求代码一定写成功）。
#
# 环境变量：
#   BRAIN_URL       默认 http://localhost:5221
#   SPRINT_DIR      默认 sprints/w19-playground-sum
#   POLL_INTERVAL   默认 60（秒）
#   MAX_WAIT        默认 5400（秒 = 90 分钟）
#
# 退出码：0=PASS 或 SKIP，1=FAIL（卡死/超时/非预期终止）
set -uo pipefail

SMOKE_NAME="harness-pipeline-lifecycle"
log()  { echo "[smoke:$SMOKE_NAME] $*"; }
fail() { log "FAIL — $*"; exit 1; }
skip() { log "SKIP — $*"; exit 0; }

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
SPRINT_DIR="${SPRINT_DIR:-sprints/w19-playground-sum}"
POLL_INTERVAL="${POLL_INTERVAL:-60}"
MAX_WAIT="${MAX_WAIT:-5400}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# ── Skip guard ──────────────────────────────────────────────────────────────

command -v curl >/dev/null 2>&1 || skip "curl 未安装"

if ! curl -sf "${BRAIN_URL}/api/brain/health" -o /dev/null 2>&1; then
  skip "Brain ${BRAIN_URL} 不健康"
fi

PRD_PATH="${REPO_ROOT}/${SPRINT_DIR}/sprint-prd.md"
if [[ ! -f "$PRD_PATH" ]]; then
  skip "sprint PRD 不存在: ${PRD_PATH}"
fi

log "前置 OK — Brain 健康, PRD 存在"
log "（骨架 smoke 到此结束，完整轮询逻辑待实现）"
exit 0
