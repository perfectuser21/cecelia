#!/usr/bin/env bash
# abort-dev.sh — 用户手动中止一条 /dev 流程
# 用法：abort-dev.sh <branch>
set -uo pipefail

BRANCH="${1:-}"
[[ -z "$BRANCH" ]] && { echo "[abort-dev] usage: $0 <branch>" >&2; exit 1; }

# 找主仓库（在 worktree 中运行也能找到）
MAIN_REPO=$(git worktree list --porcelain 2>/dev/null | head -1 | awk '/^worktree /{print $2}')
[[ -z "$MAIN_REPO" ]] && { echo "[abort-dev] not in git repo" >&2; exit 1; }

LIGHTS_DIR="$MAIN_REPO/.cecelia/lights"
ABORTED_DIR="$MAIN_REPO/.cecelia/aborted"
mkdir -p "$ABORTED_DIR"

# 找匹配灯（取第一个）
LIGHT=""
for f in "$LIGHTS_DIR"/*-"${BRANCH}".live; do
    [[ -f "$f" ]] && { LIGHT="$f"; break; }
done

if [[ -z "$LIGHT" ]]; then
    echo "[abort-dev] no light found for branch=$BRANCH" >&2
    exit 1
fi

# 读 guardian_pid（用 jq；jq 不在则 grep 兜底）
if command -v jq &>/dev/null; then
    PID=$(jq -r '.guardian_pid // empty' "$LIGHT" 2>/dev/null)
else
    PID=$(grep -o '"guardian_pid"[[:space:]]*:[[:space:]]*[0-9]*' "$LIGHT" | grep -o '[0-9]*$')
fi

if [[ -z "$PID" || ! "$PID" =~ ^[0-9]+$ ]]; then
    echo "[abort-dev] guardian_pid missing or invalid in $LIGHT" >&2
    exit 2
fi

# 杀 guardian（trap 会让它自己 rm 灯）
if kill -SIGTERM "$PID" 2>/dev/null; then
    echo "[abort-dev] sent SIGTERM to guardian pid=$PID" >&2
else
    echo "[abort-dev] kill failed (pid=$PID 不存在或权限不够)" >&2
    # 不 exit，继续写 marker 让审计完整
fi

# 写 aborted-marker
SID_SHORT=$(basename "$LIGHT" | cut -d- -f1)
MARKER="$ABORTED_DIR/${SID_SHORT}-${BRANCH}.aborted"
cat > "$MARKER" <<EOF
{"branch":"$BRANCH","aborted_at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","guardian_pid":$PID}
EOF

echo "[abort-dev] aborted $BRANCH (marker=$MARKER)" >&2
exit 0
