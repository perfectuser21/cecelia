#!/usr/bin/env bash
# ship-finalize.sh — engine-ship 调用：写 done-marker + SIGTERM guardian
# 用法：ship-finalize.sh <branch> <pr_number> <pr_url>
#
# 行为：
#   1. 找 .cecelia/lights/<sid_short>-<branch>.live
#   2. 读 guardian_pid，发 SIGTERM（guardian trap 自删 light）
#   3. 写 .cecelia/done-markers/<sid_short>-<branch>.done
set -uo pipefail

BRANCH="${1:-}"
PR_NUMBER="${2:-}"
PR_URL="${3:-}"
[[ -z "$BRANCH" ]] && { echo "[ship-finalize] usage: $0 <branch> <pr_number> <pr_url>" >&2; exit 1; }

MAIN_REPO=$(git worktree list --porcelain 2>/dev/null | head -1 | awk '/^worktree /{print $2; exit}')
[[ -z "$MAIN_REPO" ]] && { echo "[ship-finalize] not in git" >&2; exit 1; }

LIGHTS_DIR="$MAIN_REPO/.cecelia/lights"
DONE_DIR="$MAIN_REPO/.cecelia/done-markers"
mkdir -p "$DONE_DIR"

LIGHT=""
for f in "$LIGHTS_DIR"/*-"${BRANCH}".live; do
    [[ -f "$f" ]] && { LIGHT="$f"; break; }
done

if [[ -z "$LIGHT" ]]; then
    echo "[ship-finalize] no light for branch=$BRANCH" >&2
    exit 1
fi

if command -v jq &>/dev/null; then
    PID=$(jq -r '.guardian_pid // empty' "$LIGHT" 2>/dev/null)
else
    PID=$(grep -o '"guardian_pid"[[:space:]]*:[[:space:]]*[0-9]*' "$LIGHT" | grep -o '[0-9]*$')
fi

# SID short = light 文件名前缀
SID_SHORT=$(basename "$LIGHT" | cut -d- -f1)
MARKER="$DONE_DIR/${SID_SHORT}-${BRANCH}.done"

cat > "$MARKER" <<EOF
{
  "branch": "${BRANCH}",
  "completed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "pr_number": ${PR_NUMBER:-null},
  "pr_url": "${PR_URL}",
  "merged": true,
  "guardian_pid": ${PID:-null}
}
EOF
echo "[ship-finalize] done-marker written: $MARKER" >&2

if [[ -n "${PID:-}" && "$PID" =~ ^[0-9]+$ ]]; then
    if kill -SIGTERM "$PID" 2>/dev/null; then
        echo "[ship-finalize] SIGTERM sent to guardian pid=$PID" >&2
    else
        echo "[ship-finalize] guardian pid=$PID 已死或不存在" >&2
    fi
fi

exit 0
