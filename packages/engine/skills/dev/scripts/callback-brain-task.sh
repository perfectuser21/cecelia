#!/usr/bin/env bash
# callback-brain-task.sh — PR merged 后回写 Brain task status=completed
#
# 闭环原则：CLAUDE.md §8 「任务完成后必须回写」。审计发现最近 5 PR
# status 回写率 0/5（engine-ship SKILL 只在文档建议，不真调 curl）。
# 本脚本是真实调用入口，由 engine-ship 在 ship 阶段 invoke。
#
# 用法：
#   bash callback-brain-task.sh                                  # 自动从 .dev-mode 读 task_id + branch
#   bash callback-brain-task.sh --task-id abc --pr 123          # 显式
#   bash callback-brain-task.sh --dry-run                        # 只打印不调

set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
TASK_ID=""
PR_NUMBER=""
BRANCH_NAME=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --task-id) TASK_ID="$2"; shift 2 ;;
    --pr) PR_NUMBER="$2"; shift 2 ;;
    --branch) BRANCH_NAME="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) shift ;;
  esac
done

# 从 .dev-mode.<branch> 自动读取（v5.0.0 per-branch 格式）
if [[ -z "$BRANCH_NAME" ]]; then
  BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
fi
DEV_MODE_FILE=".dev-mode.${BRANCH_NAME}"
[[ ! -f "$DEV_MODE_FILE" ]] && DEV_MODE_FILE=".dev-mode"

if [[ -z "$TASK_ID" && -f "$DEV_MODE_FILE" ]]; then
  TASK_ID=$(grep "^task_id:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "")
fi

# 无 task_id（手动 /dev、harness 任务、orphan PR）→ skip 静默退出，不算失败
if [[ -z "$TASK_ID" ]]; then
  echo "[callback-brain-task] no task_id in $DEV_MODE_FILE — skip (manual /dev or harness task)"
  exit 0
fi

# Brain 不可达 → warn 但不 fail（不阻 ship）
if ! curl -sf -m 3 "$BRAIN_URL/api/brain/health" >/dev/null 2>&1; then
  echo "[callback-brain-task] Brain unreachable at $BRAIN_URL — skip (non-fatal)"
  exit 0
fi

# 构造 payload
PR_FIELD=""
if [[ -n "$PR_NUMBER" ]]; then
  PR_URL="https://github.com/perfectuser21/cecelia/pull/${PR_NUMBER}"
  PR_FIELD=",\"pr_url\":\"${PR_URL}\""
fi

PAYLOAD=$(cat <<EOF
{
  "status": "completed",
  "result": {
    "merged": true,
    "branch": "${BRANCH_NAME}"${PR_FIELD},
    "callback_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "callback_source": "engine-ship/callback-brain-task.sh"
  }
}
EOF
)

if [[ "$DRY_RUN" == "true" ]]; then
  echo "[callback-brain-task] DRY RUN — would PATCH $BRAIN_URL/api/brain/tasks/$TASK_ID"
  echo "$PAYLOAD"
  exit 0
fi

# 真实调用
HTTP_CODE=$(curl -s -o /tmp/callback-brain-task.out -w '%{http_code}' \
  -X PATCH "$BRAIN_URL/api/brain/tasks/${TASK_ID}" \
  -H 'Content-Type: application/json' \
  -d "$PAYLOAD" || echo "000")

if [[ "$HTTP_CODE" == "200" ]]; then
  echo "[callback-brain-task] ✅ Brain task ${TASK_ID:0:8} marked completed (PR #${PR_NUMBER:-?})"
else
  echo "[callback-brain-task] ⚠️ Brain PATCH failed (HTTP $HTTP_CODE) — non-fatal:"
  cat /tmp/callback-brain-task.out 2>/dev/null | head -5
fi

exit 0
