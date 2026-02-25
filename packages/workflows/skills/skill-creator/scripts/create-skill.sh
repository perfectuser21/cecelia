#!/bin/bash
set -euo pipefail

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

# 日志函数
log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

# 路径常量
SKILLS_DIR="$HOME/.claude/skills"
ENGINE_DIR="$HOME/perfect21/cecelia/engine"
CORE_REGISTRY="$ENGINE_DIR/skills-registry.json"
PERSONAL_REGISTRY="$HOME/.claude/skills-registry.local.json"
LOADER_SCRIPT="$ENGINE_DIR/skill-loader.cjs"
SCRIPT_DIR="$(dirname "$0")"

# 显示帮助
show_help() {
    cat << EOF
用法: $0 <skill-name> <description> [type]

参数:
  skill-name    Skill 名称（kebab-case，如 my-skill）
  description   功能描述（一句话）
  type          simple 或 complex（默认: simple）
                simple: 只有 SKILL.md
                complex: 有 SKILL.md + scripts/

示例:
  $0 my-skill "我的新 Skill"
  $0 data-processor "数据处理工具" complex

步骤:
  1. 创建目录结构
  2. 生成 SKILL.md
  3. 更新 skills-registry.json
  4. 运行 skill-loader
  5. 验证安装
  6. 显示使用说明
EOF
}

# 验证技能名称格式
validate_skill_name() {
    local name="$1"
    if [[ ! "$name" =~ ^[a-z][a-z0-9-]*$ ]]; then
        log_error "Skill 名称格式错误。必须是 kebab-case（小写字母、数字、连字符）"
        log_error "正确示例: my-skill, data-processor, api-client"
        exit 1
    fi
}

# 检查技能是否已存在
check_skill_exists() {
    local name="$1"
    if [ -d "$SKILLS_DIR/$name" ]; then
        log_error "Skill '$name' 已存在于 $SKILLS_DIR/$name"
        exit 1
    fi

    # 检查 Core Registry
    if [ -f "$CORE_REGISTRY" ] && jq -e ".skills[\"$name\"]" "$CORE_REGISTRY" > /dev/null 2>&1; then
        log_error "Skill '$name' 已在 Core Registry 中注册"
        exit 1
    fi

    # 检查 Personal Registry
    if [ -f "$PERSONAL_REGISTRY" ] && jq -e ".skills[\"$name\"]" "$PERSONAL_REGISTRY" > /dev/null 2>&1; then
        log_error "Skill '$name' 已在 Personal Registry 中注册"
        exit 1
    fi
}

# 步骤 1: 创建目录
create_directory() {
    local name="$1"
    local type="$2"

    log_info "步骤 1/6: 创建目录结构..."
    mkdir -p "$SKILLS_DIR/$name"

    if [ "$type" = "complex" ]; then
        mkdir -p "$SKILLS_DIR/$name/scripts"
        log_info "  ✓ 创建了 scripts/ 目录"
    fi

    log_info "  ✓ 目录创建完成: $SKILLS_DIR/$name"
}

# 步骤 2: 生成 SKILL.md
generate_skill_md() {
    local name="$1"
    local description="$2"
    local type="$3"

    log_info "步骤 2/6: 生成 SKILL.md..."

    local skill_file="$SKILLS_DIR/$name/SKILL.md"

    cat > "$skill_file" << EOF
---
name: $name
description: $description
---

# $name

## 触发方式

- \`/$name [args]\`
- 用户提到"<关键词>"

## 功能

$description

## 使用示例

\`\`\`bash
/$name arg1 arg2
\`\`\`

## 执行逻辑

1. <步骤 1>
2. <步骤 2>
3. <步骤 3>

EOF

    if [ "$type" = "complex" ]; then
        cat >> "$skill_file" << EOF
## 工具路径

- 主脚本: \`~/.claude/skills/$name/scripts/main.sh\`
- 其他工具路径

EOF
    fi

    cat >> "$skill_file" << EOF
## 错误处理

- **场景 1** → 处理方式
- **场景 2** → 处理方式

---

**创建时间**: $(date +%Y-%m-%d)
**创建方式**: skill-creator 自动生成
EOF

    log_info "  ✓ SKILL.md 已生成"
}

# 步骤 3: 分类并注册
classify_and_register() {
    local name="$1"
    local description="$2"

    log_info "步骤 3/6: 分类并注册 Skill..."

    # 调用分类脚本
    local classification
    classification=$("$SCRIPT_DIR/classify-skill.sh" "$name" "$description")

    # 调用注册脚本
    "$SCRIPT_DIR/register-skill.sh" "$classification" "$name" "$description" "$SKILLS_DIR/$name"

    # 返回分类结果
    echo "$classification"
}

# 步骤 4: 运行 loader
run_loader() {
    log_info "步骤 4/6: 运行 skill-loader..."

    cd "$ENGINE_DIR"
    node skill-loader.cjs load > /dev/null 2>&1

    log_info "  ✓ Skill 已加载"
}

# 步骤 5: 验证
verify_installation() {
    local name="$1"

    log_info "步骤 5/6: 验证安装..."

    # 检查目录
    if [ ! -d "$SKILLS_DIR/$name" ]; then
        log_error "  ✗ 目录不存在: $SKILLS_DIR/$name"
        return 1
    fi
    log_info "  ✓ 目录存在"

    # 检查 SKILL.md
    if [ ! -f "$SKILLS_DIR/$name/SKILL.md" ]; then
        log_error "  ✗ SKILL.md 不存在"
        return 1
    fi
    log_info "  ✓ SKILL.md 存在"

    # 检查 registry（Core 或 Personal）
    local found=false
    if [ -f "$CORE_REGISTRY" ] && jq -e ".skills[\"$name\"]" "$CORE_REGISTRY" > /dev/null 2>&1; then
        log_info "  ✓ Core Registry 已注册"
        found=true
    fi

    if [ -f "$PERSONAL_REGISTRY" ] && jq -e ".skills[\"$name\"]" "$PERSONAL_REGISTRY" > /dev/null 2>&1; then
        log_info "  ✓ Personal Registry 已注册"
        found=true
    fi

    if [ "$found" = false ]; then
        log_error "  ✗ Registry 中未找到"
        return 1
    fi

    log_info "  ✓ 验证通过"
}

# 步骤 6: 显示使用说明
show_usage() {
    local name="$1"
    local type="$2"
    local classification="${3:-personal}"

    log_info "步骤 6/6: 使用说明"

    cat << EOF

${GREEN}✅ Skill '$name' 创建成功！${NC}

📁 位置: $SKILLS_DIR/$name
🏷️  分类: $([ "$classification" = "core" ] && echo -e "${RED}Core Skill${NC}" || echo -e "${GREEN}Personal Skill${NC}")
📝 文件:
   - SKILL.md $([ "$type" = "complex" ] && echo "
   - scripts/ (为空，需要添加脚本)" || "")

EOF

    if [ "$classification" = "core" ]; then
        cat << EOF
${YELLOW}⚠️  Core Skill 需要额外步骤：${NC}

   1. 移动到 engine/skills/ 目录
   2. 提交 Core Registry 变更（需要 PR）
   3. 参考注册脚本输出的详细说明

EOF
    else
        cat << EOF
${GREEN}✅ Personal Skill 已完成：${NC}

   • Registry: ~/.claude/skills-registry.local.json
   • 可随时修改，无需 PR
   • 只影响本地环境

EOF
    fi

    cat << EOF
📋 下一步:
   1. 编辑 SKILL.md，完善 Skill 功能描述
   2. 添加具体的触发词和执行逻辑
EOF

    if [ "$type" = "complex" ]; then
        cat << EOF
   3. 在 scripts/ 目录创建脚本
   4. 在 SKILL.md 中引用脚本路径
EOF
    fi

    cat << EOF

🧪 测试:
   /$name

📖 查看文档:
   cat $SKILLS_DIR/$name/SKILL.md

🔄 重新加载（如果修改了 SKILL.md）:
   cd $ENGINE_DIR && node skill-loader.cjs load

---
EOF
}

# 主函数
main() {
    # 参数检查
    if [ $# -lt 2 ]; then
        show_help
        exit 1
    fi

    local skill_name="${1}"
    local description="${2}"
    local type="${3:-simple}"

    # 验证参数
    if [ "$type" != "simple" ] && [ "$type" != "complex" ]; then
        log_error "Type 必须是 'simple' 或 'complex'"
        exit 1
    fi

    # 验证技能名称
    validate_skill_name "$skill_name"

    # 检查是否已存在
    check_skill_exists "$skill_name"

    # 依赖检查
    command -v jq &> /dev/null || { log_error "jq 未安装"; exit 1; }
    command -v node &> /dev/null || { log_error "node 未安装"; exit 1; }

    # 执行 6 步流程
    echo ""
    log_info "开始创建 Skill: $skill_name"
    log_info "描述: $description"
    log_info "类型: $type"
    echo ""

    create_directory "$skill_name" "$type"
    generate_skill_md "$skill_name" "$description" "$type"

    # 分类并注册
    local classification
    classification=$(classify_and_register "$skill_name" "$description")

    run_loader
    verify_installation "$skill_name"
    show_usage "$skill_name" "$type" "$classification"

    echo ""
    log_info "${GREEN}全部完成！${NC}"
}

main "$@"
