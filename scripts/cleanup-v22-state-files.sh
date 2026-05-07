#!/usr/bin/env bash
# cleanup-v22-state-files.sh — 一次性归档 v22 残留 dev-active-*.json
#
# 背景：v23 心跳模型上线后，stop-dev.sh 不再读 .cecelia/dev-active-*.json
# （改读 .cecelia/lights/ mtime）。但 dev-mode-tool-guard.sh (PreToolUse hook)
# 仍依赖 dev-active 存在性判断"在 /dev 流程中"。
#
# 本脚本：
#   - 扫主仓库 .cecelia/dev-active-*.json
#   - 跳过当前活跃 worktree 对应的（git worktree list 含的分支）
#   - 其余移到 .cecelia/.history/dev-active-archived/
#
# 用法：bash scripts/cleanup-v22-state-files.sh [--dry-run]

set -uo pipefail

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

REPO=$(git rev-parse --show-toplevel 2>/dev/null)
[[ -z "$REPO" ]] && { echo "[cleanup-v22] not in git repo" >&2; exit 1; }

CECELIA_DIR="$REPO/.cecelia"
ARCHIVE_DIR="$CECELIA_DIR/.history/dev-active-archived"
[[ ! -d "$CECELIA_DIR" ]] && { echo "[cleanup-v22] no .cecelia/ — nothing to do" >&2; exit 0; }

# 收集当前活跃 worktree 的分支
ACTIVE_BRANCHES=()
while IFS= read -r line; do
    if [[ "$line" =~ ^branch[[:space:]]+refs/heads/(.+)$ ]]; then
        ACTIVE_BRANCHES+=("${BASH_REMATCH[1]}")
    fi
done < <(git worktree list --porcelain 2>/dev/null)

# 扫 dev-active-*.json
moved=0
kept=0
for f in "$CECELIA_DIR"/dev-active-*.json; do
    [[ -f "$f" ]] || continue
    name=$(basename "$f")
    branch="${name#dev-active-}"
    branch="${branch%.json}"

    # 是否对应活跃 worktree
    is_active=0
    for ab in "${ACTIVE_BRANCHES[@]+${ACTIVE_BRANCHES[@]}}"; do
        if [[ "$ab" == "$branch" ]]; then
            is_active=1
            break
        fi
    done

    if (( is_active )); then
        echo "[keep] $name (active worktree)" >&2
        kept=$((kept + 1))
    else
        if (( DRY_RUN )); then
            echo "[would-move] $name → archived/" >&2
        else
            mkdir -p "$ARCHIVE_DIR"
            mv "$f" "$ARCHIVE_DIR/${name}.$(date +%Y%m%d-%H%M%S)" 2>/dev/null || true
            echo "[moved] $name → archived/" >&2
        fi
        moved=$((moved + 1))
    fi
done

echo ""
echo "[cleanup-v22] kept=$kept moved=$moved (dry-run=$DRY_RUN)" >&2
exit 0
