#!/bin/bash
set -euo pipefail

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

# 路径常量
SKILLS_DIR="$HOME/.claude/skills"
ENGINE_DIR="$HOME/perfect21/cecelia/engine"
CORE_REGISTRY="$ENGINE_DIR/skills-registry.json"
PERSONAL_REGISTRY="$HOME/.claude/skills-registry.local.json"

# 注册到 Core Registry
register_to_core() {
    local name="$1"
    local description="$2"
    local skill_path="$3"

    log_info "注册到 Core Registry..."

    # 检查 Core Registry 是否存在
    if [ ! -f "$CORE_REGISTRY" ]; then
        log_error "Core Registry 不存在: $CORE_REGISTRY"
        exit 1
    fi

    # 备份 Core Registry
    cp "$CORE_REGISTRY" "$CORE_REGISTRY.backup"
    log_info "  ✓ 备份已创建: $CORE_REGISTRY.backup"

    # 使用 jq 添加新 skill
    local tmp_file=$(mktemp)
    jq ".skills[\"$name\"] = {
        \"name\": \"$description\",
        \"description\": \"$description\",
        \"type\": \"engine\",
        \"path\": \"skills/$name\",
        \"entry\": \"SKILL.md\",
        \"enabled\": true
    } | .updated = \"$(date +%Y-%m-%d)\"" "$CORE_REGISTRY" > "$tmp_file"

    mv "$tmp_file" "$CORE_REGISTRY"

    echo ""
    log_warn "⚠️  Core Skill 需要提交 PR！"
    echo ""
    echo "下一步操作："
    echo "  1. 将 Skill 移动到 engine/skills/ 目录"
    echo "     mv $skill_path $ENGINE_DIR/skills/$name"
    echo ""
    echo "  2. 提交 Core Registry 变更（需要 PR）"
    echo "     cd $ENGINE_DIR"
    echo "     git add skills-registry.json skills/$name"
    echo "     git commit -m \"feat: add $name skill\""
    echo "     git push origin <branch>"
    echo ""
    echo "  3. 创建 PR 到 develop 分支"
    echo ""
}

# 注册到 Personal Registry
register_to_personal() {
    local name="$1"
    local description="$2"
    local skill_path="$3"

    log_info "注册到 Personal Registry..."

    # 如果 Personal Registry 不存在，创建
    if [ ! -f "$PERSONAL_REGISTRY" ]; then
        log_info "  创建 Personal Registry: $PERSONAL_REGISTRY"
        cat > "$PERSONAL_REGISTRY" << EOF
{
  "version": "1.0.0",
  "updated": "$(date +%Y-%m-%d)",
  "skills": {}
}
EOF
    fi

    # 备份 Personal Registry
    cp "$PERSONAL_REGISTRY" "$PERSONAL_REGISTRY.backup"
    log_info "  ✓ 备份已创建: $PERSONAL_REGISTRY.backup"

    # 使用 jq 添加新 skill
    local tmp_file=$(mktemp)
    jq ".skills[\"$name\"] = {
        \"name\": \"$description\",
        \"description\": \"$description\",
        \"type\": \"absolute\",
        \"path\": \"$skill_path\",
        \"entry\": \"SKILL.md\",
        \"enabled\": true
    } | .updated = \"$(date +%Y-%m-%d)\"" "$PERSONAL_REGISTRY" > "$tmp_file"

    mv "$tmp_file" "$PERSONAL_REGISTRY"
    log_info "  ✓ Personal Registry 已更新"

    echo ""
    log_info "✅ Personal Skill 注册完成！"
    echo ""
    echo "Personal Skills 特点："
    echo "  • 随时修改，无需 PR"
    echo "  • 只影响你的本地环境"
    echo "  • Registry: $PERSONAL_REGISTRY"
    echo ""
}

# 主函数
main() {
    if [ $# -lt 4 ]; then
        echo "用法: $0 <classification> <skill-name> <description> <skill-path>"
        exit 1
    fi

    local classification="$1"
    local name="$2"
    local description="$3"
    local skill_path="$4"

    # 依赖检查
    command -v jq &> /dev/null || { log_error "jq 未安装"; exit 1; }

    echo ""
    if [ "$classification" = "core" ]; then
        register_to_core "$name" "$description" "$skill_path"
    else
        register_to_personal "$name" "$description" "$skill_path"
    fi
}

main "$@"
