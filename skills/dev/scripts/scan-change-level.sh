#!/usr/bin/env bash
# ============================================================================
# 改动层级扫描脚本
# ============================================================================
#
# 功能：根据实际改动的文件类型，自动判断需要的质检层级
#
# 用法：
#   ./scan-change-level.sh              # 扫描 git diff 的改动
#   ./scan-change-level.sh --staged     # 扫描已暂存的改动
#   ./scan-change-level.sh --desc "需求描述"  # 根据描述推断
#
# 输出：建议的测试层级 T1-T6
#
# 注意：T1-T6 是"测试复杂度层级"，与质检三层 L1/L2/L3 是不同概念
#   - 质检三层 (L1/L2/L3): 自动化测试 / 效果验证 / 需求验收
#   - 测试层级 (T1-T6): 静态分析 / 单元测试 / 集成测试 / E2E / 性能 / 安全
#
# ============================================================================

set -euo pipefail

MODE="diff"
DESC=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --staged)
            MODE="staged"
            shift
            ;;
        --desc)
            # L1 fix: 检查 --desc 是否带参数，防止越界
            if [[ -z "${2:-}" ]]; then
                echo "错误: --desc 需要提供描述参数"
                echo "用法: $0 --desc \"需求描述\""
                exit 1
            fi
            MODE="desc"
            DESC="$2"
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done

# 测试层级定义（T = Test Level，区别于质检层级 L1/L2/L3）
# T1 = 静态分析（文档、配置）
# T2 = 单元测试（工具函数、纯逻辑）
# T3 = 集成测试（API、数据库）
# T4 = E2E 测试（前端页面、用户流程）
# T5 = 性能测试（优化、benchmark）
# T6 = 安全测试（认证、加密、漏洞）

LEVEL=1
REASON=""

# ===== 根据描述推断 =====
if [[ "$MODE" == "desc" && -n "$DESC" ]]; then
    DESC_LOWER=$(echo "$DESC" | tr '[:upper:]' '[:lower:]')

    # L6 安全相关
    if echo "$DESC_LOWER" | grep -qE "(安全|security|漏洞|vulnerability|认证|auth|加密|encrypt|token|密码|password|secret)"; then
        LEVEL=6
        REASON="需求涉及安全相关"
    # L5 性能相关
    elif echo "$DESC_LOWER" | grep -qE "(性能|performance|优化|optimize|benchmark|速度|缓存|cache)"; then
        LEVEL=5
        REASON="需求涉及性能优化"
    # L4 前端/UI 相关
    elif echo "$DESC_LOWER" | grep -qE "(页面|page|组件|component|ui|界面|前端|frontend|样式|style|css|布局|layout|用户体验|ux)"; then
        LEVEL=4
        REASON="需求涉及用户界面"
    # L3 API/集成相关
    elif echo "$DESC_LOWER" | grep -qE "(api|接口|endpoint|数据库|database|db|集成|integration|服务|service|请求|request)"; then
        LEVEL=3
        REASON="需求涉及 API/集成"
    # L2 函数/逻辑相关
    elif echo "$DESC_LOWER" | grep -qE "(函数|function|工具|util|helper|逻辑|logic|算法|algorithm|计算|calculate)"; then
        LEVEL=2
        REASON="需求涉及函数/逻辑"
    # L1 文档/配置
    elif echo "$DESC_LOWER" | grep -qE "(文档|doc|readme|配置|config|setting|changelog)"; then
        LEVEL=1
        REASON="需求涉及文档/配置"
    else
        LEVEL=2
        REASON="默认单元测试级别"
    fi

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  需求分析结果"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "  建议测试层级: T$LEVEL"
    echo "  原因: $REASON"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 0
fi

# ===== 根据文件改动推断 =====
if [[ "$MODE" == "staged" ]]; then
    FILES=$(git diff --cached --name-only 2>/dev/null || echo "")
else
    FILES=$(git diff --name-only 2>/dev/null || echo "")
fi

if [[ -z "$FILES" ]]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  没有检测到改动文件"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 0
fi

FILE_COUNT=$(echo "$FILES" | wc -l)
REASONS=()

# 检查每个文件
while IFS= read -r file; do
    [[ -z "$file" ]] && continue

    # 获取文件扩展名和路径
    ext="${file##*.}"
    dir=$(dirname "$file")

    # L6 安全相关文件
    if echo "$file" | grep -qiE "(auth|security|crypto|secret|credential|password|token)"; then
        [[ $LEVEL -lt 6 ]] && LEVEL=6 && REASONS+=("安全相关: $file")
    # L5 性能相关
    elif echo "$file" | grep -qiE "(benchmark|perf|cache|optimize)"; then
        [[ $LEVEL -lt 5 ]] && LEVEL=5 && REASONS+=("性能相关: $file")
    # L4 前端文件
    elif [[ "$ext" =~ ^(tsx|jsx|vue|svelte|css|scss|less|html)$ ]]; then
        [[ $LEVEL -lt 4 ]] && LEVEL=4 && REASONS+=("前端文件: $file")
    elif echo "$dir" | grep -qiE "(pages|app|components|views|layouts)"; then
        [[ $LEVEL -lt 4 ]] && LEVEL=4 && REASONS+=("前端目录: $file")
    # L3 API/集成
    elif echo "$dir" | grep -qiE "(api|routes|controllers|services|handlers)"; then
        [[ $LEVEL -lt 3 ]] && LEVEL=3 && REASONS+=("API/服务: $file")
    elif echo "$file" | grep -qiE "(prisma|migration|schema\.sql)"; then
        [[ $LEVEL -lt 3 ]] && LEVEL=3 && REASONS+=("数据库: $file")
    # L2 代码文件
    elif [[ "$ext" =~ ^(ts|js|py|go|rs|java|rb|php|sh)$ ]]; then
        [[ $LEVEL -lt 2 ]] && LEVEL=2 && REASONS+=("代码文件: $file")
    # L1 文档/配置
    elif [[ "$ext" =~ ^(md|json|yaml|yml|toml|ini|conf)$ ]]; then
        REASONS+=("文档/配置: $file")
    fi
done <<< "$FILES"

# 文件数量也影响层级（改动越多越需要全面测试）
if [[ $FILE_COUNT -gt 10 && $LEVEL -lt 3 ]]; then
    LEVEL=3
    REASONS+=("改动文件超过 10 个，建议集成测试")
elif [[ $FILE_COUNT -gt 5 && $LEVEL -lt 2 ]]; then
    LEVEL=2
    REASONS+=("改动文件超过 5 个，建议单元测试")
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  改动扫描结果"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  改动文件: $FILE_COUNT 个"
echo "  建议测试层级: T$LEVEL"
echo ""
echo "  判断依据:"
for r in "${REASONS[@]}"; do
    echo "    - $r"
done
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
