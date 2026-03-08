---
name: dev
version: 3.4.1
updated: 2026-03-08
description: |
  统一开发工作流入口。

  v3.2.0 变更（步骤重构）：
  - Step 4: DoD → 探索（先读代码理解架构）
  - Step 5: 写代码 → DoD（基于探索结果定义验收标准）
  - Step 6: 写测试 → 写代码（含测试，合并旧 05+06）
  - Step 7: 质检 → 本地验证（跑 npm test，不生成空 JSON）

  循环控制由 Stop Hook 实现：
  - 有头模式: Stop Hook 检测 .dev-mode 文件，exit 2 阻止会话结束
  - 无头模式: CECELIA_HEADLESS=true 时 Stop Hook 直接 exit 0，外部循环控制
---

> **CRITICAL LANGUAGE RULE（语言规则）: 所有输出必须使用简体中文。包括步骤说明、状态更新、日志信息、错误报告。严禁使用日语、韩语或任何其他语言，即使在无头（headless）子进程中也必须遵守。**

# /dev - 统一开发工作流（v3.2）

## 🎯 使用方式

### 基本用法

```bash
/dev                    # 手动提供 PRD，正常流程
/dev --task-id <id>     # 从 Brain 读取 Task PRD，自动流程
```

### --task-id 参数（v12.16.0+）

**功能**：自动从 Brain PostgreSQL 读取 Task PRD，启动开发流程

**流程**：
```
/dev --task-id abc-123
    ↓
解析参数 (parse-dev-args.sh)
    ↓
调用 Brain API 读取 Task (fetch-task-prd.sh)
    ↓
生成 .prd-task-abc-123.md + .dod-task-abc-123.md
    ↓
继续正常 /dev 流程 (Step 2-11)
```

**依赖**：
- Brain 服务运行（localhost:5221）
- PostgreSQL 中有对应 Task 数据
- Task 有 description 字段（作为 PRD 内容）

**向后兼容**：不带参数的 `/dev` 仍然正常工作

---

## ⚡ 核心目标（CRITICAL）

**从 /dev 启动的那一刻起，唯一的目标就是：成功合并 PR 到 develop。**

### 完成条件

```
开始 → ... → PR 创建 → CI 通过 → PR 合并 ✅ 完成
```

**只有一个完成标志**：PR 已合并到 develop

### 遇到任何问题 = 自动修复

| 问题 | 错误做法 | 正确做法 |
|------|----------|----------|
| CI 失败 | ❌ 停下来等用户 | ✅ 分析错误 → 自动修复 → 重新 push |
| 合并冲突 | ❌ 让用户手动解决 | ✅ 拉取最新代码 → 解决冲突 → 继续 |
| 测试失败 | ❌ 报告失败就停 | ✅ 修复代码 → 重新测试 → 继续 |
| Hook 阻止 | ❌ 建议禁用 Hook | ✅ 分析 Hook 需要什么 → 生成 → 继续 |

### Stop Hook 保证循环

**Stop Hook 会检查 PR 是否合并**：
- PR 未合并 → `exit 2` → Claude 继续执行
- PR 已合并 → `exit 0` → 完成

**所以你不需要担心"卡住"**：
- 遇到困难 → 自动修复
- Stop Hook 会确保你继续执行
- 直到 PR 合并为止

### 绝对禁止

❌ **永远不要说**：
- "遇到问题，建议手动..."
- "需要用户确认后继续"
- "暂时停止，等待..."
- "这个问题比较复杂，让用户处理"

✅ **永远要做**：
- 分析问题 → 自动修复 → 继续
- 相信 Stop Hook 会循环
- 直到 PR 合并才停止

---

## 循环控制机制

/dev 的循环控制由 **Stop Hook** 实现：

| 模式 | 循环实现 | 工作方式 |
|------|----------|----------|
| **有头模式** | Stop Hook | 检测 `.dev-mode` 文件，未完成时 exit 2 阻止会话结束 |
| **无头模式** | 外部 while 循环 | `CECELIA_HEADLESS=true` 时 Stop Hook exit 0，由 cecelia-run 控制 |

### 工作流程

```
/dev 启动 → Step 1 创建 .dev-mode
    ↓
执行 Step 1-11...
    ↓
会话尝试结束 → Stop Hook 触发
    ↓
检测 .dev-mode → 检查完成条件
    ↓
├─ PR 未合并 → exit 2 → Claude 继续执行
└─ PR 已合并 → 删除 .dev-mode → exit 0 → 会话结束
```

### .dev-mode 文件

**格式**：
```
dev
branch: cp-xxx
prd: .prd-cp-xxx.md
started: 2026-01-29T10:00:00+00:00
tasks_created: true
```

**生命周期**：
- Step 3 (Branch) 分支创建后创建（此时分支名正确）
- Step 11 (Cleanup) 删除
- 或 PR 合并后由 Stop Hook 自动删除

---

## ⛔ 绝对禁止行为（CRITICAL）

**遇到任何困难，禁止建议用户手动介入。必须自动解决，继续执行。**

### 禁止的话术

❌ **绝对不要说**：
- "建议手动创建 PR"
- "您可以手动运行..."
- "建议您手动..."
- "可以先手动..."
- "您也可以手动..."
- "暂时禁用 Hook"
- "需要用户确认"
- "让用户手动做 XXX"
- "可以绕过..."
- "暂时跳过 XXX"
- "先忽略 XXX"

### 正确的做法

✅ **遇到困难时**：
1. **分析原因**：Hook/CI 需要什么文件/格式？
2. **自动生成**：创建 gate 文件、evidence 文件、修复格式
3. **继续执行**：相信 Stop Hook 会循环，继续 push/等 CI/merge
4. **无限重试**：直到 PR 合并为止

### 为什么有这个规则

| AI 默认倾向 | 正确行为 |
|------------|---------|
| 困难 → 不确定 → 让用户决定 ❌ | 困难 → 分析 → 自动解决 → 继续 ✅ |
| "遇到问题，建议用户手动..." | "分析 Hook 需要什么，自动生成" |
| "暂时禁用 Hook 绕过检查" | "修复格式/文件，通过检查" |

**Stop Hook 会确保循环**：未完成 → exit 2 → Claude 继续执行

---

## 核心定位

**流程编排者**：
- 分支保护 → `hooks/branch-protect.sh` (PreToolUse:Write|Edit)
- 循环驱动 → Stop Hook (hooks/stop.sh)
- 进度追踪 → Task Checkpoint（TaskCreate/TaskUpdate）

检查由 CI DevGate 负责：
- DoD 映射检查 → `scripts/devgate/check-dod-mapping.cjs`
- RCI 覆盖率 → `scripts/devgate/scan-rci-coverage.cjs`
- P0/P1 RCI 更新 → `scripts/devgate/require-rci-update-if-p0p1.sh`

**职责分离**：
```
用户 → /dev（流程编排）
         ↓
       Step 1-11（具体步骤）
         ↓
       会话结束 → Stop Hook 检查完成条件
         ↓
       ├─ 未完成 → exit 2 → 继续执行
       └─ 已完成 → exit 0 → 会话结束
```

---

## 统一完成条件

**Stop Hook 检查以下条件**：

```
1. PR 已创建？
   ❌ → exit 2 → 继续执行到创建 PR

2. CI 状态？
   - PENDING/IN_PROGRESS → exit 2 → 等待 CI
   - FAILURE → exit 2 → 修复代码
   - SUCCESS → 继续下一步

3. PR 已合并？
   ❌ → exit 2 → 合并 PR
   ✅ → 删除 .dev-mode → exit 0 → 完成
```

**不再分阶段**：
- ❌ 不再有 p0/p1/p2 阶段
- ❌ 不再运行 detect-phase.sh
- ✅ 从头到尾一直执行，直到 PR 合并

---

## ⚡ 自动执行规则（CRITICAL）

**每个步骤完成后，必须立即执行下一步，不要停顿、不要等待用户确认、不要输出总结。**

### 执行流程

```
Step N 完成 → 立即读取 skills/dev/steps/{N+1}-xxx.md → 立即执行下一步
```

### 禁止行为

- ❌ 完成一步后输出"已完成，等待用户确认"
- ❌ 完成一步后停下来总结
- ❌ 询问用户"是否继续下一步"

### 正确行为

- ✅ 完成 Step 4 (Explore) → **立即**执行 Step 5 (DoD)
- ✅ 完成 Step 5 (DoD) → **立即**执行 Step 6 (Code)
- ✅ 完成 Step 6 (Code) → **立即**执行 Step 7 (Verify)
- ✅ 完成 Step 7 (Verify) → **立即**执行 Step 8 (PR)
- ✅ 一直执行到 Step 8 创建 PR 为止

---

## Task Checkpoint 追踪（CRITICAL）

**必须使用官方 Task 工具追踪进度**，让用户实时看到执行状态。

### 任务创建（开始时）

在 /dev 开始时，创建所有步骤的 Task：

```javascript
TaskCreate({ subject: "PRD 确认", description: "确认 PRD 文件存在且有效", activeForm: "确认 PRD" })
TaskCreate({ subject: "环境检测", description: "检测项目环境和配置", activeForm: "检测环境" })
TaskCreate({ subject: "分支创建", description: "创建或切换到功能分支", activeForm: "创建分支" })
TaskCreate({ subject: "探索代码", description: "读代码理解架构，输出实现方案", activeForm: "探索代码" })
TaskCreate({ subject: "DoD 定稿", description: "基于探索结果生成 DoD", activeForm: "定稿 DoD" })
TaskCreate({ subject: "写代码", description: "根据 PRD 实现功能 + 测试", activeForm: "写代码" })
TaskCreate({ subject: "本地验证", description: "跑 npm test 验证", activeForm: "本地验证" })
TaskCreate({ subject: "提交 PR", description: "版本号更新 + 创建 PR", activeForm: "提交 PR" })
TaskCreate({ subject: "CI 监控", description: "等待 CI 通过并修复失败", activeForm: "监控 CI" })
TaskCreate({ subject: "Learning 记录", description: "记录开发经验", activeForm: "记录经验" })
TaskCreate({ subject: "清理", description: "清理临时文件", activeForm: "清理中" })
```

### 任务更新（执行中）

```javascript
// 开始某个步骤时
TaskUpdate({ taskId: "1", status: "in_progress" })

// 完成某个步骤时
TaskUpdate({ taskId: "1", status: "completed" })

// 如果失败需要重试
// 不要 delete，保留状态为 in_progress，继续重试
```

### 查看进度

```javascript
// AI 可以随时查看当前进度
TaskList()

// 输出示例：
// ✅ 1. PRD 确认 (completed)
// ✅ 2. 环境检测 (completed)
// ✅ 3. 分支创建 (completed)
// 🚧 4. 探索代码 (in_progress)
// ⏸️  5. DoD 定稿 (pending)
// ...
```

---

## 核心规则

### 1. 统一流程（不分阶段）✅

```
开始 → Step 1-11 → PR 创建 → CI 监控 → PR 合并 → 完成
```

**不再有**：
- ❌ p0/p1/p2 阶段
- ❌ detect-phase.sh 阶段检测
- ❌ "发 PR 后就结束" 的错误逻辑

### 2. Task Checkpoint 追踪 ✅

```
每个步骤：
  开始 → TaskUpdate(N, in_progress)
  完成 → TaskUpdate(N, completed)
  失败重试 → 保持 in_progress，继续执行
```

### 3. 分支策略

1. **只在 cp-* 或 feature/* 分支写代码** - Hook 强制
2. **develop 是主开发线** - PR 合并回 develop
3. **main 始终稳定** - 只在里程碑时从 develop 合并

### 4. 质量保证

- 本地：branch-protect.sh（PRD/DoD 文件存在检查）
- CI DevGate：DoD 映射、RCI 覆盖率、P0/P1 RCI 更新

---

## 版本号规则 (semver) — 自动化

**PR 里不要手动 bump 版本号。** 合并到 main 后由 `auto-version.yml` 自动处理。

commit 消息前缀决定 bump 类型：

| commit 前缀 | 版本变化 |
|-------------|----------|
| fix: | patch (+0.0.1) |
| feat: | minor (+0.1.0) |
| feat!: / BREAKING: | major (+1.0.0) |
| 其他（docs:、test:、chore:） | 不 bump |

auto-version 自动更新 5 个文件：package.json、package-lock.json、.brain-versions、DEFINITION.md、VERSION。

**禁止在 PR 中**：`npm version`、手动改版本号、运行 `check-version-sync.sh`。

---

## 加载策略

```
skills/dev/
├── SKILL.md        ← 你在这里（入口 + 流程总览）
├── steps/          ← 每步详情（按需加载）
│   ├── 00-worktree-auto.md ← Worktree 自动检测（前置，Step 1 之前）
│   ├── 01-prd.md       ← PRD 确认
│   ├── 02-detect.md    ← 环境检测
│   ├── 03-branch.md    ← 创建 .dev-mode
│   ├── 04-explore.md   ← 探索（读代码理解架构）
│   ├── 05-dod.md       ← DoD 定稿（基于探索结果）
│   ├── 06-code.md      ← 写代码 + 测试
│   ├── 07-verify.md    ← 本地验证（跑 npm test）
│   ├── 08-pr.md
│   ├── 09-ci.md
│   ├── 10-learning.md  ← 记录经验
│   └── 11-cleanup.md   ← 删除 .dev-mode
└── scripts/        ← 辅助脚本
    ├── cleanup.sh
    ├── check.sh
    └── ...
```

### 流程图 (v3.3 - 步骤重构)

```
0-Worktree → 检测 .dev-mode 冲突 → 自动 worktree + cd（如需要）
    ↓
1-PRD ────→ 生成 PRD（branch-protect 检查文件存在）
    ↓
2-Detect → 3-Branch
    ↓
4-Explore → 读代码理解架构，输出实现方案
    ↓
5-DoD ────→ DoD 定稿（基于探索结果，每条有 Test 字段）
    ↓
6-Code ───→ 写代码 + 测试
    ↓
7-Verify ─→ 本地跑 npm test（省一轮 CI）
    ↓
8-PR → 9-CI → 10-Learning → 11-Cleanup
```

### 两层职责分离

| 层 | 位置 | 类型 | 职责 |
|----|------|------|------|
| **branch-protect** | 本地 | 阻止型 | PRD/DoD 文件存在检查 |
| **Verify** | 本地 | 验证型 | 推送前跑 npm test |
| **CI** | 远端 | 复核型 | 最终裁判，硬门禁 |

---

## 产物检查清单

| 产物 | 位置 | 检查方式 | 检查时机 |
|------|------|----------|----------|
| PRD | .prd.md | Hook 检查存在 | 写代码前 |
| DoD | .dod.md | Hook 检查存在，CI 检查映射 | 写代码前 + PR 时 |
| QA 决策 | docs/QA-DECISION.md | skills/qa/SKILL.md | Step 5 |
| 审计报告 | docs/AUDIT-REPORT.md | skills/audit/SKILL.md | Step 6 后 |
| .dev-mode | .dev-mode | Stop Hook 检查完成条件 | 会话结束时 |

---

## 状态追踪（Core/Notion 同步）

有头和无头模式共用同一套追踪机制，在关键点调用 `track.sh`：

```bash
# 新任务开始时
bash skills/dev/scripts/track.sh start "$(basename "$(pwd)")" "$(git rev-parse --abbrev-ref HEAD)" ".prd.md"

# 每个步骤
bash skills/dev/scripts/track.sh step 1 "PRD"
bash skills/dev/scripts/track.sh step 2 "Detect"
bash skills/dev/scripts/track.sh step 3 "Branch"
bash skills/dev/scripts/track.sh step 4 "Explore"
bash skills/dev/scripts/track.sh step 5 "DoD"
bash skills/dev/scripts/track.sh step 6 "Code"
bash skills/dev/scripts/track.sh step 7 "Verify"
bash skills/dev/scripts/track.sh step 8 "PR"
bash skills/dev/scripts/track.sh step 9 "CI"
bash skills/dev/scripts/track.sh step 10 "Learning"
bash skills/dev/scripts/track.sh step 11 "Cleanup"

# 完成时
bash skills/dev/scripts/track.sh done "$PR_URL"

# 失败时
bash skills/dev/scripts/track.sh fail "Error message"
```

追踪文件 `.cecelia-run-id` 自动管理，Core 是主数据源，Notion 是镜像。

---

## 多 Feature 支持（可选）

### 使用场景

- **简单任务**：当前单 PR 流程（自动判断）
- **复杂任务**：大 PRD → 拆分 N 个 Features → N 个 PR

### 状态文件

`.claude/multi-feature-state.local.md` 记录进度：

```yaml
---
features:
  - id: 1
    title: "用户登录基础功能"
    status: completed
    pr: "#123"
    branch: "cp-01240101-login-basic"
    feedback: "登录成功，但错误提示不够友好"

  - id: 2
    title: "优化登录错误提示"
    status: in_progress
    branch: "cp-01240102-login-errors"

  - id: 3
    title: "添加记住我功能"
    status: pending
---

## Feature 1: 用户登录基础功能 ✅

**Branch**: cp-01240101-login-basic
**PR**: #123
**Status**: Merged to develop

**反馈**：
- 登录成功
- 错误提示不够友好 → Feature 2 处理

## Feature 2: 优化登录错误提示 🚧

**Branch**: cp-01240102-login-errors
**Status**: In Progress

**基于 Feature 1 反馈**：
- 改进错误消息文案
- 添加错误类型区分

## Feature 3: 添加记住我功能 ⏳

**Status**: Pending
**依赖**: Feature 2 完成
```

### 继续命令

Feature N 完成后，运行：

```bash
/dev continue
```

/dev 自动：
1. 读取状态文件找到下一个 pending feature
2. 拉取最新 develop（包含前面 features 的代码）
3. 创建新分支开始下一个 feature
4. 引用上一个 feature 的反馈

### 向后兼容

简单任务仍走单 PR 流程，/dev 自动判断是否需要拆分。

---

## 完成度检查

**Cleanup 后运行**：

```bash
bash skills/dev/scripts/check.sh "$BRANCH_NAME" "$BASE_BRANCH"
```
