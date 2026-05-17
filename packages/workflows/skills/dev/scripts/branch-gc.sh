#!/usr/bin/env bash
# Branch GC（Garbage Collection）— 清理孤儿本地分支
# v1.0.0: 清理 cp-*/worktree-* 残留分支，防止堆积
#
# 清理三类分支：
#   1. 已合并 PR 的分支（gh pr list --state merged）
#   2. 已关闭 PR 的分支（gh pr list --state closed）
#   3. 无 PR + commit 超过 STALE_HOURS 的孤儿分支
#
# 保护：
#   - 活跃 worktree 关联的分支
#   - 有 open PR 的分支
#   - main / develop 分支
#
# 用法:
#   bash branch-gc.sh              # 执行清理
#   bash branch-gc.sh --dry-run    # 只显示会清理什么
#   bash branch-gc.sh --stale=12   # 自定义过期小时数（默认 6）

set -euo pipefail

DRY_RUN=false
STALE_HOURS=6

for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=true ;;
        --stale=*) STALE_HOURS="${arg#--stale=}" ;;
    esac
done

# 必须在 git 仓库中
if ! git rev-parse --is-inside-work-tree &>/dev/null; then
    echo "ERROR: 不在 git 仓库中" >&2
    exit 1
fi

# 切到主仓库（worktree 内运行时也能正确工作）
MAIN_WT=$(git worktree list 2>/dev/null | head -1 | awk '{print $1}')
cd "$MAIN_WT"

CLEANED=0
SKIPPED=0
PROTECTED=0

# 收集受保护的分支（worktree 关联）
declare -a PROTECTED_BRANCHES=("main" "develop")
while IFS= read -r line; do
    if [[ "$line" == "branch refs/heads/"* ]]; then
        branch="${line#branch refs/heads/}"
        PROTECTED_BRANCHES+=("$branch")
    fi
done < <(git worktree list --porcelain 2>/dev/null)

is_protected() {
    local branch="$1"
    for pb in "${PROTECTED_BRANCHES[@]}"; do
        if [[ "$branch" == "$pb" ]]; then
            return 0
        fi
    done
    return 1
}

# 获取所有 cp-* 和 worktree-* 本地分支（排除当前分支和 worktree 分支）
BRANCHES=$(git branch --list "cp-*" "worktree-*" 2>/dev/null | grep -v "^\*" | grep -v "^+" | tr -d ' ' || true)

if [[ -z "$BRANCHES" ]]; then
    echo "Branch GC: 无 cp-*/worktree-* 分支需要清理"
    exit 0
fi

TOTAL=$(echo "$BRANCHES" | wc -l | tr -d ' ')
echo "Branch GC: 检查 $TOTAL 个分支（过期阈值: ${STALE_HOURS}h, dry-run: $DRY_RUN）"
echo ""

STALE_SECONDS=$((STALE_HOURS * 3600))
NOW=$(date +%s)

while IFS= read -r branch; do
    [[ -z "$branch" ]] && continue

    # 跳过受保护分支
    if is_protected "$branch"; then
        PROTECTED=$((PROTECTED + 1))
        continue
    fi

    SHOULD_DELETE=false
    REASON=""

    # 检查 1: PR 已合并
    MERGED_PR=$(gh pr list --head "$branch" --state merged --json number -q '.[0].number' 2>/dev/null || echo "")
    if [[ -n "$MERGED_PR" ]]; then
        SHOULD_DELETE=true
        REASON="PR #$MERGED_PR 已合并"
    fi

    # 检查 2: PR 已关闭（非合并）
    if [[ "$SHOULD_DELETE" == "false" ]]; then
        CLOSED_PR=$(gh pr list --head "$branch" --state closed --json number,mergedAt -q '.[] | select(.mergedAt == null) | .number' 2>/dev/null | head -1 || echo "")
        if [[ -n "$CLOSED_PR" ]]; then
            SHOULD_DELETE=true
            REASON="PR #$CLOSED_PR 已关闭"
        fi
    fi

    # 检查 3: 无 PR + 超过 STALE_HOURS
    if [[ "$SHOULD_DELETE" == "false" ]]; then
        OPEN_PR=$(gh pr list --head "$branch" --state open --json number -q '.[0].number' 2>/dev/null || echo "")
        if [[ -n "$OPEN_PR" ]]; then
            SKIPPED=$((SKIPPED + 1))
            continue  # 有 open PR，跳过
        fi

        # 无任何 PR — 检查最后 commit 时间
        COMMIT_EPOCH=$(git log -1 --format='%ct' "$branch" 2>/dev/null || echo "$NOW")
        AGE_SECONDS=$((NOW - COMMIT_EPOCH))

        if [[ $AGE_SECONDS -gt $STALE_SECONDS ]]; then
            AGE_HOURS=$((AGE_SECONDS / 3600))
            SHOULD_DELETE=true
            REASON="无 PR，过期 ${AGE_HOURS}h（阈值 ${STALE_HOURS}h）"
        else
            SKIPPED=$((SKIPPED + 1))
        fi
    fi

    # 执行删除
    if [[ "$SHOULD_DELETE" == "true" ]]; then
        if [[ "$DRY_RUN" == "true" ]]; then
            echo "[dry-run] 会删除: $branch — $REASON"
        else
            if git branch -D "$branch" 2>/dev/null; then
                echo "已删除: $branch — $REASON"
            else
                echo "WARN: 删除失败: $branch" >&2
            fi
        fi
        CLEANED=$((CLEANED + 1))
    fi
done <<< "$BRANCHES"

# 清理远程已删除的分支引用
if [[ "$DRY_RUN" == "false" ]]; then
    git remote prune origin 2>/dev/null || true
fi

echo ""
echo "Branch GC: 清理 $CLEANED, 跳过 $SKIPPED, 保护 $PROTECTED"
