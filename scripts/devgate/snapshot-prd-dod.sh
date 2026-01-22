#!/usr/bin/env bash
# ============================================================================
# snapshot-prd-dod.sh
# ============================================================================
#
# PR 创建时自动保存 PRD/DoD 快照，包含完整 meta 信息。
#
# 用法：
#   bash scripts/devgate/snapshot-prd-dod.sh <PR_NUMBER> [OPTIONS]
#
# 选项：
#   --priority P0|P1|P2|P3|NONE   PR 优先级（默认从 PRD 内容检测）
#   --title "..."                  PR 标题
#   --merged <SHA>                 合并后的 commit SHA（可选，后续更新用）
#
# 示例：
#   bash scripts/devgate/snapshot-prd-dod.sh 204
#   bash scripts/devgate/snapshot-prd-dod.sh 204 --priority P1 --title "feat: add auth"
#
# 输出：
#   .history/PR-204-20260122-1048.prd.md
#   .history/PR-204-20260122-1048.dod.md
#
# Meta 格式（文件顶部）：
#   <!-- pr:204 base:develop priority:P1 head:abc123 merged: created:2026-01-22T10:48:00Z title:"feat: add auth" -->
#
# 返回码：
#   0 - 快照成功
#   1 - 参数错误或文件不存在
#
# ============================================================================

set -euo pipefail

# 颜色
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

# 默认值
PR_NUMBER=""
PRIORITY=""
TITLE=""
MERGED_SHA=""

# 解析参数
while [[ $# -gt 0 ]]; do
    case $1 in
        --priority)
            PRIORITY="$2"
            shift 2
            ;;
        --title)
            TITLE="$2"
            shift 2
            ;;
        --merged)
            MERGED_SHA="$2"
            shift 2
            ;;
        -*)
            echo "未知选项: $1" >&2
            exit 1
            ;;
        *)
            if [[ -z "$PR_NUMBER" ]]; then
                PR_NUMBER="$1"
            fi
            shift
            ;;
    esac
done

# 参数检查
if [[ -z "$PR_NUMBER" ]]; then
    echo "用法: bash scripts/devgate/snapshot-prd-dod.sh <PR_NUMBER>" >&2
    exit 1
fi

# 验证 PR 号是数字
if ! [[ "$PR_NUMBER" =~ ^[0-9]+$ ]]; then
    echo "错误: PR 号必须是数字" >&2
    exit 1
fi

# 找项目根目录
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$PROJECT_ROOT"

# 检查文件存在
PRD_FILE="$PROJECT_ROOT/.prd.md"
DOD_FILE="$PROJECT_ROOT/.dod.md"
HISTORY_DIR="$PROJECT_ROOT/.history"

if [[ ! -f "$PRD_FILE" ]]; then
    echo -e "${YELLOW}⚠️  .prd.md 不存在，跳过快照${NC}" >&2
    exit 0
fi

if [[ ! -f "$DOD_FILE" ]]; then
    echo -e "${YELLOW}⚠️  .dod.md 不存在，跳过快照${NC}" >&2
    exit 0
fi

# 创建 history 目录
mkdir -p "$HISTORY_DIR"

# 获取当前分支
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

# 获取 base 分支
BASE_BRANCH=$(git config "branch.$CURRENT_BRANCH.base-branch" 2>/dev/null || echo "develop")
if ! git rev-parse "$BASE_BRANCH" >/dev/null 2>&1; then
    BASE_BRANCH="develop"
fi

# 获取 head SHA
HEAD_SHA=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
HEAD_SHA_SHORT="${HEAD_SHA:0:7}"

# 自动检测优先级（如果未指定）
if [[ -z "$PRIORITY" ]]; then
    # 从 PRD 内容检测 Priority: P0|P1|P2|P3
    if grep -qiE "^Priority:\s*P0" "$PRD_FILE" 2>/dev/null; then
        PRIORITY="P0"
    elif grep -qiE "^Priority:\s*P1" "$PRD_FILE" 2>/dev/null; then
        PRIORITY="P1"
    elif grep -qiE "^Priority:\s*P2" "$PRD_FILE" 2>/dev/null; then
        PRIORITY="P2"
    elif grep -qiE "^Priority:\s*P3" "$PRD_FILE" 2>/dev/null; then
        PRIORITY="P3"
    else
        # 从 commit message 检测
        LAST_COMMIT=$(git log -1 --pretty=%B 2>/dev/null || echo "")
        if echo "$LAST_COMMIT" | grep -qiE "\[P0\]|P0:|^P0 "; then
            PRIORITY="P0"
        elif echo "$LAST_COMMIT" | grep -qiE "\[P1\]|P1:|^P1 "; then
            PRIORITY="P1"
        else
            PRIORITY="NONE"
        fi
    fi
fi

# 生成 ISO8601 时间戳
CREATED_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# 生成文件名时间戳
TIMESTAMP=$(date +%Y%m%d-%H%M)

# 生成文件名
PRD_SNAPSHOT="$HISTORY_DIR/PR-${PR_NUMBER}-${TIMESTAMP}.prd.md"
DOD_SNAPSHOT="$HISTORY_DIR/PR-${PR_NUMBER}-${TIMESTAMP}.dod.md"

# 构建 meta 行
# 格式: <!-- pr:N base:X priority:Y head:Z merged:W created:T title:"..." -->
META_LINE="<!-- pr:${PR_NUMBER} base:${BASE_BRANCH} priority:${PRIORITY} head:${HEAD_SHA_SHORT} merged:${MERGED_SHA:-} created:${CREATED_ISO}"
if [[ -n "$TITLE" ]]; then
    # 转义双引号
    ESCAPED_TITLE="${TITLE//\"/\\\"}"
    META_LINE="$META_LINE title:\"${ESCAPED_TITLE}\""
fi
META_LINE="$META_LINE -->"

# 复制文件并添加 meta
{
    echo "$META_LINE"
    echo ""
    cat "$PRD_FILE"
} > "$PRD_SNAPSHOT"

{
    echo "$META_LINE"
    echo ""
    cat "$DOD_FILE"
} > "$DOD_SNAPSHOT"

echo "" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "  PRD/DoD 快照已保存" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
echo "" >&2
echo -e "  ${GREEN}✅${NC} $(basename "$PRD_SNAPSHOT")" >&2
echo -e "  ${GREEN}✅${NC} $(basename "$DOD_SNAPSHOT")" >&2
echo "" >&2
echo "  Meta: pr:${PR_NUMBER} base:${BASE_BRANCH} priority:${PRIORITY}" >&2
echo "  存储位置: .history/" >&2
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2

exit 0
