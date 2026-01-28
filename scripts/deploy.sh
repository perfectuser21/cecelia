#!/usr/bin/env bash
# ============================================================================
# deploy.sh - 部署稳定版本到 ~/.claude/
# v1.1.0: rm -rf 安全验证
# ============================================================================
#
# 用法: bash scripts/deploy.sh [OPTIONS]
#
# OPTIONS:
#   --from-main   从 main 分支部署（推荐用于生产环境）
#   --dry-run     显示将要执行的操作，但不实际执行
#   -h, --help    显示帮助
#
# 同步内容:
#   - hooks/    → ~/.claude/hooks/
#   - skills/   → ~/.claude/skills/
#
# 注意：这是手动操作，不会自动执行
# ============================================================================

set -euo pipefail

# 颜色
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

# v1.1.0: 安全删除目录 - 验证路径有效性
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

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_ROOT="$(dirname "$SCRIPT_DIR")"

# 目标目录
TARGET_DIR="$HOME/.claude"

# L3 fix: 添加 --dry-run 选项
FROM_MAIN=false
DRY_RUN=false

# 解析参数
while [[ $# -gt 0 ]]; do
    case $1 in
        --from-main)
            FROM_MAIN=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        -h|--help)
            echo "用法: $0 [OPTIONS]"
            echo ""
            echo "OPTIONS:"
            echo "  --from-main   从 main 分支部署"
            echo "  --dry-run     显示将要执行的操作"
            echo "  -h, --help    显示帮助"
            exit 0
            ;;
        *)
            echo -e "${RED}未知选项: $1${NC}"
            exit 1
            ;;
    esac
done

# L3 fix: 用文字替代 emoji，避免终端兼容问题
echo ""
echo "========================================"
echo "  Deploy ZenithJoy Engine"
[[ "$DRY_RUN" == "true" ]] && echo "  (DRY RUN - no changes will be made)"
echo "========================================"
echo ""

# ========================================
# 如果指定 --from-main，先切换到 main
# ========================================
CURRENT_BRANCH=""
if [[ "$FROM_MAIN" == "true" ]]; then
    cd "$ENGINE_ROOT"
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

    echo -e "${BLUE}从 main 分支部署...${NC}"
    echo ""

    # L2 fix: 检查工作区和暂存区的改动
    if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
        echo -e "${RED}错误: 有未提交的改动，请先提交或 stash${NC}"
        exit 1
    fi

    # L2 fix: 不吞 git fetch/pull 错误
    echo "  Fetching main branch..."
    if ! git fetch origin main 2>&1; then
        echo -e "${YELLOW}警告: git fetch 失败，继续使用本地版本${NC}"
    fi

    git checkout main 2>/dev/null || {
        echo -e "${RED}错误: 无法切换到 main 分支${NC}"
        exit 1
    }

    echo "  Pulling latest changes..."
    if ! git pull origin main 2>&1; then
        echo -e "${YELLOW}警告: git pull 失败，继续使用本地版本${NC}"
    fi

    echo "  当前: main 分支"
    echo "  版本: $(grep '"version"' package.json | head -1 | cut -d'"' -f4)"
    echo ""
fi

echo "  源目录: $ENGINE_ROOT"
echo "  目标:   $TARGET_DIR"
echo ""

# ========================================
# 1. 同步 hooks/
# ========================================
echo -e "${BLUE}[1] 同步 hooks/${NC}"

if [[ -d "$ENGINE_ROOT/hooks" ]]; then
    [[ "$DRY_RUN" != "true" ]] && mkdir -p "$TARGET_DIR/hooks"

    for f in "$ENGINE_ROOT/hooks/"*.sh; do
        [[ -e "$f" ]] || continue
        if [[ -f "$f" ]]; then
            filename=$(basename "$f")

            if [[ "$DRY_RUN" == "true" ]]; then
                echo -e "   [DRY-RUN] Would sync: $filename"
            elif [[ -f "$TARGET_DIR/hooks/$filename" ]]; then
                if diff -q "$f" "$TARGET_DIR/hooks/$filename" > /dev/null 2>&1; then
                    echo -e "   ${GREEN}[OK]${NC} $filename (no change)"
                else
                    cp "$f" "$TARGET_DIR/hooks/$filename"
                    chmod +x "$TARGET_DIR/hooks/$filename"
                    echo -e "   ${YELLOW}[UP]${NC} $filename (updated)"
                fi
            else
                cp "$f" "$TARGET_DIR/hooks/$filename"
                chmod +x "$TARGET_DIR/hooks/$filename"
                echo -e "   ${GREEN}[+]${NC} $filename (new)"
            fi
        fi
    done
else
    echo "   [WARN] hooks/ directory not found"
fi

echo ""

# ========================================
# 2. 同步 skills/
# ========================================
echo -e "${BLUE}[2] 同步 skills/${NC}"

if [[ -d "$ENGINE_ROOT/skills" ]]; then
    [[ "$DRY_RUN" != "true" ]] && mkdir -p "$TARGET_DIR/skills"

    for skill_dir in "$ENGINE_ROOT/skills/"*/; do
        [[ -e "$skill_dir" ]] || continue
        if [[ -d "$skill_dir" ]]; then
            skill_name=$(basename "$skill_dir")
            target_skill="$TARGET_DIR/skills/$skill_name"

            if [[ "$DRY_RUN" == "true" ]]; then
                echo -e "   [DRY-RUN] Would sync: $skill_name/"
            elif command -v rsync &> /dev/null; then
                rsync -a --delete "$skill_dir" "$target_skill/" 2>/dev/null
                echo -e "   ${GREEN}[OK]${NC} $skill_name/"
            else
                # v1.1.0: 使用安全删除，限制在 ~/.claude 目录内
                if safe_rm_rf "$target_skill" "$TARGET_DIR"; then
                    cp -r "$skill_dir" "$target_skill"
                    echo -e "   ${GREEN}[OK]${NC} $skill_name/ (cp)"
                else
                    echo -e "   ${RED}[FAIL]${NC} $skill_name/ (安全检查失败)"
                fi
            fi
        fi
    done
else
    echo "   [WARN] skills/ directory not found"
fi

echo ""

# ========================================
# 3. 验证
# ========================================
echo -e "${BLUE}[3] 验证部署${NC}"

# L2 fix: 使用数组计数避免 ls | wc -l 的错误输出问题
if [[ "$DRY_RUN" == "true" ]]; then
    echo "   [DRY-RUN] Skipping verification"
else
    HOOKS_COUNT=0
    SKILLS_COUNT=0

    if [[ -d "$TARGET_DIR/hooks" ]]; then
        for f in "$TARGET_DIR/hooks/"*.sh; do
            [[ -e "$f" ]] && HOOKS_COUNT=$((HOOKS_COUNT + 1))
        done
    fi

    if [[ -d "$TARGET_DIR/skills" ]]; then
        for d in "$TARGET_DIR/skills/"*/; do
            [[ -d "$d" ]] && SKILLS_COUNT=$((SKILLS_COUNT + 1))
        done
    fi

    echo "   Hooks:  $HOOKS_COUNT"
    echo "   Skills: $SKILLS_COUNT"
fi

# ========================================
# 4. 如果之前切换了分支，切回去
# ========================================
if [[ -n "$CURRENT_BRANCH" && "$CURRENT_BRANCH" != "main" ]]; then
    echo ""
    echo -e "${BLUE}[4] 切回原分支${NC}"
    git checkout "$CURRENT_BRANCH" 2>/dev/null
    echo "   Switched back to $CURRENT_BRANCH"
fi

echo ""
echo "========================================"
if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "  ${GREEN}[DRY RUN] Complete${NC}"
else
    echo -e "  ${GREEN}[OK] Deploy Complete${NC}"
fi
if [[ "$FROM_MAIN" == "true" ]]; then
    echo "  (deployed from main branch)"
fi
echo "========================================"
echo ""
