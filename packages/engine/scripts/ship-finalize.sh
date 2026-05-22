#!/usr/bin/env bash
# ship-finalize.sh — engine-ship 调用：写 done-marker（guardian 由 stop hook 自行清理）
# 用法：ship-finalize.sh <branch> <pr_number> <pr_url>
#
# 行为：
#   1. 找 .cecelia/lights/<sid_short>-<branch>.live，读 guardian_pid（写入 done-marker）
#   2. 写 .cecelia/done-markers/<sid_short>-<branch>.done
#   注：guardian 不再由此脚本杀死，改由 stop hook classify_session→done 后清理
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

exit 0
