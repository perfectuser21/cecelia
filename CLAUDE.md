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
├── hooks/           # Claude Code Hooks (5 个)
│   ├── project-detect.sh  # 自动检测项目信息（→ .project-info.json）
│   ├── branch-protect.sh  # 分支保护（只允许 cp-*/feature/*）
│   ├── pr-gate.sh         # PR 前检查（流程+质检）
│   ├── session-init.sh    # 会话初始化，恢复上下文
│   └── stop-gate.sh       # 退出时检查任务完成度
├── skills/
│   ├── dev/         # /dev 开发工作流
│   └── audit/       # /audit 代码审计
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
