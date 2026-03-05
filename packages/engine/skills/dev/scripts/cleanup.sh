#!/usr/bin/env bash
# ZenithJoy Engine - Cleanup 脚本
# v2.0: R2 全面修复 - worktree 感知、grep 精确匹配、safe_rm_rf 精确前缀
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

    if [[ "$real_path" != "$real_parent/"* && "$real_path" != "$real_parent" ]]; then
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

# v2.0 P0-1 修复：检测是否在 worktree 中运行
# worktree 内 `git checkout main` 必定失败（main 被主仓库锁定）
# worktree 清理由 worktree-gc.sh 负责，此脚本只做状态文件/config 清理
IS_WORKTREE=false
_GIT_DIR=$(git rev-parse --git-dir 2>/dev/null || echo "")
if [[ "$_GIT_DIR" == *"worktrees"* ]]; then
    IS_WORKTREE=true
fi

# ========================================
# 0.0 捕获 CHANGED_FILES（必须在 checkout 之前）
# ========================================
# 在切换到 base 分支之前先记录此次 PR 改动的文件列表。
# checkout 之后 git diff CP_BRANCH 会返回空，导致 deploy-local.sh 跳过所有部署。
echo "[0.0] 捕获改动文件列表（checkout 之前）..."
CHANGED_FILES=""
if git rev-parse --verify "origin/$BASE_BRANCH" >/dev/null 2>&1; then
    CHANGED_FILES=$(git diff --name-only "origin/$BASE_BRANCH"..."$CP_BRANCH" 2>/dev/null || echo "")
else
    CHANGED_FILES=$(git diff --name-only "$BASE_BRANCH"..."$CP_BRANCH" 2>/dev/null || echo "")
fi
if [[ -n "$CHANGED_FILES" ]]; then
    echo -e "   ${GREEN}[OK] 已捕获 $(echo "$CHANGED_FILES" | wc -l | tr -d ' ') 个改动文件${NC}"
else
    echo -e "   ${YELLOW}[WARN]  未检测到改动文件（分支已合并或无差异）${NC}"
fi
echo ""

# ========================================
# 0.1 归档 .dev-incident-log.json
# ========================================
echo "[0.1] 归档 Incident Log..."
INCIDENT_FILE=".dev-incident-log.json"
RUNS_DIR=".dev-runs"
mkdir -p "$RUNS_DIR"
if [[ -f "$INCIDENT_FILE" ]]; then
    INCIDENT_COUNT=$( (command -v jq &>/dev/null && jq 'length' "$INCIDENT_FILE" 2>/dev/null) || grep -c '"' "$INCIDENT_FILE" 2>/dev/null || echo "0")
    ARCHIVE_NAME="${RUNS_DIR}/${CP_BRANCH}-incident-log.json"
    cp "$INCIDENT_FILE" "$ARCHIVE_NAME"
    rm -f "$INCIDENT_FILE"
    echo -e "   ${GREEN}[OK] Incident Log 已归档（${INCIDENT_COUNT} 条）→ $ARCHIVE_NAME${NC}"
else
    echo -e "   ${GREEN}[OK] 无 Incident Log（本次开发无失败记录）${NC}"
fi
echo ""

# ========================================
# 0.2 清理 .dev-feedback-report.json
# ========================================
echo "[0.2] 清理反馈报告..."
FEEDBACK_FILE=".dev-feedback-report.json"
if [[ -f "$FEEDBACK_FILE" ]]; then
    # 归档到 .dev-runs/ 而非直接删除（保留记录）
    FEEDBACK_ARCHIVE="${RUNS_DIR}/${CP_BRANCH}-feedback-report.json"
    cp "$FEEDBACK_FILE" "$FEEDBACK_ARCHIVE"
    rm -f "$FEEDBACK_FILE"
    echo -e "   ${GREEN}[OK] 反馈报告已归档 → $FEEDBACK_ARCHIVE${NC}"
else
    echo -e "   ${GREEN}[OK] 无反馈报告文件${NC}"
fi
echo ""

# ========================================
# 1. 检查当前分支
# ========================================
echo "[1]  检查当前分支..."
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

if [[ "$IS_WORKTREE" == "true" ]]; then
    # worktree 内不能 checkout 到 main/develop（被主仓库锁定）
    # 分支清理由 worktree-gc.sh 从主仓库执行
    echo -e "   ${GREEN}[OK] 在 worktree 中运行（$CURRENT_BRANCH），跳过分支切换${NC}"
    echo -e "   ${YELLOW}     分支/worktree 清理将由 worktree-gc.sh 从主仓库执行${NC}"
    # 标记跳过 checkout 相关步骤，但不设 FAILED
    CHECKOUT_FAILED=1
elif [[ "$CURRENT_BRANCH" == "$CP_BRANCH" ]]; then
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
# 2.5 触发本地部署（PR 合并后自动重启服务）
# ========================================
echo ""
echo "[2.5] 触发本地部署..."
SCRIPT_DIR_FOR_DEPLOY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 向上溯源找到仓库根目录（兼容 worktree 和直接调用）
GIT_COMMON_DIR=$(git rev-parse --git-common-dir 2>/dev/null || echo ".git")
if [[ "$GIT_COMMON_DIR" == ".git" ]]; then
    REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
else
    REPO_ROOT="$(cd "$(dirname "$GIT_COMMON_DIR")" && pwd)"
fi
DEPLOY_LOCAL_SH="$REPO_ROOT/scripts/deploy-local.sh"

if [[ $CHECKOUT_FAILED -eq 1 ]]; then
    echo -e "   ${YELLOW}[WARN]  跳过（checkout 失败，无法确认代码已同步）${NC}"
elif [[ ! -f "$DEPLOY_LOCAL_SH" ]]; then
    echo -e "   ${YELLOW}[WARN]  deploy-local.sh 不存在，跳过部署${NC}"
    echo "   期望路径: $DEPLOY_LOCAL_SH"
else
    # fire-and-forget：setsid 新会话后台运行，不阻塞有头/无头会话
    # 日志写 /tmp/cecelia-deploy-<branch>.log，部署结果不影响 cleanup 流程
    DEPLOY_LOG="/tmp/cecelia-deploy-${CP_BRANCH}.log"
    setsid bash "$DEPLOY_LOCAL_SH" "$BASE_BRANCH" --changed="$CHANGED_FILES" \
        >"$DEPLOY_LOG" 2>&1 &
    DEPLOY_PID=$!
    echo -e "   ${GREEN}[OK] 部署已在后台启动 (pid=$DEPLOY_PID)${NC}"
    echo "   日志: $DEPLOY_LOG"
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
# 4.5. Worktree 清理（委托给外部 GC）
# ========================================
echo ""
echo "[4.5] Worktree 清理..."
# v12.39.1: 不再在 worktree 内部自删（CWD 锁死导致失败）
# 委托给外部 worktree-gc.sh，从主仓库运行
SCRIPT_DIR_FOR_GC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GC_SCRIPT="$SCRIPT_DIR_FOR_GC/worktree-gc.sh"
if [[ -f "$GC_SCRIPT" ]]; then
    # v12.40.1: 不再 fire-and-forget 启动 GC（竞态：GC 可能在 cleanup 还在运行时删除当前 worktree）
    # GC 应由 stop-dev.sh 在 cleanup 完成后、从主仓库触发，或由用户手动运行
    echo -e "   ${GREEN}[OK] Worktree GC 将在 cleanup 完成后由 stop hook 触发${NC}"
else
    echo -e "   ${YELLOW}[WARN] worktree-gc.sh 不存在，跳过${NC}"
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
# 7.6 验证所有步骤完成（W8: 删除前检查）
# ========================================
echo ""
echo "[7.6] 验证所有步骤完成..."

PROJECT_ROOT_FOR_VALIDATION=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
# v12.40.1: 支持 per-branch 格式（.dev-mode.${branch}），fallback 到旧格式（.dev-mode）
DEV_MODE_FILE_FOR_VALIDATION="$PROJECT_ROOT_FOR_VALIDATION/.dev-mode.${CP_BRANCH}"
if [[ ! -f "$DEV_MODE_FILE_FOR_VALIDATION" ]]; then
    DEV_MODE_FILE_FOR_VALIDATION="$PROJECT_ROOT_FOR_VALIDATION/.dev-mode"
fi

if [[ -f "$DEV_MODE_FILE_FOR_VALIDATION" ]]; then
    INCOMPLETE_STEPS=""
    # v2.0 P1-5 修复：step_PATTERN 映射表，防止 step_1_ 匹配 step_10_/step_11_
    declare -a STEP_PATTERNS=(
        "" # 0 placeholder
        "step_1_prd" "step_2_detect" "step_3_branch" "step_4_explore"
        "step_5_dod" "step_6_code" "step_7_verify" "step_8_pr"
        "step_9_ci" "step_10_learning" "step_11_cleanup"
    )
    for step in {1..11}; do
        STEP_KEY="${STEP_PATTERNS[$step]}"
        STEP_STATUS=$(grep "^${STEP_KEY}:" "$DEV_MODE_FILE_FOR_VALIDATION" 2>/dev/null | cut -d':' -f2 | xargs || echo "")
        if [[ "$STEP_STATUS" != "done" ]]; then
            INCOMPLETE_STEPS="$INCOMPLETE_STEPS ${STEP_KEY}"
        fi
    done

    # v2.0 P1-6 修复：验证失败时设置标志，阻止后续 cleanup_done 写入
    VALIDATION_PASSED=true
    if [[ -n "$INCOMPLETE_STEPS" ]]; then
        echo -e "   ${RED}[FAIL] 不能删除 .dev-mode，以下步骤未完成: $INCOMPLETE_STEPS${NC}"
        echo -e "   ${YELLOW}提示: 确保所有步骤都已标记为 done${NC}"
        FAILED=$((FAILED + 1))
        VALIDATION_PASSED=false
    else
        echo -e "   ${GREEN}[OK] 所有 11 步已完成${NC}"
    fi
else
    echo -e "   ${GREEN}[OK] 无 .dev-mode 文件需要验证${NC}"
fi

# ========================================
# 8. 删除运行时文件（防止残留影响下次）
# ========================================
echo ""
echo "[8]  删除运行时文件..."

# v1.5: 支持分支级别 PRD/DoD/状态文件
# W8: .dev-mode 需要特殊处理（删除后验证）
RUNTIME_FILES=(
    ".quality-report.json"
    ".quality-gate-passed"
    ".quality-gate-passed-${CP_BRANCH}"
    ".cecelia-run-id"
    ".cecelia-run-id-${CP_BRANCH}"
    ".layer2-evidence.md"
    ".l3-analysis.md"
    ".quality-evidence.json"
    # .dev-mode 和 .dev-lock 由 Stop Hook 管理，不在此删除
)

DELETED_COUNT=0
for FILE in "${RUNTIME_FILES[@]}"; do
    if [[ -f "$FILE" ]]; then
        # 正常删除所有运行时文件
        if rm -f "$FILE" 2>/dev/null; then
            DELETED_COUNT=$((DELETED_COUNT + 1))
        else
            echo -e "   ${YELLOW}[WARN]  删除 $FILE 失败${NC}"
            WARNINGS=$((WARNINGS + 1))
        fi
    fi
done

# v1.10: 通配符删除所有 .prd-* 和 .dod-* 文件（包括自定义命名）
# 不使用 RUNTIME_FILES 数组，直接 glob 删除
echo "🧹 清理 .prd-*/.dod-* 临时文件..."
PRD_DOD_COUNT=0
for f in .prd-*.md .dod-*.md .prd.md .dod.md; do
    if [[ -f "$f" ]]; then
        if rm -f "$f" 2>/dev/null; then
            PRD_DOD_COUNT=$((PRD_DOD_COUNT + 1))
        fi
    fi
done
if [[ "$PRD_DOD_COUNT" -gt 0 ]]; then
    DELETED_COUNT=$((DELETED_COUNT + PRD_DOD_COUNT))
    echo -e "   ${GREEN}[OK] 已删除 $PRD_DOD_COUNT 个 prd/dod 文件${NC}"
fi

if [[ $DELETED_COUNT -gt 0 ]]; then
    echo -e "   ${GREEN}[OK] 已删除 $DELETED_COUNT 个运行时文件${NC}"
else
    echo -e "   ${GREEN}[OK] 无运行时文件需要删除${NC}"
fi

# ========================================
# 9. 检查是否有其他 cp-* 分支遗留（自动删除已合并的）
# ========================================
echo ""
echo "[9]  检查其他遗留的 cp-* 分支..."
# 排除当前检出分支（* 开头）和带 + 标记的 worktree 分支
OTHER_CP=$(git branch --list "cp-*" 2>/dev/null | grep -v "^\*" | grep -v "^+" | tr -d ' ' || true)
if [[ -n "$OTHER_CP" ]]; then
    MERGED_COUNT=0
    UNMERGED_BRANCHES=()

    while IFS= read -r branch; do
        [[ -z "$branch" ]] && continue
        # v12.40.1: 用 gh pr list 检测是否已合并（squash merge 下 git branch --merged 失效）
        PR_MERGED=""
        if command -v gh &>/dev/null; then
            PR_MERGED=$(gh pr list --state merged --head "$branch" --json number --jq '.[0].number' 2>/dev/null || true)
        fi
        if [[ -n "$PR_MERGED" ]]; then
            if git branch -D "$branch" 2>/dev/null; then
                echo -e "   ${GREEN}[OK] 已删除已合并分支: $branch (PR #$PR_MERGED)${NC}"
                MERGED_COUNT=$((MERGED_COUNT + 1))
            else
                echo -e "   ${YELLOW}[WARN]  删除失败: $branch${NC}"
                UNMERGED_BRANCHES+=("$branch")
            fi
        else
            UNMERGED_BRANCHES+=("$branch")
        fi
    done <<< "$OTHER_CP"

    if [[ $MERGED_COUNT -gt 0 ]]; then
        echo -e "   ${GREEN}[OK] 已自动删除 $MERGED_COUNT 个已合并的 cp-* 分支${NC}"
    fi

    if [[ ${#UNMERGED_BRANCHES[@]} -gt 0 ]]; then
        echo -e "   ${YELLOW}[WARN]  以下 cp-* 分支未合并到 $BASE_BRANCH，请手动处理:${NC}"
        for b in "${UNMERGED_BRANCHES[@]}"; do
            echo "      $b"
        done
        WARNINGS=$((WARNINGS + 1))
    fi

    if [[ $MERGED_COUNT -eq 0 && ${#UNMERGED_BRANCHES[@]} -eq 0 ]]; then
        echo -e "   ${GREEN}[OK] 无其他 cp-* 分支${NC}"
    fi
else
    echo -e "   ${GREEN}[OK] 无其他 cp-* 分支${NC}"
fi

# ========================================
# 9.5 自动清理远程已删除的分支
# ========================================
echo ""
echo "[9.5] 清理远程已删除的分支..."
GONE_BRANCHES=$(git branch -vv | grep ': gone]' | awk '{print $1}')
if [[ -n "$GONE_BRANCHES" ]]; then
    GONE_COUNT=$(echo "$GONE_BRANCHES" | wc -l)
    echo "   → 发现 $GONE_COUNT 个远程已删除的分支"
    # v2.0 P1-8 修复：逐个删除而非 xargs（set -e 下 xargs 任一失败会终止脚本）
    while IFS= read -r gone_branch; do
        [[ -z "$gone_branch" ]] && continue
        git branch -D "$gone_branch" 2>/dev/null || echo -e "   ${YELLOW}[WARN] 删除 $gone_branch 失败${NC}"
    done <<< "$GONE_BRANCHES"
    echo -e "   ${GREEN}[OK] 已清理 $GONE_COUNT 个分支${NC}"
else
    echo -e "   ${GREEN}[OK] 无需清理${NC}"
fi

# ========================================
# 10. Cleanup 完成（v8: 不再使用步骤状态机）
# ========================================
echo ""
echo "[10] Cleanup 完成..."
echo -e "   ${GREEN}[OK] 所有清理步骤完成${NC}"

# 标记 cleanup 完成（让 Stop Hook 知道可以退出了）
PROJECT_ROOT_FOR_DEVMODE=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
# v12.40.1: 支持 per-branch 格式（.dev-mode.${branch}），fallback 到旧格式（.dev-mode）
DEV_MODE_FILE="$PROJECT_ROOT_FOR_DEVMODE/.dev-mode.${CP_BRANCH}"
if [[ ! -f "$DEV_MODE_FILE" ]]; then
    DEV_MODE_FILE="$PROJECT_ROOT_FOR_DEVMODE/.dev-mode"
fi

# v1.9: 加载 lock-utils 并使用原子追加 + 协调信号
LOCK_UTILS=""
# v2.0 P1-4 修复：搜索路径加入 packages/engine/lib/（monorepo 结构）
for candidate in "$PROJECT_ROOT_FOR_DEVMODE/lib/lock-utils.sh" "$PROJECT_ROOT_FOR_DEVMODE/packages/engine/lib/lock-utils.sh" "$HOME/.claude/lib/lock-utils.sh"; do
    if [[ -f "$candidate" ]]; then
        # shellcheck disable=SC1090
        source "$candidate"
        LOCK_UTILS="$candidate"
        break
    fi
done

if [[ -f "$DEV_MODE_FILE" ]] && [[ "${VALIDATION_PASSED:-true}" == "true" ]]; then
    # W8: 统一标记方式（使用 step_11_cleanup: done）
    # v12.41.0 P0-1 修复：sed 替换后验证结果，若行不存在则追加
    # （sed 's/A/B/' 在目标行不存在时静默成功，返回 exit 0，不做任何修改）
    _mark_cleanup_done() {
        local target_file="$1"
        sed -i 's/^step_11_cleanup: pending/step_11_cleanup: done/' "$target_file"
        # 验证：sed 可能没有匹配到（行不存在或格式不同）
        if ! grep -q "^step_11_cleanup: done" "$target_file" 2>/dev/null; then
            # 先删除可能存在的其他格式（如 step_11_cleanup: in_progress）
            sed -i '/^step_11_cleanup:/d' "$target_file"
            echo "step_11_cleanup: done" >> "$target_file"
        fi
    }

    if [[ -n "$LOCK_UTILS" ]] && type atomic_append_dev_mode &>/dev/null; then
        # P1-4 修复：保存 DEV_MODE_FILE（acquire_dev_mode_lock 调用 _get_lock_paths 会覆写）
        _SAVED_DEV_MODE_FILE="$DEV_MODE_FILE"
        # 使用原子操作：获取锁 → 更新 → 释放锁
        if acquire_dev_mode_lock 2; then
            DEV_MODE_FILE="$_SAVED_DEV_MODE_FILE"
            _mark_cleanup_done "$DEV_MODE_FILE"
            # v2.0 P1-16: 移除 create_cleanup_signal（stop-dev.sh 通过 grep .dev-mode 检查，不读信号文件）
            release_dev_mode_lock
            echo -e "   ${GREEN}[OK] 已标记 step_11_cleanup: done（原子写入）${NC}"
        else
            DEV_MODE_FILE="$_SAVED_DEV_MODE_FILE"
            # Fallback: 直接修改
            _mark_cleanup_done "$DEV_MODE_FILE"
            echo -e "   ${GREEN}[OK] 已标记 step_11_cleanup: done${NC}"
        fi
    else
        # Fallback: 无共享库时直接修改
        _mark_cleanup_done "$DEV_MODE_FILE"
        echo -e "   ${GREEN}[OK] 已标记 step_11_cleanup: done${NC}"
    fi

    # v12.9.0: 双钥匙状态机 - 状态文件由 Stop Hook 管理
    echo ""
    echo -e "   ${YELLOW}注意: .dev-mode、.dev-lock 和 sentinel 将由 Stop Hook 在工作流完成后自动删除${NC}"
    echo -e "   ${YELLOW}      cleanup.sh 只负责标记 step_11_cleanup: done${NC}"
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
