---
name: dev
description: |
  统一开发工作流入口。一个对话完成整个开发流程。

  触发条件：
  - 用户说任何开发相关的需求
  - 用户说 /dev
  - Hook 输出 [SKILL_REQUIRED: dev]
---

# /dev - 统一开发工作流

## 10 步流程

| Step | 内容 | 详情 |
|------|------|------|
| 1 | 准备（依赖+分支+上下文）| → [01-prepare.md](steps/01-prepare.md) |
| 2 | PRD | → [02-prd.md](steps/02-prd.md) |
| 3 | DoD | → [03-dod.md](steps/03-dod.md) |
| 4 | 写代码 | → [04-code.md](steps/04-code.md) |
| 5 | 写测试 | → [05-test.md](steps/05-test.md) |
| 6 | 本地测试 | → [06-local-test.md](steps/06-local-test.md) |
| 7 | 提交 PR | → [07-pr.md](steps/07-pr.md) |
| 8 | CI 通过 | → [08-ci-review.md](steps/08-ci-review.md) |
| 9 | 合并 | → [09-merge.md](steps/09-merge.md) |
| 10 | Cleanup | → [10-cleanup.md](steps/10-cleanup.md) |

---

## 流程图

```
进入项目目录
    │
    ▼
project-detect.sh (PostToolUse)  ← 自动检测
    → 项目类型、Monorepo、依赖图、测试能力
    → 缓存到 .project-info.json
    │
    ▼
/dev 开始
    │
    ▼
Step 1: 准备
    ├─ 依赖检查
    ├─ 分支检查/创建
    └─ 读取 .project-info.json（不重复扫描）
    │
    ▼
Step 2-3: PRD + DoD
    └─ scan-change-level.sh --desc  ← 自动推断层级
    │
    ▼
Step 4-6: 写代码 → 写测试 → 本地测试
    └─ scan-change-level.sh  ← 验证实际改动
    │
    ▼
Step 7: 提交 PR
    └─ pr-gate.sh  ← 流程+质检
    │
    ▼
Step 8-9: CI 通过 → 合并
    │
    ▼
Step 10: Cleanup
    │
    ▼
完成
```

---

## 核心规则

1. **只在 cp-* 或 feature/* 分支写代码** - Hook 强制
2. **步骤状态机** - Hook 检查 `git config branch.*.step`，step >= 3 才能写代码
3. **develop 是主开发线** - PR 合并回 develop
4. **main 始终稳定** - 只在里程碑时从 develop 合并
5. **不自动合并** - CI 通过后需要手动确认合并

---

## 步骤状态机

用 `git config branch.cp-xxx.step` 追踪当前步骤：

| step | 状态 | 说明 |
|------|------|------|
| 1 | 准备完成 | 分支已创建 |
| 2 | PRD 完成 | 用户确认 PRD |
| 3 | DoD 完成 | 用户确认 DoD，**可以写代码** |
| 4 | 代码完成 | 功能代码写完 |
| 5 | 测试完成 | 测试代码写完 |
| 6 | 本地测试通过 | npm test 绿，**可以提交** |
| 7 | PR 已创建 | 等待 CI |
| 8 | CI 通过 | 质检完成 |
| 9 | 已合并 | PR merged |
| 10 | 已清理 | 分支删除 |

### Hook 保护

**branch-protect.sh** (PreToolUse - Write/Edit):
- step >= 3 才能写代码
- 只允许 cp-* 或 feature/* 分支

**pr-gate.sh** (PreToolUse - Bash):
- 拦截 `gh pr create`
- 检查 .test-level.json 存在
- 检查 step >= 6
- 运行质检（typecheck, lint, test, build）

**stop-gate.sh** (Stop):
- 退出时检查任务完成度
- 显示进度建议（引导不强制）

**注意**：步骤状态是引导性的，CI 是唯一强制检查。

---

## 快速修复模式

**适用条件**（全部满足）：
- `fix:` 类型修复
- 单文件或少量改动
- 需求明确

**可跳过**：Step 1.4 上下文回顾

---

## 版本号规则 (semver)

| commit 类型 | 版本变化 |
|-------------|----------|
| fix: | patch (+0.0.1) |
| feat: | minor (+0.1.0) |
| feat!: / BREAKING: | major (+1.0.0) |

---

## 加载策略

```
skills/dev/
├── SKILL.md        ← 你在这里（入口）
├── steps/          ← 每步一个文件
│   ├── 01-prepare.md
│   ├── 02-prd.md
│   ├── ...
│   └── 10-cleanup.md
└── scripts/        ← 辅助脚本
    ├── cleanup.sh
    ├── check.sh
    └── wait-for-merge.sh
```

**执行时按需加载对应步骤文件，减少上下文开销。**

---

## 完成度检查

**Cleanup 后运行**：

```bash
bash skills/dev/scripts/check.sh "$BRANCH_NAME" "$BASE_BRANCH"
```
