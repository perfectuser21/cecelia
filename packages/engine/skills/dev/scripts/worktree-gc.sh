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

    # 检查 3: 远程分支已删除 + PR 已完结（merged 或 closed）
    # v12.41.0 P1-5 修复：原来用 --state all 会返回 open 状态的 PR，
    # 导致远程分支被 GitHub 自动删除但 PR 还在 open 时误删活跃 worktree
    if [[ "$SHOULD_CLEAN" == "false" ]]; then
        REMOTE_EXISTS=$(git ls-remote --heads origin "$WT_BRANCH" 2>/dev/null | grep -c "$WT_BRANCH" || echo "0")
        if [[ "$REMOTE_EXISTS" == "0" ]]; then
            # 只检查已合并或已关闭的 PR（排除 open 状态）
            FINISHED_PR=$(gh pr list --repo "$REPO" --head "$WT_BRANCH" --state merged --json number -q '.[0].number' 2>/dev/null || echo "")
            if [[ -z "$FINISHED_PR" ]]; then
                FINISHED_PR=$(gh pr list --repo "$REPO" --head "$WT_BRANCH" --state closed --json number -q '.[0].number' 2>/dev/null || echo "")
            fi
            if [[ -n "$FINISHED_PR" ]]; then
                SHOULD_CLEAN=true
                REASON="远程分支已删除（PR #$FINISHED_PR）"
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
        # v12.41.0 P0-3 修复：删除前检查未提交改动（防止数据丢失）
        if [[ -d "$WT_PATH" ]]; then
            DIRTY=$(git -C "$WT_PATH" status --porcelain 2>/dev/null | grep -v "node_modules" | head -5 || true)
            if [[ -n "$DIRTY" ]]; then
                echo "WARN: $WT_PATH ($WT_BRANCH) 有未提交改动，跳过:"
                echo "$DIRTY" | sed 's/^/  /'
                SKIPPED=$((SKIPPED + 1))
                continue
            fi
        fi

        if [[ "$DRY_RUN" == "true" ]]; then
            echo "[dry-run] 会清理: $WT_PATH ($WT_BRANCH) — $REASON"
        else
            echo "清理: $WT_PATH ($WT_BRANCH) — $REASON"
            # 从主仓库执行删除（关键！CWD 已在 MAIN_WT）
            git worktree remove "$WT_PATH" --force 2>/dev/null || {
                # v12.41.0 P1-6 修复：rm -rf fallback 加路径安全验证
                real_wt=$(realpath "$WT_PATH" 2>/dev/null || echo "$WT_PATH")
                real_main=$(realpath "$MAIN_WT" 2>/dev/null || echo "$MAIN_WT")
                if [[ "$real_wt" == "$real_main"* || "$real_wt" == "$(dirname "$real_main")"* ]] && \
                   [[ "$real_wt" != "/" && "$real_wt" != "$HOME" && "$real_wt" != "$real_main" ]]; then
                    rm -rf "$WT_PATH" 2>/dev/null || true
                else
                    echo "WARN: 路径安全检查失败，跳过 rm -rf: $WT_PATH" >&2
                fi
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
