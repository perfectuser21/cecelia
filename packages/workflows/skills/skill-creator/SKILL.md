# Skill Creator - 创建 Skills 的 Meta-Skill

## 触发方式

- `/skill-creator` - 查看完整文档
- `/skill-creator <name>` - 创建新 Skill
- 用户问"Skills 文档"、"如何创建 Skill"

## 功能

这是一个 **Meta-Skill**，帮助你理解和创建新的 Skills。

### 1. 完整官方文档

包含 Claude Code Skills 的所有官方文档。完整文档见 [OFFICIAL_DOCS.md](OFFICIAL_DOCS.md)

**核心概念**：
- Skills = 指令文件夹，教 Claude 完成特定任务
- `SKILL.md` 必需，其他文件可选
- 支持自动调用或手动触发（`/skill-name`）

### 2. 快速参考

**最小 Skill**：
```yaml
---
name: my-skill
description: What it does and when to use it
---

Your instructions here...
```

**关键字段**：
- `name`: slash 命令名
- `description`: 帮 Claude 决定何时使用
- `disable-model-invocation: true`: 只能手动触发
- `user-invocable: false`: 只能 Claude 调用
- `allowed-tools`: 限制工具访问
- `context: fork`: 在 subagent 运行

**参数替换**：
- `$ARGUMENTS` - 所有参数
- `$0`, `$1`, `$2` - 单个参数
- `${CLAUDE_SESSION_ID}` - 会话 ID

**动态注入**：
- `` !`command` `` - 预处理执行命令，输出替换占位符

### 3. 双 Registry 治理模型（v2.0）

**两层 Skills 管理**：

| Registry | 位置 | 适用场景 | 管理方式 |
|----------|------|----------|----------|
| **Core Registry** | `engine/skills-registry.json` | 系统级 Skills，被 Cecelia 自动调用 | 需要 PR |
| **Personal Registry** | `~/.claude/skills-registry.local.json` | 个人工具，手动调用 | 随意修改 |

**自动分类逻辑（v2.0）**：

skill-creator 会自动分析 Skill 描述，判定 Core vs Personal：

```
Core Skills 特征：
• 会被 Cecelia/N8N 自动调用
• 影响系统稳定性或生产流程
• 涉及 CI/质量门禁/敏感操作

Personal Skills 特征：
• 只有你手动调用
• 出错只影响你自己
• 工具型/查询型/管理型
```

**Registry 格式**：
```json
{
  "skill-id": {
    "name": "显示名称",
    "description": "功能描述",
    "type": "absolute|engine|workspace",
    "path": "/path/to/skill",
    "entry": "SKILL.md",
    "enabled": true
  }
}
```

**Skill 类型**：
- `absolute`: 绝对路径（Personal Skills）
- `engine`: 相对于 engine/（Core Skills）
- `workspace`: 相对于 workspace/（Core Skills）

**管理命令**：
```bash
cd /home/xx/perfect21/cecelia/engine

# 加载 Skills（创建 symlinks）
node skill-loader.cjs load

# 列出已注册 Skills
node skill-loader.cjs list

# 验证安装
node skill-loader.cjs verify
```

### 4. 创建新 Skill（自动化）

**用法**：

```bash
/skill-creator <skill-name> "<description>" [type]
```

**示例**：

```bash
# Simple Skill（只有 SKILL.md）
/skill-creator my-skill "我的新 Skill"

# Complex Skill（有 SKILL.md + scripts/）
/skill-creator data-processor "数据处理工具" complex
```

**执行流程**（全自动）：

!`~/.claude/skills/skill-creator/scripts/create-skill.sh $ARGUMENTS`

---

## SKILL.md 标准模板

```markdown
# <Skill Name>

## 触发方式

- `/<command> [args]`
- 用户提到"<关键词>"

## 功能

<功能描述>

## 使用示例

\`\`\`bash
/<command> arg1 arg2
\`\`\`

## 执行逻辑

1. <步骤 1>
2. <步骤 2>
3. <步骤 3>

## 工具路径

- 脚本：`~/.claude/skills/<name>/scripts/main.sh`
- 其他工具路径

## 错误处理

- **场景 1** → 处理方式
- **场景 2** → 处理方式
```

---

## 脚本模板（Complex Skills）

```bash
#!/bin/bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }

main() {
    local command="${1:-help}"
    case "$command" in
        help) show_help ;;
        *) log_error "Unknown: $command"; exit 1 ;;
    esac
}

show_help() {
    cat << EOF
Usage: $0 <command>

Commands:
  help    Show this help
EOF
}

main "$@"
```

---

## Skills 存储位置

| 位置 | 路径 | 适用范围 |
|------|------|----------|
| Personal | `~/.claude/skills/<name>/` | 你的所有项目 |
| Project | `.claude/skills/<name>/` | 仅当前项目 |
| Plugin | `<plugin>/skills/<name>/` | Plugin 启用处 |

优先级：personal > project

---

## 最佳实践

### 命名

- Skill ID: kebab-case (`my-skill-name`)
- 函数: snake_case (`process_data`)
- 文件: kebab-case (`helper-script.sh`)

### 文档

- ✅ 清晰的触发方式
- ✅ 实际使用示例
- ✅ 错误处理说明
- ✅ 具体场景

### 脚本

- ✅ `set -euo pipefail`
- ✅ 颜色输出
- ✅ `--help` 选项
- ✅ 错误码规范（0=成功，1=失败）

---

## 故障排查

### Skill 未被识别

```bash
# 检查 registry
jq '.skills["<name>"]' /home/xx/perfect21/cecelia/engine/skills-registry.json

# 检查路径
ls -la ~/.claude/skills/<name>

# 重新加载
cd /home/xx/perfect21/cecelia/engine && node skill-loader.cjs load
```

### Symlink 错误

```bash
# 删除旧链接
rm ~/.claude/skills/<name>

# 重新加载
cd /home/xx/perfect21/cecelia/engine && node skill-loader.cjs load
```

### Registry 格式错误

```bash
# 验证 JSON
jq . /home/xx/perfect21/cecelia/engine/skills-registry.json
```

---

## 相关资源

**官方**：
- [Skills 文档](https://code.claude.com/docs/en/skills)
- [Skills 仓库](https://github.com/anthropics/skills)
- [Agent Skills 标准](https://agentskills.io)

**相关主题**：
- Subagents: /en/sub-agents
- Plugins: /en/plugins
- Hooks: /en/hooks
- Memory: /en/memory

---

**现在 skill-creator 包含完整文档，直接问它任何 Skills 相关问题！** 🎉
