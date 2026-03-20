---
name: dev
version: 4.0.0
updated: 2026-03-20
description: |
  统一开发工作流入口（4-Stage Pipeline）。任何会进 git 的代码变更都必须走 /dev，没有例外。
  不走 /dev 不允许改代码——branch-protect Hook 会强制阻止。

  4-Stage Pipeline：
  Stage 1: Spec（读 PRD + 写 DoD）→ 派发 spec_review → 等 stop hook 放行
  Stage 2: Code（写代码 + 本地验证）
  Stage 3: Integrate（push + CI）→ 派发 code_review → 等 stop hook 放行
  Stage 4: Ship（Learning + 合并 + Clean）

  ⚠️ 顺序铁律：Learning 必须在合并 PR 之前完成。
  CI 通过后禁止立即合并——必须先执行 Stage 4 写 Learning。

  触发词（凡用户意图涉及代码改动，必须触发）：
  开始开发、加功能、修 bug、修复 bug、实现 XXX、改代码、改配置、
  调整代码、优化代码、重构、补测试、做这个功能、/dev、
  这里有问题、这段有 bug、帮我改一下、帮我调整、
  补充一下、完成这个任务、写代码、改一下 XXX、
  看看为什么不过（需要改代码时）、优化一下。

  有 --task-id 参数时从 Brain PostgreSQL 自动读取 Task PRD。
---

> **CRITICAL LANGUAGE RULE（语言规则）: 所有输出必须使用简体中文。包括步骤说明、状态更新、日志信息、错误报告。严禁使用日语、韩语或任何其他语言，即使在无头（headless）子进程中也必须遵守。**

## 🚨 启动第一步（CRITICAL — 不可跳过）

**触发 /dev 后，第一件事是读取并执行 Step 00（Worktree 检测）：**

```bash
cat ~/.claude/skills/dev/steps/00-worktree-auto.md
```

**在 Step 00 完成、确认已在独立 worktree 中之前，禁止进行任何其他操作。**
原因：worktree 隔离是整个流程的基础——没有 worktree，代码改动会污染主仓库 main 分支。

---

# /dev - 统一开发工作流（v4.0 — 4-Stage Pipeline）

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
继续正常 /dev 流程 (Stage 1-4)
```

**依赖**：
- Brain 服务运行（localhost:5221）
- PostgreSQL 中有对应 Task 数据
- Task 有 description 字段（作为 PRD 内容）

**向后兼容**：不带参数的 `/dev` 仍然正常工作

---

## ⚡ 核心目标（CRITICAL）

**从 /dev 启动的那一刻起，唯一的目标就是：成功合并 PR 到目标分支（动态检测：有 develop 用 develop，否则 main）。**

### 完成条件

```
开始 → Spec → [spec_review Gate] → Code → Push → PR → CI → [code_review Gate] → Ship(Learning+合并+Clean) ✅
```

**只有一个完成标志**：PR 已合并到目标分支（动态检测：`git rev-parse --verify develop` 成功则用 develop，否则 main）

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
| **无头模式** | Stop Hook（同有头） | v13.1.0 起与有头模式完全一致，`CECELIA_HEADLESS` 不再绕过 |

### 工作流程

```
/dev 启动 → Stage 1 创建 .dev-mode
    ↓
执行 Stage 1-4...
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
task_card: .task-cp-xxx.md
started: 2026-01-29T10:00:00+00:00
step_0_worktree: done
step_1_spec: done
step_2_code: pending
step_3_integrate: pending
step_4_ship: pending
```

**生命周期**：
- Stage 1 (Spec) 创建后写入
- Stage 4 (Ship) 删除
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
       Stage 1-4（具体阶段）
         ↓
       会话结束 → Stop Hook 检查完成条件
         ↓
       ├─ 未完成 → exit 2 → 继续执行
       └─ 已完成 → exit 0 → 会话结束
```

---

## 统一完成条件（devloop-check.sh SSOT）

**Stop Hook 通过 devloop-check.sh 检查以下条件，必须全部通过才能结束**：

```
0. cleanup_done: true？（最高优先级终止条件）
   ✅ → exit 0 → 工作流结束

1. step_1_spec done？
   ❌ → exit 2 → 执行 Stage 1
   ✅ → spec_review PASS？（查 Brain API）
     ❌ PENDING → exit 2 → 等 Codex
     ❌ FAIL → exit 2 → 修 Task Card
     ✅ PASS → 继续

2. step_2_code done？
   ❌ → exit 2 → 执行 Stage 2

3. PR 已创建？
   ❌ → exit 2 → 创建 PR

4. CI 状态？
   - PENDING/IN_PROGRESS → exit 2 → 等待
   - FAILURE → exit 2 → 本地复现 + 修复代码
   - SUCCESS → code_review PASS？（查 Brain API）
     ❌ PENDING → exit 2 → 等 Codex
     ❌ FAIL → exit 2 → 修代码
     ✅ PASS → 继续

5. Stage 4 Ship（Learning）完成？
   ❌ → exit 2 → 写 Learning + push 到功能分支

→ 合并 PR（gh pr merge --squash --delete-branch）

6. PR 已合并？
   ❌ → exit 2 → 执行合并
   ✅ → Stage 4 Ship → cleanup_done: true → 完成
```

**Codex 协作流程图（4-Stage Pipeline）**：

```
Stage 1 Spec → 派发 spec_review → 等 PASS
                                      ↓
                              Stage 2 Code（自验证）
                                      ↓
                              Stage 3 Integrate
                              ├─ Push + 创建 PR
                              ├─ CI L1-L4
                              └─ 派发 code_review → 等 PASS
                                      ↓
                              Stage 4 Ship
                              ├─ Learning
                              ├─ 合并 PR
                              └─ Clean → done
```

---

## ⚡ 自动执行规则（CRITICAL）

**每个步骤完成后，必须立即执行下一步，不要停顿、不要等待用户确认、不要输出总结。**

### 执行流程

```
Stage N 完成 → 立即读取 skills/dev/steps/{N+1}-xxx.md → 立即执行下一步
（例外：Stage 1 和 Stage 3 完成后需等 Codex Gate 放行）
```

### 禁止行为

- ❌ 完成一步后输出"已完成，等待用户确认"
- ❌ 完成一步后停下来总结
- ❌ 询问用户"是否继续下一步"

### 正确行为

- ✅ 完成 Stage 1 (Spec) → 派发 spec_review → **等 stop hook 放行** → 执行 Stage 2
- ✅ 完成 Stage 2 (Code) → **立即**执行 Stage 3 (Integrate)
- ✅ 完成 Stage 3 (Integrate) → CI 通过后派发 code_review → **等 stop hook 放行** → 执行 Stage 4
- ✅ 完成 Stage 4 (Ship) → PR 合并 → 完成
- ✅ 一直执行到 PR 合并为止

---

## Task Checkpoint 追踪（CRITICAL）

**必须使用官方 Task 工具追踪进度**，让用户实时看到执行状态。

### 任务创建（开始时）

在 /dev 开始时，创建所有步骤的 Task：

```javascript
TaskCreate({ subject: "Step 0: Worktree", description: "检测/创建独立 worktree", activeForm: "创建 Worktree" })
TaskCreate({ subject: "Stage 1: Spec", description: "读 PRD + 写 DoD + spec_review Gate", activeForm: "生成 Spec" })
TaskCreate({ subject: "Stage 2: Code", description: "探索+DoD定稿+写代码+本地验证", activeForm: "写代码" })
TaskCreate({ subject: "Stage 3: Integrate", description: "push+创建PR+等CI+code_review Gate", activeForm: "集成" })
TaskCreate({ subject: "Stage 4: Ship", description: "写Learning+合并PR+归档清理", activeForm: "交付" })
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
// ✅ 1. Step 0: Worktree (completed)
// ✅ 2. Stage 1: Spec (completed)
// 🚧 3. Stage 2: Code (in_progress)
// ⏸️  4. Stage 3: Integrate (pending)
// ⏸️  5. Stage 4: Ship (pending)
```

---

## 核心规则

### 1. 统一流程

```
开始 → Worktree → Stage 1 Spec → [spec_review] → Stage 2 Code → Stage 3 Integrate → [code_review] → Stage 4 Ship → 完成
```

### 2. Task Checkpoint 追踪

```
每个步骤：
  开始 → TaskUpdate(N, in_progress)
  完成 → TaskUpdate(N, completed)
  失败重试 → 保持 in_progress，继续执行
```

### 3. 分支策略

1. **只在 cp-* 或 feature/* 分支写代码** — Hook 强制
2. **分支命名**：`cp-MMDDHHNN-task-name`（例：`cp-02270800-fix-login`）
3. **目标分支**：动态检测——`git rev-parse --verify develop` 成功则 PR 合并到 develop，否则合并到 main

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
├── steps/          ← 每个 Stage 详情（按需加载）
│   ├── 00-worktree-auto.md
│   ├── 01-spec.md          ← Stage 1: Spec + spec_review Gate
│   ├── 02-code.md          ← Stage 2: Code + 自验证
│   ├── 03-integrate.md     ← Stage 3: Push + CI + code_review Gate
│   └── 04-ship.md          ← Stage 4: Learning + 合并 + Clean
└── scripts/        ← 辅助脚本
    ├── cleanup.sh
    ├── check.sh
    └── ...
```

### 流程图 (v4.0 - 4-Stage Pipeline)

```
Step 0: Worktree   → 创建独立 worktree
Stage 1: Spec      → 生成 Task Card → 派发 spec_review → 等 stop hook 放行
Stage 2: Code      → 写代码 + 自验证（逐条跑 DoD Test）
Stage 3: Integrate → push + 创建 PR + CI → 派发 code_review → 等 stop hook 放行
Stage 4: Ship      → 写 Learning + 合并 PR + 归档 + cleanup_done: true
```

### 步骤映射（新→旧）

| 新 Stage | 原步骤 | 核心变化 |
|----------|--------|----------|
| Step 0: Worktree | Step 00 | 完全不变 |
| Stage 1: Spec | Step 1 TaskCard | 加 spec_review Codex Gate |
| Stage 2: Code | Step 2 Code | 删除 /simplify 和 3 Codex 说明 |
| Stage 3: Integrate | Step 3 PR+CI | 删除 4 个 Codex 注册，改为 CI 后 1 个 code_review |
| Stage 4: Ship | Step 4 Learning + Step 5 Clean | 合并为一个 Stage |

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
| Task Card | .task-cp-xxx.md | branch-protect 检查 | 写代码前 |
| .dev-mode | .dev-mode | Stop Hook 检查完成条件 | 会话结束时 |
| Learning | docs/learnings/\<branch\>.md | CI 通过后 push 到功能分支，合并时一起入库 | Stage 4 完成时（合并前）|

---

## 状态追踪（Core/Notion 同步）

有头和无头模式共用同一套追踪机制，在关键点调用 `track.sh`：

```bash
# 新任务开始时
bash skills/dev/scripts/track.sh start "$(basename "$(pwd)")" "$(git rev-parse --abbrev-ref HEAD)" ".prd.md"

# 每个步骤
bash skills/dev/scripts/track.sh step 0 "Worktree"
bash skills/dev/scripts/track.sh step 1 "Spec"
bash skills/dev/scripts/track.sh step 2 "Code"
bash skills/dev/scripts/track.sh step 3 "Integrate"
bash skills/dev/scripts/track.sh step 4 "Ship"

# 完成时
bash skills/dev/scripts/track.sh done "$PR_URL"

# 失败时
bash skills/dev/scripts/track.sh fail "Error message"
```

追踪文件 `.cecelia-run-id` 自动管理，Core 是主数据源，Notion 是镜像。

---

> 多 PR 编排在 Initiative 层，参考 /architect skill。

---

## 完成度检查

**Cleanup 后运行**：

```bash
bash skills/dev/scripts/check.sh "$BRANCH_NAME" "$BASE_BRANCH"
```
