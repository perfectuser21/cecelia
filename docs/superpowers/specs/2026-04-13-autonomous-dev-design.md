# /dev autonomous_mode — Superpowers x Engine 融合设计

> PRD 进去，PR 出来，中间全自动。

## 概述

将 /dev 4-Stage Pipeline 的内核用 Superpowers 的 subagent 流程替代，外壳保留 Engine 的强制机制。

- **Engine 外壳**（代码强制）：Stop Hook、devloop-check、branch-protect、Brain 调度、CI 自动合并
- **Superpowers 内核**（行为纪律）：brainstorming、writing-plans、subagent-driven-development、systematic-debugging

主 agent 从"一个人干到尾"变成**协调者**，派 subagent 干活，自己负责审查和推进。

## 触发方式

```bash
/dev --autonomous          # 手动触发
/dev --task-id <id>        # Brain 派发（payload 含 autonomous_mode: true）
```

## Stage 1 改造：PRD → Plan（自主决策）

### 输入
- PRD 文件（`.prd-*.md` 或 Brain task description）

### 流程

```
1. 探索代码（现有逻辑不变）
   - 读 PRD，理解需求
   - 搜索 docs/learnings/ 历史经验
   - 分析影响范围：哪些文件要改、哪些模块受影响

2. 自主设计（来自 superpowers:brainstorming，跳过用户交互）
   - 评估 2-3 个技术方案
   - 自己选最直接的方案（不问用户）
   - 决策依据记录在 plan 文件中

3. 写 Implementation Plan（来自 superpowers:writing-plans）
   - 每个 task 精确到：文件路径、代码、测试命令、预期输出
   - 零占位符规则：禁止 TBD/TODO/稍后/适当/同上
   - 每步 2-5 分钟粒度
   - Self-Review 3 步自查：
     ① Spec 覆盖度 — PRD 每个要求都有对应 task
     ② 占位符扫描 — 搜索禁止关键词
     ③ 命令可执行性 — 每个 Test 命令能在终端跑

4. 产出 Task Card + Plan
   - .task-<branch>.md（DoD，至少 1 个 [BEHAVIOR]）
   - .plan-<branch>.md（Implementation Plan，bite-sized tasks）
```

### 输出
- `.task-<branch>.md` — Task Card（含 DoD）
- `.plan-<branch>.md` — Implementation Plan
- `.dev-mode` 标记 `step_1_spec: done`

## Stage 2 改造：Subagent 三角色开发

### 主 agent 角色：协调者

主 agent 读 `.plan-<branch>.md`，对每个 task 依次派 3 轮 subagent。

### Round 1: Implementer Subagent

**职责**：写代码 + 写测试

**行为纪律**（来自 `superpowers:test-driven-development`）：
- Iron Law：没有失败测试就不写实现代码
- Red-Green-Refactor 循环：先红 → 验证红 → 写最少代码 → 验证绿 → 重构
- 禁止保留"参考代码"，违反就删

**输入**：task 完整描述（从 plan 复制，不让 subagent 自己读文件）+ 相关代码上下文

**输出**：4 种状态
| 状态 | 含义 | 主 agent 行为 |
|------|------|--------------|
| `DONE` | 完成 | 进入 Round 2 |
| `DONE_WITH_CONCERNS` | 完成但有疑虑 | 读疑虑内容，评估后决定 |
| `NEEDS_CONTEXT` | 缺信息 | 补充上下文后重派同模型 |
| `BLOCKED` | 搞不定 | 升级模型 / 拆更小 task / 用 systematic-debugging |

**Model Selection**：
- 改 1-2 文件 + spec 清晰 → Sonnet（快且便宜）
- 多文件集成 / 需要全局理解 → Opus

### Round 2: Spec Reviewer Subagent

**职责**：验证实现是否匹配 spec

**核心原则**："不信任 Implementer 的报告。自己读代码验证。"

**检查维度**：
- 缺失的需求 — 有没有 spec 要求但没实现的
- 多余的实现 — 有没有 spec 没要求但加了的
- 理解偏差 — 实现的方向对不对

**输出**：✅ 通过 / ❌ 具体问题列表（含 file:line 引用）

❌ 时 → Implementer 修复 → Spec Reviewer 重新审查 → 循环直到 ✅

**Model**：Sonnet

### Round 3: Code Quality Reviewer Subagent

**前置条件**：Spec Review 必须先通过。顺序不能反。

**检查维度**：
- 代码质量（命名、结构、可维护性）
- 测试质量（测真实行为，不测 mock）
- 文件职责清晰度
- YAGNI 检查

**输出**：Approved / Issues (Critical → 必须修 / Important → 应该修 / Minor → 记录)

Issues 时 → Implementer 修复 → Quality Reviewer 重新审查

**Model**：Sonnet

### 全部 task 完成后

- 逐条运行 DoD Test 命令
- Verification Gate：每勾一个 [x] 前必须有 exit 0 证据
- 全部 [x] → `step_2_code: done`

## Stage 3-4：不变

- Stage 3：git add → commit → push → gh pr create（现有逻辑）
- Stage 4：write learning → step_4_ship: done（现有逻辑）
- devloop-check 条件 6 自动合并

## 失败自愈机制

### Implementer BLOCKED

```
第 1 次 BLOCKED → 补充上下文重派（同模型）
第 2 次 BLOCKED → 升级到更强模型重派
第 3 次 BLOCKED → 用 systematic-debugging Phase 1 分析根因
连续 3 个 task 都 BLOCKED → 停下质疑 plan，回 Stage 1 重做
```

### Spec Reviewer 连续 ❌

```
同一 task 连续 3 轮 ❌ → 不再让同一个 Implementer 修
  → 派新 Implementer 从头实现这个 task
```

### CI 失败

```
devloop-check 条件 4 加计数器（.dev-mode 新增 ci_fix_count 字段）
≤2 次 → 正常 action："读 log 修复"
=3 次 → action 变为："停下，用 systematic-debugging 分析根因，
         派 dispatching-parallel-agents 独立分析"
```

## 基础设施修复

### 修复 1：worktree-manage.sh unbound variable

```
问题：main 有 unstaged changes 时 fast-forward 失败，
      base_branch 变量带不可见字符导致 unbound variable
修复：加 set +u 保护 + 失败时 fallback 到当前 HEAD 创建 worktree
文件：~/.claude-account1/skills/dev/scripts/worktree-manage.sh
```

### 修复 2：Stop Hook orphan 不卡无关 session

```
问题：别的 session 的残留 .dev-mode 会 block 当前 session
现在：SD-1 发现任何 worktree 有未完成 step → 一律 block
改为：SD-1 区分 session_id
      同 session 的 orphan → block（正确行为）
      不同 session 的 orphan → warning + exit 0（放行当前 session）
文件：packages/engine/hooks/stop-dev.sh
```

### 修复 3：devloop-check CI 失败计数

```
问题：CI 失败后 agent 无限 push 修复，没有升级机制
改为：.dev-mode 加 ci_fix_count 字段
      条件 4 CI 失败时 ci_fix_count +1
      ≤2 → 正常 action
      =3 → action 切换为 systematic-debugging
文件：packages/engine/lib/devloop-check.sh
```

### 修复 4：worktree 消失自动清理

```
问题：worktree 被外部清理后 .dev-mode 残留，永久 block
改为：Stop Hook 检测到 worktree 目录不存在时，
      自动标记 cleanup_done 并删除状态文件
文件：packages/engine/hooks/stop-dev.sh
```

## 涉及文件

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `packages/engine/skills/dev/steps/01-spec.md` | 重写 | brainstorming + writing-plans 自主流程 |
| `packages/engine/skills/dev/steps/02-code.md` | 重写 | subagent-driven-development 三角色 |
| `packages/engine/skills/dev/SKILL.md` | 修改 | 加 autonomous_mode 说明 |
| `packages/engine/hooks/stop-dev.sh` | 修改 | orphan 区分 session + worktree 消失清理 |
| `packages/engine/lib/devloop-check.sh` | 修改 | CI 失败计数器 |
| `worktree-manage.sh` | 修改 | unbound variable 修复 |

## 不改的

- Stop Hook 整体架构（stop.sh 路由 → stop-dev.sh 适配 → devloop-check SSOT）
- Brain 调度（task 创建、状态回写、execution-callback）
- CI workflow（ci.yml、pr-review.yml）
- Stage 3-4 流程（push/PR/Learning/merge）
- Harness 相关逻辑（不在此设计范围内）
