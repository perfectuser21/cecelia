# zenithjoy-engine

AI 开发工作流核心组件。提供 Hooks、Skills 和 CI 模板，实现引导式的开发流程保护。

## 功能

- **分支保护 Hook**: 引导在 `cp-*` 或 `feature/*` 分支开发
- **CI 自动合并**: PR 通过 CI 后自动合并
- **统一开发 Skill**: `/dev` 一个对话完成整个开发流程

## Prerequisites

- **gh CLI**: GitHub CLI (`gh auth login` 已完成)
- **jq**: JSON 处理工具 (`apt install jq`)
- **yq**: YAML 处理工具 (`apt install yq` 或 `brew install yq`)
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
ln -sf $ZENITHJOY_ENGINE/hooks/stop.sh ~/.claude/hooks/
ln -sf $ZENITHJOY_ENGINE/hooks/credential-guard.sh ~/.claude/hooks/
```

> **注意**: `pr-gate-v2.sh` 已在 v12.4.5 废弃，质量检查完全交给 CI。

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
        "hooks": [
          {"type": "command", "command": "~/.claude/hooks/branch-protect.sh"},
          {"type": "command", "command": "~/.claude/hooks/credential-guard.sh"}
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [{"type": "command", "command": "~/.claude/hooks/stop.sh"}]
      }
    ]
  }
}
```

| Hook | 触发时机 | 用途 |
|------|----------|------|
| branch-protect.sh | PreToolUse (Write/Edit) | 分支保护 + 步骤状态机 |
| credential-guard.sh | PreToolUse (Write/Edit) | 凭据保护 |
| stop.sh | Stop | 循环控制（15 次重试上限） |

### Hook 与 CI 职责划分

```
┌─────────────────────────────────────────────────────────────┐
│  本地 Hook（branch-protect.sh）                             │
│  → 确保在 cp-* 或 feature/* 分支开发                        │
│  → 确保有 PRD/DoD 文件                                      │
│  → 引导作用，可被绕过                                       │
├─────────────────────────────────────────────────────────────┤
│  CI（GitHub Actions）                                       │
│  → 质量检查的唯一门槛                                       │
│  → PR 到 develop：L1 测试 + L2A 检查                        │
│  → PR 到 main：L1 + L2A + L2B/L3 证据链裁决                 │
│  → 独立环境，无法伪造，真正的强制防线                       │
└─────────────────────────────────────────────────────────────┘
```

**核心原则**：Hook 是引导，CI 是裁决。质量检查完全交给 CI（v12.4.5+）。

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

GitHub 层面的保护：
- main 禁止直接 push
- PR 必须过 CI
- CI 通过后自动合并

## License

ISC
