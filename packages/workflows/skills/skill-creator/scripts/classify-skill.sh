#!/bin/bash
set -euo pipefail

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;36m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

# Skill 分类判定逻辑 v2.0
# 基于真实角色和使用场景，而非表面关键词

classify_skill() {
    local name="$1"
    local description="$2"

    echo ""
    log_info "🔍 分析 Skill 分类..."
    echo ""

    # 判定规则（基于 v2.0 算法）
    local score=0
    local reasons=()

    # 规则 1: 检查是否包含明确的系统级关键词
    if [[ "$description" =~ (CI|DevGate|发布|生产|部署|自动化流程|质量门禁|审计|OKR) ]]; then
        ((score += 10))
        reasons+=("包含系统级关键词")
    fi

    # 规则 2: 检查是否是工具型（生成器、调试器、查看器）
    if [[ "$description" =~ (生成|创建|调试|查看|分析|统计|管理) ]] && \
       [[ ! "$description" =~ (自动调用|被调用|触发|执行) ]]; then
        ((score -= 5))
        reasons+=("工具型 Skill（生成/查看/管理）")
    fi

    # 规则 3: 检查是否会被自动调用
    if [[ "$description" =~ (自动调用|Cecelia.*调用|N8N.*调用|定时|webhook) ]]; then
        ((score += 15))
        reasons+=("会被系统自动调用")
    fi

    # 规则 4: 检查是否只读/查询
    if [[ "$description" =~ (只读|查询|查看|列出|显示) ]] && \
       [[ ! "$description" =~ (修改|删除|创建|更新) ]]; then
        ((score -= 8))
        reasons+=("只读/查询操作，影响小")
    fi

    # 规则 5: 检查是否涉及敏感操作
    if [[ "$description" =~ (密钥|凭据|权限|数据库|删除|支付) ]]; then
        ((score += 10))
        reasons+=("涉及敏感操作")
    fi

    # 判定结果
    local classification
    local confidence

    if [ $score -ge 10 ]; then
        classification="core"
        confidence="high"
    elif [ $score -ge 5 ]; then
        classification="core"
        confidence="medium"
    elif [ $score -le -10 ]; then
        classification="personal"
        confidence="high"
    elif [ $score -le -5 ]; then
        classification="personal"
        confidence="medium"
    else
        classification="personal"
        confidence="low"
    fi

    # 输出分析结果
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  Skill 分类分析结果${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "📋 Skill: $name"
    echo "📝 描述: $description"
    echo ""
    echo "🎯 分类: $([ "$classification" = "core" ] && echo -e "${RED}Core Skill${NC}" || echo -e "${GREEN}Personal Skill${NC}")"
    echo "📊 置信度: $confidence"
    echo "⚖️  评分: $score"
    echo ""
    echo "💡 判定依据:"
    for reason in "${reasons[@]}"; do
        echo "   - $reason"
    done
    echo ""

    # 解释分类
    if [ "$classification" = "core" ]; then
        echo -e "${YELLOW}⚠️  Core Skill 特征：${NC}"
        echo "   • 会被 Cecelia/N8N 自动调用"
        echo "   • 影响系统稳定性或生产流程"
        echo "   • 涉及 CI/质量门禁/敏感操作"
        echo "   • 需要提交 PR 到 Core Registry"
        echo ""
    else
        echo -e "${GREEN}✅ Personal Skill 特征：${NC}"
        echo "   • 只有你手动调用"
        echo "   • 出错只影响你自己"
        echo "   • 工具型/查询型/管理型"
        echo "   • 直接写入 Personal Registry，无需 PR"
        echo ""
    fi

    # 输出结果到 JSON（供脚本使用）
    cat > /tmp/skill-classification-$name.json << EOF
{
  "name": "$name",
  "description": "$description",
  "classification": "$classification",
  "confidence": "$confidence",
  "score": $score,
  "reasons": $(printf '%s\n' "${reasons[@]}" | jq -R . | jq -s .)
}
EOF

    echo "$classification"  # 返回分类结果
}

# 主函数
main() {
    if [ $# -lt 2 ]; then
        echo "用法: $0 <skill-name> <description>"
        exit 1
    fi

    classify_skill "$1" "$2"
}

main "$@"
