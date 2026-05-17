---
id: feature-classification-guide
version: 1.0.0
created: 2026-01-26
updated: 2026-01-26
changelog:
  - 1.0.0: 初始版本 - Feature 归类完整指南
---

# Feature 归类指南

> **FEATURES.md 的作用 + H/W/C/B 分类系统**

---

## 🎯 核心认知

### FEATURES.md 的定位

```
FEATURES.md ≠ 测试细节
FEATURES.md = 能力地图（What，人读）
```

**作用**：
- ✅ 对外展示：这个系统有什么能力
- ✅ 内部归类：新功能属于哪个分类
- ✅ 版本管理：能力从 Experiment → Committed 的演进
- ❌ 不是：测试用例、RCI 定义、技术细节

**类比**：
- FEATURES.md = 产品说明书（"我们有什么功能"）
- regression-contract.yaml = 质量合同（"这些功能必须不能坏"）

---

## 📊 H/W/C/B 分类体系

### 四大分类

| 分类 | 全称 | 说明 | ID 前缀 | 示例 |
|------|------|------|---------|------|
| **H** | Hooks | 钩子系统 | H1-xxx, H2-xxx | H1: branch-protect, H2: pr-gate |
| **W** | Workflow | 开发工作流 | W1-xxx, W2-xxx | W1: /dev Skill, W2: /qa Skill |
| **C** | Core | 核心功能 | C1-xxx, C2-xxx | C1: DevGate 框架, C2: RADNA 体系 |
| **B** | Business | 业务逻辑 | B1-xxx, B2-xxx | B1: 内容生成, B2: 自动发布 |

### 分类决策树

```
                    ┌─────────────┐
                    │  新功能     │
                    └──────┬──────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
      是钩子系统？      是工作流？       是业务逻辑？
           │               │               │
           ▼               ▼               ▼
    ┌──────────┐    ┌──────────┐    ┌──────────┐
    │  Hooks   │    │ Workflow │    │ Business │
    │  (H)     │    │  (W)     │    │  (B)     │
    └──────────┘    └──────────┘    └──────────┘
           │
           └──────────────┐
                          │
                  都不是，是系统能力？
                          │
                          ▼
                   ┌──────────┐
                   │  Core    │
                   │  (C)     │
                   └──────────┘
```

---

## 🔵 Hooks (H)

### 定义

**钩子系统** - 在特定时机自动触发的系统行为

### 判定标准

✅ 满足以下任一条件即为 Hooks：
- 在 `PreToolUse` / `SessionStart` / `SessionEnd` 触发
- 通过 `.claude/settings.json` 配置
- 位于 `hooks/` 目录
- 拦截用户操作（Write/Edit/Bash）

### 子分类

| ID 前缀 | 子分类 | 说明 | 示例 |
|---------|--------|------|------|
| **H1** | Core Hooks | 核心钩子 | H1-001: branch-protect |
| **H2** | Gate Hooks | 门禁钩子 | H2-001: pr-gate-v2 |
| **H3** | Session Hooks | 会话钩子 | H3-001: session-start |

### FEATURES.md 示例

```markdown
## Hooks (H)

### H1 - Core Hooks

- **H1-001**: 分支保护
  - Status: Committed
  - Description: 阻止在 main/develop 分支直接修改代码
  - Since: v1.0.0

- **H1-002**: PRD/DoD 检查
  - Status: Committed
  - Description: 确保功能分支有完整的 PRD 和 DoD
  - Since: v1.0.0

### H2 - Gate Hooks

- **H2-001**: PR 质检（双模式）
  - Status: Committed
  - Description: PR/Release 模式质检门禁
  - Since: v1.2.0
```

### RCI 对应

```yaml
# regression-contract.yaml
contracts:
  - id: H1-001
    name: "分支保护 Hook 触发"
    priority: P0
    trigger: [PR, Release]
    test: tests/hooks/test-branch-protect.sh
```

---

## 🟢 Workflow (W)

### 定义

**开发工作流** - 完整的开发流程编排

### 判定标准

✅ 满足以下任一条件即为 Workflow：
- 是 Claude Code Skill（/dev, /qa, /audit）
- 包含多步骤流程编排
- 位于 `skills/` 目录
- 编排多个工具/脚本完成任务

### 子分类

| ID 前缀 | 子分类 | 说明 | 示例 |
|---------|--------|------|------|
| **W1** | Dev Workflow | 开发流程 | W1-001: /dev Skill |
| **W2** | QA Workflow | 质检流程 | W2-001: /qa Skill |
| **W3** | Ops Workflow | 运维流程 | W3-001: 自动部署 |

### FEATURES.md 示例

```markdown
## Workflow (W)

### W1 - Dev Workflow

- **W1-001**: /dev Skill（10步开发流程）
  - Status: Committed
  - Description: PRD → Branch → DoD → Code → PR → CI → Merge
  - Since: v1.0.0

- **W1-002**: Ralph Loop（自动重试）
  - Status: Experiment
  - Description: CI 失败自动重试修复
  - Since: v2.0.0

### W2 - QA Workflow

- **W2-001**: /qa Skill（5种模式）
  - Status: Committed
  - Description: 测试决策、RCI 判定、Golden Path、Feature 归类、QA 审计
  - Since: v1.2.0
```

### RCI 对应

```yaml
# regression-contract.yaml
contracts:
  - id: W1-001
    name: "/dev Skill 完整流程"
    priority: P0
    trigger: [Release]
    test: tests/e2e/test-dev-skill-full-flow.sh
```

---

## 🔴 Core (C)

### 定义

**核心功能** - 系统级基础能力（不属于 Hooks/Workflow）

### 判定标准

✅ 满足以下任一条件即为 Core：
- 提供系统级能力（DevGate 框架、RADNA 体系）
- 位于 `scripts/` 目录
- 被多个 Workflow 复用
- 不是 Hook，不是 Workflow，但很重要

### 子分类

| ID 前缀 | 子分类 | 说明 | 示例 |
|---------|--------|------|------|
| **C1** | DevGate | 门禁检查器 | C1-001: check-dod-mapping |
| **C2** | RADNA | 质量体系 | C2-001: 四层架构 |
| **C3** | Utils | 工具函数 | C3-001: detect-priority |

### FEATURES.md 示例

```markdown
## Core (C)

### C1 - DevGate

- **C1-001**: DoD 映射检查
  - Status: Committed
  - Description: 检查 DoD 与测试的映射关系
  - Since: v1.0.0

- **C1-002**: P0/P1 强制 RCI 更新
  - Status: Committed
  - Description: P0/P1 修改必须更新回归契约
  - Since: v1.1.0

### C2 - RADNA

- **C2-001**: 四层架构（L0-L3）
  - Status: Committed
  - Description: Rules → Contracts → Executors → Evidence
  - Since: v1.0.0
```

### RCI 对应

```yaml
# regression-contract.yaml
contracts:
  - id: C1-001
    name: "DoD 映射检查功能"
    priority: P1
    trigger: [PR]
    test: tests/devgate/test-dod-mapping.sh
```

---

## 🟣 Business (B)

### 定义

**业务逻辑** - 特定业务场景的功能（仅用于 Business RepoType）

### 判定标准

✅ 满足以下任一条件即为 Business：
- 内容生成逻辑
- 业务流程编排（非系统级）
- 用户界面逻辑
- 特定业务场景

### 子分类（以 Autopilot 为例）

| ID 前缀 | 子分类 | 说明 | 示例 |
|---------|--------|------|------|
| **B1** | Content | 内容生成 | B1-001: ContentSeed |
| **B2** | Publish | 发布链路 | B2-001: Notion Sync |
| **B3** | Analytics | 数据分析 | B3-001: 受众分析 |

### FEATURES.md 示例（Autopilot）

```markdown
## Business (B)

### B1 - Content

- **B1-001**: ContentSeed（内容种子生成）
  - Status: Committed
  - Description: 从用户输入生成内容种子
  - Since: v1.0.0

- **B1-002**: DeepPost（深度文章生成）
  - Status: Committed
  - Description: 基于内容种子生成深度文章
  - Since: v1.0.0

### B2 - Publish

- **B2-001**: Notion 同步
  - Status: Committed
  - Description: 将内容同步到 Notion 数据库
  - Since: v1.0.0
```

### RCI 对应（业务能力级）

```yaml
# autopilot-regression-contract.yaml
contracts:
  - id: B1-001
    name: "ContentSeed 输入输出契约"
    priority: P1
    trigger: [PR]
    test: tests/flows/test-content-seed.sh
```

---

## 🎯 Feature 归类决策流程

### /qa Skill 模式 4（Feature 归类模式）

```
用户："这个算新 Feature 吗？"

/qa → 模式 4 → 流程：

1. 读取 FEATURES.md 的更新规则
2. 判断是新 Feature 还是现有 Feature 的扩展
3. 判断属于哪个分类（H/W/C/B）
4. 建议 ID 和状态

输出：
  Decision: NEW_FEATURE | EXTEND_FEATURE | NOT_FEATURE
  Category: H | W | C | B
  Suggested ID: H1-003 | W1-002 | C1-005 | B1-003
  Status: Experiment → Committed

  Next Actions:
    - 更新 FEATURES.md
    - 添加到对应分类
    - 如果是 Committed，考虑添加 RCI
```

### Decision 值说明

| Decision | 说明 | 操作 |
|----------|------|------|
| **NEW_FEATURE** | 全新能力 | 在 FEATURES.md 添加新条目 |
| **EXTEND_FEATURE** | 现有功能扩展 | 更新现有条目，版本号升级 |
| **NOT_FEATURE** | 不是 Feature | 不更新 FEATURES.md（如 bug fix） |

---

## 📝 FEATURES.md 模板

### Engine RepoType

```markdown
# Features

> 本文档记录系统提供的能力，不包含测试细节。

## 版本

- Current: v1.2.0
- Last Updated: 2026-01-26

---

## Hooks (H)

### H1 - Core Hooks

- **H1-001**: 分支保护
  - Status: Committed
  - Description: 阻止在 main/develop 分支直接修改代码
  - Since: v1.0.0
  - RCI: H1-001

---

## Workflow (W)

### W1 - Dev Workflow

- **W1-001**: /dev Skill（10步开发流程）
  - Status: Committed
  - Description: PRD → Branch → DoD → Code → PR → CI → Merge
  - Since: v1.0.0
  - RCI: W1-001

---

## Core (C)

### C1 - DevGate

- **C1-001**: DoD 映射检查
  - Status: Committed
  - Description: 检查 DoD 与测试的映射关系
  - Since: v1.0.0
  - RCI: C1-001

---

## Status 说明

- **Experiment**: 实验性功能，可能变更
- **Committed**: 稳定功能，有 RCI 保证
- **Deprecated**: 已废弃，将在未来版本移除
```

### Business RepoType（Autopilot）

```markdown
# Features

> 本文档记录 Autopilot 提供的业务能力。

## 版本

- Current: v1.0.0
- Last Updated: 2026-01-26

---

## Business (B)

### B1 - Content

- **B1-001**: ContentSeed（内容种子生成）
  - Status: Committed
  - Description: 从用户输入生成内容种子
  - Since: v1.0.0
  - RCI: B1-001

- **B1-002**: DeepPost（深度文章生成）
  - Status: Committed
  - Description: 基于内容种子生成深度文章
  - Since: v1.0.0
  - RCI: B1-002

### B2 - Publish

- **B2-001**: Notion 同步
  - Status: Committed
  - Description: 将内容同步到 Notion 数据库
  - Since: v1.0.0
  - RCI: B2-001
```

---

## 🔄 Feature 生命周期

```
1. 新功能开发
   └─→ Status: Experiment
       └─→ 添加到 FEATURES.md
           └─→ 可选：添加 Unit Test

2. 功能稳定
   └─→ Status: Committed
       └─→ 必须：添加 RCI
           └─→ 必须：添加 Regression Test

3. 功能废弃
   └─→ Status: Deprecated
       └─→ 标记废弃版本
           └─→ 计划移除时间

4. 功能移除
   └─→ 从 FEATURES.md 移除
       └─→ 从 RCI 移除
           └─→ 更新 CHANGELOG
```

---

## 🧩 实际使用示例

### 示例 1：新增 Hook

```
场景：添加了一个新的 Hook "auto-commit.sh"

/qa → 模式 4：

Decision: NEW_FEATURE
Category: H (Hooks)
Suggested ID: H1-003
Status: Experiment

Next Actions:
  1. 在 FEATURES.md 添加：
     - **H1-003**: 自动提交
       - Status: Experiment
       - Description: 代码审计通过后自动提交
       - Since: v1.3.0

  2. 稳定后添加 RCI：
     contracts:
       - id: H1-003
         name: "auto-commit Hook 触发"
         priority: P1
         trigger: [PR]
         test: tests/hooks/test-auto-commit.sh
```

### 示例 2：扩展现有 Workflow

```
场景：/dev Skill 新增了第 11 步 "Ralph Loop"

/qa → 模式 4：

Decision: EXTEND_FEATURE
Category: W (Workflow)
Existing ID: W1-001
Status: Committed → Committed (升级版本)

Next Actions:
  1. 更新 FEATURES.md：
     - **W1-001**: /dev Skill（11步开发流程）
       - Status: Committed
       - Description: PRD → ... → CI → Ralph Loop → Merge
       - Since: v1.0.0
       - Updated: v2.0.0（新增 Ralph Loop）

  2. 更新 RCI 测试：
     - 确保 W1-001 的测试覆盖新增步骤
```

### 示例 3：Bug 修复

```
场景：修复了 pr-gate-v2.sh 的一个 bug

/qa → 模式 4：

Decision: NOT_FEATURE
Reason: Bug 修复不是新能力

Next Actions:
  - 不更新 FEATURES.md
  - 更新 CHANGELOG.md
  - 确保 RCI H2-001 测试通过
```

---

## 📚 相关文档

**核心文档**：
- [质量体系白皮书](./QUALITY-SYSTEM-WHITEPAPER.md) - 一次讲透版
- [三组分层系统对照表](./THREE-LAYER-SYSTEMS.md) - 最容易混淆的点
- [QA 稳定契约矩阵](./QA-STABILITY-MATRIX.md) - Engine vs Autopilot vs App 完整对比
- [可视化架构图](./QUALITY-LAYERS-VISUAL.md) - 一图胜千言

**Skills 文档**：
- [QA Skill](../skills/qa/SKILL.md) - 模式 4（Feature 归类模式）详细说明

**Contract 模板**：
- [regression-contract.template.yaml](../contracts/regression-contract.template.yaml) - RCI 定义模板

---

## 🎁 快速参考

### ID 命名规范

```
格式: <Category><SubCategory>-<序号>

示例:
  H1-001  (Hooks - Core Hooks - 001)
  W1-001  (Workflow - Dev Workflow - 001)
  C1-001  (Core - DevGate - 001)
  B1-001  (Business - Content - 001)
```

### Status 选择

```
Experiment  → 实验性功能，快速迭代
Committed   → 稳定功能，有 RCI 保证
Deprecated  → 已废弃，计划移除
```

### FEATURES.md vs RCI

```
FEATURES.md          regression-contract.yaml
────────────        ─────────────────────────
What（能力地图）      How（如何保证不坏）
人读                 机器读
能力列表             测试定义
```

---

**Version**: 1.0.0
**Last Updated**: 2026-01-26
