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

1. **只在 cp-* 或 feature/* 分支写代码** - Hook 强制
2. **每个 PR 更新版本号** - semver
3. **完成度检查必须跑** - □ 必要项全部完成
4. **CI 绿是唯一完成标准**

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
├── hooks/           # Claude Code Hooks (3 个)
│   ├── bash-guard.sh      # 步骤守卫 + PR 前检查
│   ├── branch-protect.sh  # 分支保护
│   └── project-detect.sh  # 项目检测
├── skills/
│   ├── dev/         # /dev 开发工作流
│   └── audit/       # /audit 代码审计
├── docs/            # 详细文档
│   ├── ARCHITECTURE.md    # 知识分层架构
│   ├── LEARNINGS.md       # 开发经验
│   └── INTERFACE-SPEC.md  # 接口规范
├── templates/       # 文档模板
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
- 只在 cp-* 或 feature/* 分支写代码（Hook 强制）
- cp-* 完成后回 develop，积累够了 develop 回 main

详细文档见 `docs/`。
