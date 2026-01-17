# zenithjoy-engine

AI 开发工作流核心组件。提供 Hooks、Skills 和 CI 模板，实现强制的开发流程保护。

## 功能

- **分支保护 Hook**: 强制在 `cp-*` 或 `feature/*` 分支开发
- **CI 自动合并**: PR 通过 CI 后自动合并
- **统一开发 Skill**: `/dev` 一个对话完成整个开发流程

## Prerequisites

- **gh CLI**: GitHub CLI (`gh auth login` 已完成)
- **jq**: JSON 处理工具 (`apt install jq`)
- **Node.js**: 18+ (CI 使用 20)

## Environment Variables

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ZENITHJOY_ENGINE` | `/home/xx/dev/zenithjoy-engine` | Engine 根目录 |

设置方式：
```bash
export ZENITHJOY_ENGINE="/path/to/zenithjoy-engine"
```

## Installation

### 1. 链接 Hooks

```bash
ln -sf $ZENITHJOY_ENGINE/hooks/branch-protect.sh ~/.claude/hooks/
ln -sf $ZENITHJOY_ENGINE/hooks/bash-guard.sh ~/.claude/hooks/
ln -sf $ZENITHJOY_ENGINE/hooks/project-detect.sh ~/.claude/hooks/
```

### 2. 链接 Skills

```bash
ln -sf $ZENITHJOY_ENGINE/skills/dev ~/.claude/skills/
```

### 3. 复制 CI 模板

```bash
cp $ZENITHJOY_ENGINE/.github/workflows/ci.yml your-project/.github/workflows/
```

## Hooks 配置

在 `~/.claude/settings.json` 中配置：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [{"type": "command", "command": "~/.claude/hooks/branch-protect.sh"}]
      },
      {
        "matcher": "Bash",
        "hooks": [{"type": "command", "command": "~/.claude/hooks/bash-guard.sh"}]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{"type": "command", "command": "~/.claude/hooks/project-detect.sh"}]
      }
    ]
  }
}
```

| Hook | 触发时机 | 用途 |
|------|----------|------|
| branch-protect.sh | PreToolUse (Write/Edit) | 强制在 cp-* 或 feature/* 分支修改代码 |
| bash-guard.sh | PreToolUse (Bash) | 步骤状态机守卫 + PR 前检查 |
| project-detect.sh | PostToolUse (Bash) | 检测项目初始化状态 |

## Usage

### 开发流程

```
/dev 开始
  → 检查分支 (git)
  → 创建 cp-* 分支
  → PRD + DoD → 用户确认
  → 写代码 + 自测
  → PR + 等待 CI
  → cleanup + learn
  → 完成
```

### 命令

| 命令 | 说明 |
|------|------|
| `/dev` | 启动开发流程（唯一入口） |

## 分支保护

GitHub 层面的强制保护：
- main 禁止直接 push
- PR 必须过 CI
- CI 通过后自动合并

## License

ISC
