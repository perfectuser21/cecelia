#!/usr/bin/env bash
# Worktree GC（Garbage Collection）— 外部清理者
# v1.0.0: 从主仓库运行，用 GitHub API 检测已合并 PR，清理残留 worktree
#
# 设计原则：
#   1. 必须从主仓库运行（不在 worktree 内部自删）
#   2. 用 gh pr list --state merged 检测（不用 git branch --merged，squash merge 下后者失效）
#   3. 幂等：重复运行不产生副作用
#   4. 安全：不删主仓库、不删未合并的 worktree
#
# 调用方式：
#   bash worktree-gc.sh              # 清理已合并 PR 的 worktree
#   bash worktree-gc.sh --dry-run    # 只显示会清理什么，不执行
#   bash worktree-gc.sh --force      # 清理所有非活跃 worktree（含超时的）

set -euo pipefail

DRY_RUN=false
FORCE=false
TIMEOUT_HOURS=48

for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=true ;;
        --force) FORCE=true ;;
    esac
done

# ===== 必须从主仓库运行 =====
MAIN_WT=$(git worktree list 2>/dev/null | head -1 | awk '{print $1}')

if [[ -z "$MAIN_WT" ]]; then
    echo "ERROR: 不在 git 仓库中" >&2
    exit 1
fi

# 切到主仓库执行（关键：避免 CWD 在要删除的 worktree 内）
cd "$MAIN_WT"

# ===== 检测 gh CLI =====
if ! command -v gh &>/dev/null; then
    echo "WARN: gh CLI 不可用，跳过 worktree GC" >&2
    exit 0
fi

# ===== 获取 GitHub repo =====
REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner' 2>/dev/null || echo "")
if [[ -z "$REPO" ]]; then
    echo "WARN: 无法获取 GitHub repo，跳过 worktree GC" >&2
    exit 0
fi

# ===== 收集 worktree 信息 =====
CLEANED=0
SKIPPED=0

# 用 --porcelain 解析，收集成数组
declare -a WT_PATHS=()
declare -a WT_BRANCHES=()

current_path=""
current_branch=""
while IFS= read -r line; do
    if [[ "$line" == "worktree "* ]]; then
        current_path="${line#worktree }"
    elif [[ "$line" == "branch refs/heads/"* ]]; then
        current_branch="${line#branch refs/heads/}"
    elif [[ -z "$line" && -n "$current_path" ]]; then
        if [[ "$current_path" != "$MAIN_WT" && "${current_branch:-}" == cp-* ]]; then
            WT_PATHS+=("$current_path")
            WT_BRANCHES+=("$current_branch")
        fi
        current_path=""
        current_branch=""
    fi
done < <(git worktree list --porcelain 2>/dev/null; echo "")

# ===== 逐个检查并清理 =====
for i in "${!WT_PATHS[@]}"; do
    WT_PATH="${WT_PATHS[$i]}"
    WT_BRANCH="${WT_BRANCHES[$i]}"
    SHOULD_CLEAN=false
    REASON=""

    # 检查 1: PR 已合并（最可靠，通过 GitHub API）
    MERGED_PR=$(gh pr list --repo "$REPO" --head "$WT_BRANCH" --state merged --json number -q '.[0].number' 2>/dev/null || echo "")
    if [[ -n "$MERGED_PR" ]]; then
        SHOULD_CLEAN=true
        REASON="PR #$MERGED_PR 已合并"
    fi

    # 检查 2: PR 已关闭（非合并关闭）
    if [[ "$SHOULD_CLEAN" == "false" ]]; then
        CLOSED_PR=$(gh pr list --repo "$REPO" --head "$WT_BRANCH" --state closed --json number,mergedAt -q '.[] | select(.mergedAt == null) | .number' 2>/dev/null | head -1 || echo "")
        if [[ -n "$CLOSED_PR" ]]; then
            SHOULD_CLEAN=true
            REASON="PR #$CLOSED_PR 已关闭"
        fi
    fi

    # 检查 3: 远程分支已删除 + 有关联 PR
    if [[ "$SHOULD_CLEAN" == "false" ]]; then
        REMOTE_EXISTS=$(git ls-remote --heads origin "$WT_BRANCH" 2>/dev/null | grep -c "$WT_BRANCH" || echo "0")
        if [[ "$REMOTE_EXISTS" == "0" ]]; then
            ANY_PR=$(gh pr list --repo "$REPO" --head "$WT_BRANCH" --state all --json number -q '.[0].number' 2>/dev/null || echo "")
            if [[ -n "$ANY_PR" ]]; then
                SHOULD_CLEAN=true
                REASON="远程分支已删除（PR #$ANY_PR）"
            fi
        fi
    fi

    # 检查 4: --force 模式下，超时的 worktree
    if [[ "$SHOULD_CLEAN" == "false" && "$FORCE" == "true" && -d "$WT_PATH" ]]; then
        WT_AGE_MINUTES=$(( ($(date +%s) - $(stat -c %Y "$WT_PATH" 2>/dev/null || echo "$(date +%s)")) / 60 ))
        TIMEOUT_MINUTES=$((TIMEOUT_HOURS * 60))
        if [[ $WT_AGE_MINUTES -gt $TIMEOUT_MINUTES ]]; then
            SHOULD_CLEAN=true
            REASON="超时（${WT_AGE_MINUTES}min > ${TIMEOUT_HOURS}h）"
        fi
    fi

    # 执行清理
    if [[ "$SHOULD_CLEAN" == "true" ]]; then
        if [[ "$DRY_RUN" == "true" ]]; then
            echo "[dry-run] 会清理: $WT_PATH ($WT_BRANCH) — $REASON"
        else
            echo "清理: $WT_PATH ($WT_BRANCH) — $REASON"
            # 从主仓库执行删除（关键！CWD 已在 MAIN_WT）
            git worktree remove "$WT_PATH" --force 2>/dev/null || {
                rm -rf "$WT_PATH" 2>/dev/null || true
            }
            git branch -D "$WT_BRANCH" 2>/dev/null || true
        fi
        CLEANED=$((CLEANED + 1))
    else
        SKIPPED=$((SKIPPED + 1))
    fi
done

# 最后 prune 一次
if [[ "$DRY_RUN" == "false" ]]; then
    git worktree prune 2>/dev/null || true
fi

echo "Worktree GC: 清理 $CLEANED, 跳过 $SKIPPED"
