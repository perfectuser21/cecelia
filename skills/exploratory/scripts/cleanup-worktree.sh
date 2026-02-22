#!/bin/bash
# cleanup-worktree.sh - 清理 Exploratory worktree
# 清理前扫描凭据，发现则警告（但仍然删除，避免残留）

set -e

WORKTREE_PATH="${1:?需要提供 worktree 路径}"
BRANCH_NAME="${2:?需要提供分支名}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENGINE_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CLEANUP_LOG="$ENGINE_ROOT/.exploratory-cleanup.log"

# 加载共享凭据检测（TOKEN_PATTERNS + text_contains_token）
# shellcheck source=../../../lib/hook-utils.sh
if [[ -f "$ENGINE_ROOT/lib/hook-utils.sh" ]]; then
    source "$ENGINE_ROOT/lib/hook-utils.sh"
fi

# 扫描 worktree 中的凭据
# 返回: 0=未发现凭据, 1=发现凭据
scan_worktree_credentials() {
    local wt_path="$1"
    local found=0

    # TOKEN_PATTERNS 由 hook-utils.sh 提供
    if [[ ${#TOKEN_PATTERNS[@]} -eq 0 ]]; then
        return 0
    fi

    if [[ ! -d "$wt_path" ]]; then
        return 0
    fi

    for pattern in "${TOKEN_PATTERNS[@]}"; do
        local matches
        matches=$(grep -rlE "$pattern" "$wt_path" \
            --include="*.sh" --include="*.js" --include="*.ts" \
            --include="*.py" --include="*.env" --include="*.json" \
            --include="*.yml" --include="*.yaml" --include="*.md" \
            2>/dev/null || true)

        for file in $matches; do
            # 跳过 placeholder / example 值
            if grep -qE '(YOUR_|example|placeholder|xxx)' "$file" 2>/dev/null; then
                continue
            fi
            found=1
            local rel_path="${file#"$wt_path"/}"
            echo "  凭据发现: $rel_path (pattern: ${pattern:0:15}...)"
            # 脱敏日志
            echo "[$(date -Iseconds)] CREDENTIAL_FOUND file=$rel_path pattern=${pattern:0:15}... worktree=$wt_path" >> "$CLEANUP_LOG"
        done
    done

    return $found
}

echo "清理 Exploratory Worktree..."

# 清理前扫描凭据
if scan_worktree_credentials "$WORKTREE_PATH"; then
    echo "凭据扫描通过，未发现泄露"
else
    echo ""
    echo "警告：Worktree 中发现疑似凭据！"
    echo "仍将删除 worktree（避免凭据残留）"
    echo "详情见: $CLEANUP_LOG"
    echo ""
fi

# 删除 worktree（无论是否发现凭据，都要清理）
git worktree remove "$WORKTREE_PATH" --force

# 删除临时分支
git branch -D "$BRANCH_NAME"

echo "Worktree 已清理"
echo "临时分支已删除"
