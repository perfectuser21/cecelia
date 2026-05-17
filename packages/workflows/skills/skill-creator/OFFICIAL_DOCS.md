# Claude Code Skills - 官方完整文档

> 来源：https://code.claude.com/docs/en/skills
> 最后更新：2026-02-10

[由于内容过长，这里是文档摘要。完整官方文档请访问上述链接]

## 核心概念

- Skills 扩展 Claude 的能力
- 创建 SKILL.md 文件包含指令
- Claude 自动或手动调用 Skills
- 遵循 Agent Skills 开放标准

## 关键字段

| 字段 | 说明 |
|------|------|
| `name` | Skill 名称（slash 命令）|
| `description` | 功能描述（Claude 用于选择）|
| `disable-model-invocation` | 阻止自动调用 |
| `user-invocable` | 从菜单隐藏 |
| `allowed-tools` | 允许的工具 |
| `context: fork` | 在 subagent 运行 |

## 官方资源

- 文档：https://code.claude.com/docs/en/skills
- 仓库：https://github.com/anthropics/skills
- 标准：https://agentskills.io
