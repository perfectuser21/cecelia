# ZenithJoy Engine

AI 开发工作流引擎。

---

## 唯一真实源

| 内容 | 位置 |
|------|------|
| 版本号 | `package.json` |
| 变更历史 | `CHANGELOG.md` |
| 工作流定义 | `skills/dev/SKILL.md` |
| 知识架构 | `docs/ARCHITECTURE.md` |
| 开发经验 | `docs/LEARNINGS.md` |

---

## 核心规则

1. **只在 cp-* 或 feature/* 分支写代码** - Hook 引导
2. **每个 PR 更新版本号** - semver
3. **完成度检查必须跑** - □ 必要项全部完成
4. **CI 绿是唯一完成标准**
5. **Subagents 禁止运行 /dev** - 见下方规则

---

## Subagent 使用规则

**核心原则**：Subagents 是"干活的手"，不是"独立的开发者"。

### ✅ 正确用法
```
主 agent 在 cp-fix-bugs 分支
    │
    ├─→ subagent A: "修改 file1.ts 第 50 行..."
    ├─→ subagent B: "修改 file2.ts 第 80 行..."
    └─→ subagent C: "修改 file3.ts 第 20 行..."

所有 subagent 在同一个分支内修改文件，主 agent 统一提交
```

### ❌ 错误用法
```
主 agent 调用 subagent 运行 /dev
    → subagent 创建新分支
    → 主 agent 又创建新分支
    → 混乱
```

### 规则
1. **Subagent 任务必须是具体的文件操作**，如"修改 X 文件的 Y 行"
2. **Subagent 禁止运行 /dev、创建分支、提交 PR**
3. **主 agent 负责**：创建分支、运行 /dev 流程、提交、PR
4. **Subagent 负责**：并行修改多个文件（在主 agent 的分支内）

---

## 入口

| 命令 | 说明 |
|------|------|
| `/dev` | 开始开发流程 |
| `/audit` | 代码审计与修复（有边界） |

---

## 目录结构

```
zenithjoy-engine/
├── hooks/           # Claude Code Hooks (2 个)
│   ├── branch-protect.sh  # 分支保护 + 步骤状态机
│   └── pr-gate-v2.sh      # PR 前质检（双模式：pr/release）
├── skills/
│   ├── dev/         # /dev 开发工作流
│   ├── audit/       # /audit 代码审计
│   └── qa/          # /qa QA 总控
├── docs/            # 详细文档
│   ├── ARCHITECTURE.md    # 知识分层架构
│   ├── LEARNINGS.md       # 开发经验
│   └── INTERFACE-SPEC.md  # 接口规范
├── templates/       # 文档模板
├── scripts/         # 部署脚本
│   └── deploy.sh    # 部署到 ~/.claude/
├── .github/         # CI 配置
├── n8n/             # n8n 工作流
└── src/             # 代码
```

---

## 项目级配置 (.claude/settings.json)

**skills 和 hooks 的配置格式不同**：

| 配置项 | 支持 `paths` 简写 | 项目级覆盖 |
|--------|------------------|-----------|
| skills | ✅ 支持 | ✅ |
| hooks  | ❌ 不支持 | ✅（需完整写） |

### skills 配置（简写）
```json
{
  "skills": {
    "paths": ["./skills"]
  }
}
```

### hooks 配置（必须完整写事件）
```json
{
  "hooks": {
    "PreToolUse": [
      {"matcher": "Write|Edit", "hooks": [{"type": "command", "command": "./hooks/branch-protect.sh"}]},
      {"matcher": "Bash", "hooks": [{"type": "command", "command": "./hooks/pr-gate-v2.sh"}]}
    ]
  }
}
```

**开发流程**：
- 项目内 `./hooks/` 和 `./skills/` → develop 分支开发版
- 全局 `~/.claude/hooks/` 和 `~/.claude/skills/` → main 分支稳定版（deploy.sh 部署）
- 在项目内测试新功能，稳定后 merge 到 main 并 deploy 到全局

---

## 分支策略（develop 缓冲）

```
main (稳定发布，里程碑时更新)
  └── develop (主开发线，日常开发)
        ├── cp-* (小任务，直接回 develop)
        └── feature/* (大功能，可选，最终也回 develop)
```

**核心原则**：
- main 始终稳定，只在里程碑时从 develop 合并
- develop 是主开发线，所有日常开发都在这里
- 只在 cp-* 或 feature/* 分支写代码（Hook 引导）
- cp-* 完成后回 develop，积累够了 develop 回 main

详细文档见 `docs/`。
