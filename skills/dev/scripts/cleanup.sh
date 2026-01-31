#!/usr/bin/env bash
# ZenithJoy Engine - Cleanup 脚本
# v1.9: 使用 lib/lock-utils.sh 原子操作 + 协调信号
# v1.8: PRD/DoD 归档到 .history/ 目录（而非直接删除）
# v1.7: rm -rf 安全验证
# v1.6: 跨仓库兼容（develop/main fallback）+ worktree 安全检查
# v1.5: 支持分支级别状态文件 (.cecelia-run-id-{branch}, .quality-gate-passed-{branch})
# v1.4: 支持分支级别 PRD/DoD 文件 (.prd-{branch}.md, .dod-{branch}.md)
# v1.3: 使用 mktemp 替代硬编码 /tmp，修复 MERGE_HEAD 路径
# v1.2: 报告生成错误记录到日志而非吞掉
# v1.1: 自动检测 base 分支（从 git config 读取）
# PR 合并后执行完整清理，确保不留垃圾
#
# 用法: bash skills/dev/scripts/cleanup.sh <cp-分支名> [base-分支名]
# 例如: bash skills/dev/scripts/cleanup.sh cp-20260117-fix-bug develop

set -euo pipefail

# L2 fix: 临时文件清理 trap
TEMP_FILES=()
cleanup_temp() {
    for f in "${TEMP_FILES[@]}"; do
        rm -f "$f" 2>/dev/null || true
    done
}
trap cleanup_temp EXIT

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# v1.7: 安全删除目录 - 验证路径有效性
safe_rm_rf() {
    local path="$1"
    local allowed_parent="$2"

    # 验证 1: 路径非空
    if [[ -z "$path" ]]; then
        echo -e "${RED}错误: rm -rf 路径为空，拒绝执行${NC}" >&2
        return 1
    fi

    # 验证 2: 路径存在
    if [[ ! -e "$path" ]]; then
        return 0
    fi

    # 验证 3: 路径在允许的父目录内
    local real_path
    real_path=$(realpath "$path" 2>/dev/null) || real_path="$path"
    local real_parent
    real_parent=$(realpath "$allowed_parent" 2>/dev/null) || real_parent="$allowed_parent"

    if [[ "$real_path" != "$real_parent"* ]]; then
        echo -e "${RED}错误: 路径 $path 不在允许范围 $allowed_parent 内，拒绝删除${NC}" >&2
        return 1
    fi

    # 验证 4: 禁止删除根目录或 home 目录
    if [[ "$real_path" == "/" || "$real_path" == "$HOME" || "$real_path" == "/home" ]]; then
        echo -e "${RED}错误: 禁止删除系统关键目录: $real_path${NC}" >&2
        return 1
    fi

    rm -rf "$path"
}

# v1.8: PRD/DoD 归档函数
archive_prd_dod() {
    local branch="$1"
    local project_root
    project_root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
    local history_dir="$project_root/.history"
    local date_str
    date_str=$(date +%Y%m%d-%H%M)
    local archived=0

    # 创建 .history 目录
    mkdir -p "$history_dir"

    # 归档 PRD 文件
    local prd_files=(".prd.md" ".prd-${branch}.md")
    for prd in "${prd_files[@]}"; do
        if [[ -f "$project_root/$prd" ]]; then
            local archive_name="${branch}-${date_str}.prd.md"
            if cp "$project_root/$prd" "$history_dir/$archive_name" 2>/dev/null; then
                archived=$((archived + 1))
            fi
            break  # 只归档一个 PRD
        fi
    done

    # 归档 DoD 文件
    local dod_files=(".dod.md" ".dod-${branch}.md")
    for dod in "${dod_files[@]}"; do
        if [[ -f "$project_root/$dod" ]]; then
            local archive_name="${branch}-${date_str}.dod.md"
            if cp "$project_root/$dod" "$history_dir/$archive_name" 2>/dev/null; then
                archived=$((archived + 1))
            fi
            break  # 只归档一个 DoD
        fi
    done

    echo "$archived"
}

# 参数
CP_BRANCH="${1:-}"
# v1.6: 优先使用参数，其次从 git config 读取，最后 fallback 到 develop/main
BASE_BRANCH="${2:-$(git config "branch.$CP_BRANCH.base-branch" 2>/dev/null || echo "")}"

# v1.6: 自动检测 base 分支（develop 优先，fallback 到 main）
if [[ -z "$BASE_BRANCH" ]] || ! git rev-parse "$BASE_BRANCH" >/dev/null 2>&1; then
    if git rev-parse develop >/dev/null 2>&1; then
        BASE_BRANCH="develop"
    elif git rev-parse main >/dev/null 2>&1; then
        BASE_BRANCH="main"
    else
        BASE_BRANCH="HEAD~10"  # 最后的 fallback
    fi
fi

if [[ -z "$CP_BRANCH" ]]; then
    echo -e "${RED}错误: 请提供 cp-* 分支名${NC}"
    echo "用法: bash cleanup.sh <cp-分支名> [base-分支名]"
    exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Cleanup 检查"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  CP 分支: $CP_BRANCH"
echo "  Base 分支: $BASE_BRANCH"
echo ""

# ========================================
# 0. 生成任务报告（在 cleanup 前）
# ========================================
echo "0. 生成任务报告..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPORT_ERROR_LOG=$(mktemp)
TEMP_FILES+=("$REPORT_ERROR_LOG")  # L2 fix: 注册到临时文件列表
if [[ -f "$SCRIPT_DIR/generate-report.sh" ]]; then
    # v1.2: 记录错误到日志而非吞掉
    if bash "$SCRIPT_DIR/generate-report.sh" "$CP_BRANCH" "$BASE_BRANCH" "$(pwd)" 2>"$REPORT_ERROR_LOG"; then
        echo -e "   ${GREEN}[OK] 报告已保存到 .dev-runs/${NC}"
    else
        echo -e "   ${YELLOW}[WARN] 报告生成失败，继续 cleanup${NC}"
        if [[ -s "$REPORT_ERROR_LOG" ]]; then
            echo -e "   ${YELLOW}错误日志: $REPORT_ERROR_LOG${NC}"
        fi
    fi
else
    echo -e "   ${YELLOW}[WARN] generate-report.sh 不存在，跳过${NC}"
fi
echo ""

FAILED=0
WARNINGS=0
CHECKOUT_FAILED=0

# ========================================
# 1. 检查当前分支
# ========================================
echo "[1]  检查当前分支..."
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

if [[ "$CURRENT_BRANCH" == "$CP_BRANCH" ]]; then
    echo -e "   ${YELLOW}[WARN]  还在 $CP_BRANCH 分支，需要切换${NC}"
    echo "   → 切换到 $BASE_BRANCH..."
    if git checkout "$BASE_BRANCH" 2>/dev/null; then
        CURRENT_BRANCH="$BASE_BRANCH"
    else
        echo -e "   ${RED}[FAIL] 切换失败，无法继续删除本地分支${NC}"
        FAILED=1
        CHECKOUT_FAILED=1
    fi
else
    echo -e "   ${GREEN}[OK] 当前在 $CURRENT_BRANCH${NC}"
fi

# ========================================
# 2. 拉取最新代码
# ========================================
echo ""
echo "[2]  拉取最新代码..."
if [[ $CHECKOUT_FAILED -eq 1 ]]; then
    echo -e "   ${YELLOW}[WARN]  跳过（checkout 失败，不在目标分支）${NC}"
elif git pull origin "$BASE_BRANCH" 2>/dev/null; then
    echo -e "   ${GREEN}[OK] 已同步最新代码${NC}"
else
    echo -e "   ${YELLOW}[WARN]  拉取失败，可能有冲突${NC}"
    WARNINGS=$((WARNINGS + 1))
    # L2 fix: 检查是否处于 MERGING 状态，处理 rev-parse 错误
    MERGE_HEAD_PATH=$(git rev-parse --git-path MERGE_HEAD 2>/dev/null || echo "")
    if [[ -n "$MERGE_HEAD_PATH" && -f "$MERGE_HEAD_PATH" ]]; then
        echo -e "   ${RED}[FAIL] 检测到未完成的合并，需要手动解决${NC}"
        echo -e "   → 运行 'git merge --abort' 取消合并，或手动解决冲突"
        FAILED=1
    fi
fi

# ========================================
# 3. 检查并删除本地 cp-* 分支
# ========================================
echo ""
echo "[3]  检查本地 cp-* 分支..."
if [[ $CHECKOUT_FAILED -eq 1 ]]; then
    echo -e "   ${YELLOW}[WARN]  跳过（checkout 失败，无法删除当前所在分支）${NC}"
elif git branch --list "$CP_BRANCH" | grep -q "$CP_BRANCH"; then
    echo "   → 删除本地分支 $CP_BRANCH..."
    if git branch -D "$CP_BRANCH" 2>/dev/null; then
        echo -e "   ${GREEN}[OK] 已删除本地分支${NC}"
    else
        echo -e "   ${RED}[FAIL] 删除失败${NC}"
        FAILED=1
    fi
else
    echo -e "   ${GREEN}[OK] 本地分支已不存在${NC}"
fi

# ========================================
# 4. 检查并删除远程 cp-* 分支
# ========================================
echo ""
echo "[4]  检查远程 cp-* 分支..."
# A7 fix: checkout 失败时跳过远程分支删除（防止误删）
if [[ $CHECKOUT_FAILED -eq 1 ]]; then
    echo -e "   ${YELLOW}[WARN]  跳过（checkout 失败，为安全起见不删除远程分支）${NC}"
elif git ls-remote --heads origin "$CP_BRANCH" 2>/dev/null | grep -q "$CP_BRANCH"; then
    echo "   → 删除远程分支 $CP_BRANCH..."
    if git push origin --delete "$CP_BRANCH" 2>/dev/null; then
        echo -e "   ${GREEN}[OK] 已删除远程分支${NC}"
    else
        echo -e "   ${YELLOW}[WARN]  删除失败（可能已被 GitHub 自动删除）${NC}"
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo -e "   ${GREEN}[OK] 远程分支已不存在${NC}"
fi

# ========================================
# 4.5. 检查并移除关联的 worktree
# ========================================
echo ""
echo "[4.5] 检查关联的 worktree..."
WORKTREE_PATH=$(git worktree list 2>/dev/null | grep "\[$CP_BRANCH\]" | awk '{print $1}')
if [[ -n "$WORKTREE_PATH" ]]; then
    echo "   → 发现关联的 worktree: $WORKTREE_PATH"
    # 检查是否有未提交的改动
    if [[ -d "$WORKTREE_PATH" ]]; then
        WORKTREE_UNCOMMITTED=$(git -C "$WORKTREE_PATH" status --porcelain 2>/dev/null | grep -v "node_modules" || true)
        if [[ -n "$WORKTREE_UNCOMMITTED" ]]; then
            echo -e "   ${YELLOW}[WARN]  worktree 有未提交的改动:${NC}"
            echo "$WORKTREE_UNCOMMITTED" | head -3 | sed 's/^/      /'
            echo -e "   ${YELLOW}→ 跳过 worktree 清理，请手动处理${NC}"
            WARNINGS=$((WARNINGS + 1))
        else
            # 安全移除 worktree
            if git worktree remove "$WORKTREE_PATH" --force 2>/dev/null; then
                echo -e "   ${GREEN}[OK] 已移除 worktree${NC}"
            else
                echo -e "   ${YELLOW}[WARN]  worktree 移除失败，尝试强制清理...${NC}"
                # v1.7: 使用安全删除，限制在主 worktree 的父目录内
                MAIN_WT_PARENT=$(dirname "$(git worktree list 2>/dev/null | head -1 | awk '{print $1}')")
                if safe_rm_rf "$WORKTREE_PATH" "$MAIN_WT_PARENT"; then
                    git worktree prune 2>/dev/null || true
                    echo -e "   ${GREEN}[OK] 已强制清理${NC}"
                else
                    echo -e "   ${RED}[FAIL] 安全检查失败，请手动删除: $WORKTREE_PATH${NC}"
                    WARNINGS=$((WARNINGS + 1))
                fi
            fi
        fi
    fi
else
    echo -e "   ${GREEN}[OK] 无关联的 worktree${NC}"
fi

# ========================================
# 5. 清理 git config 中的分支记录
# ========================================
echo ""
echo "[5]  清理 git config..."
CLEANED=false
# 清理所有可能的配置项（包括遗留的和当前使用的）
for CONFIG_KEY in "base-branch" "prd-confirmed" "step" "is-test"; do
    if git config --get "branch.$CP_BRANCH.$CONFIG_KEY" &>/dev/null; then
        git config --unset "branch.$CP_BRANCH.$CONFIG_KEY" 2>/dev/null || true
        CLEANED=true
    fi
done
if [ "$CLEANED" = true ]; then
    echo -e "   ${GREEN}[OK] 已清理 git config${NC}"
else
    echo -e "   ${GREEN}[OK] 无需清理 git config${NC}"
fi

# ========================================
# 6. 清理 stale remote refs
# ========================================
echo ""
echo "[6]  清理 stale remote refs..."
PRUNED=$(git remote prune origin 2>&1 || true)
if echo "$PRUNED" | grep -q "pruning"; then
    echo -e "   ${GREEN}[OK] 已清理 stale refs${NC}"
else
    echo -e "   ${GREEN}[OK] 无 stale refs${NC}"
fi

# ========================================
# 7. 检查未提交的文件
# ========================================
echo ""
echo "[7]  检查未提交文件..."
UNCOMMITTED=$(git status --porcelain 2>/dev/null | grep -v "node_modules" | head -5 || true)
if [[ -n "$UNCOMMITTED" ]]; then
    echo -e "   ${YELLOW}[WARN]  有未提交的文件:${NC}"
    echo "$UNCOMMITTED" | sed 's/^/      /'
    WARNINGS=$((WARNINGS + 1))
else
    echo -e "   ${GREEN}[OK] 无未提交文件${NC}"
fi

# ========================================
# 7.5 归档 PRD/DoD 到 .history/（v1.8）
# ========================================
echo ""
echo "[7.5] 归档 PRD/DoD..."
ARCHIVED_COUNT=$(archive_prd_dod "$CP_BRANCH")
if [[ "$ARCHIVED_COUNT" -gt 0 ]]; then
    echo -e "   ${GREEN}[OK] 已归档 $ARCHIVED_COUNT 个文件到 .history/${NC}"
else
    echo -e "   ${GREEN}[OK] 无 PRD/DoD 需要归档${NC}"
fi

# ========================================
# 8. 删除运行时文件（防止残留影响下次）
# ========================================
echo ""
echo "[8]  删除运行时文件..."

# v1.5: 支持分支级别 PRD/DoD/状态文件
RUNTIME_FILES=(
    ".quality-report.json"
    ".prd.md"
    ".dod.md"
    ".prd-${CP_BRANCH}.md"
    ".dod-${CP_BRANCH}.md"
    ".quality-gate-passed"
    ".quality-gate-passed-${CP_BRANCH}"
    ".cecelia-run-id"
    ".cecelia-run-id-${CP_BRANCH}"
    ".layer2-evidence.md"
    ".l3-analysis.md"
    ".quality-evidence.json"
)

DELETED_COUNT=0
for FILE in "${RUNTIME_FILES[@]}"; do
    if [[ -f "$FILE" ]]; then
        if rm -f "$FILE" 2>/dev/null; then
            DELETED_COUNT=$((DELETED_COUNT + 1))
        else
            echo -e "   ${YELLOW}[WARN]  删除 $FILE 失败${NC}"
            WARNINGS=$((WARNINGS + 1))
        fi
    fi
done

if [[ $DELETED_COUNT -gt 0 ]]; then
    echo -e "   ${GREEN}[OK] 已删除 $DELETED_COUNT 个运行时文件${NC}"
else
    echo -e "   ${GREEN}[OK] 无运行时文件需要删除${NC}"
fi

# ========================================
# 9. 检查是否有其他 cp-* 分支遗留
# ========================================
echo ""
echo "[9]  检查其他遗留的 cp-* 分支..."
OTHER_CP=$(git branch --list "cp-*" 2>/dev/null | grep -v "^\*" || true)
if [[ -n "$OTHER_CP" ]]; then
    echo -e "   ${YELLOW}[WARN]  发现其他 cp-* 分支:${NC}"
    echo "$OTHER_CP" | sed 's/^/      /'
    WARNINGS=$((WARNINGS + 1))
else
    echo -e "   ${GREEN}[OK] 无其他 cp-* 分支${NC}"
fi

# ========================================
# 10. Cleanup 完成（v8: 不再使用步骤状态机）
# ========================================
echo ""
echo "[10] Cleanup 完成..."
echo -e "   ${GREEN}[OK] 所有清理步骤完成${NC}"

# 标记 cleanup 完成（让 Stop Hook 知道可以退出了）
PROJECT_ROOT_FOR_DEVMODE=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
DEV_MODE_FILE="$PROJECT_ROOT_FOR_DEVMODE/.dev-mode"

# v1.9: 加载 lock-utils 并使用原子追加 + 协调信号
LOCK_UTILS=""
for candidate in "$PROJECT_ROOT_FOR_DEVMODE/lib/lock-utils.sh" "$HOME/.claude/lib/lock-utils.sh"; do
    if [[ -f "$candidate" ]]; then
        # shellcheck disable=SC1090
        source "$candidate"
        LOCK_UTILS="$candidate"
        break
    fi
done

if [[ -f "$DEV_MODE_FILE" ]]; then
    if [[ -n "$LOCK_UTILS" ]] && type atomic_append_dev_mode &>/dev/null; then
        # 使用原子操作：获取锁 → 追加 → 释放锁
        if acquire_dev_mode_lock 2; then
            atomic_append_dev_mode "cleanup_done: true"
            create_cleanup_signal "$CP_BRANCH"
            release_dev_mode_lock
            echo -e "   ${GREEN}[OK] 已标记 cleanup_done（原子写入）${NC}"
        else
            # Fallback: 直接追加
            echo "cleanup_done: true" >> "$DEV_MODE_FILE"
            echo -e "   ${GREEN}[OK] 已标记 cleanup_done${NC}"
        fi
    else
        # Fallback: 无共享库时直接追加
        echo "cleanup_done: true" >> "$DEV_MODE_FILE"
        echo -e "   ${GREEN}[OK] 已标记 cleanup_done${NC}"
    fi
fi

# ========================================
# 总结
# ========================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [[ $FAILED -gt 0 ]]; then
    echo -e "  ${RED}[FAIL] Cleanup 失败 ($FAILED 个错误)${NC}"
    exit 1
elif [[ $WARNINGS -gt 0 ]]; then
    echo -e "  ${YELLOW}[WARN]  Cleanup 完成 ($WARNINGS 个警告)${NC}"
else
    echo -e "  ${GREEN}[OK] Cleanup 完成，无遗留${NC}"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
