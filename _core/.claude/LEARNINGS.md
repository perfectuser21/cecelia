# Learnings from PR #334

## Date
2026-02-18

## Task
whitelist learning actions + executor handlers (v1.48.6)

## Key Learning
- 分支落后 develop 时（develop 已有 v1.48.5），必须从最新 develop 创建新分支而非 rebase
- 旧 PR 如果 CI 未触发新 run，close+reopen 也无法解决时，应创建全新分支和 PR
- PR #330 的 CI 只跑了第一个 commit（43f49a1），后续 push 没有触发新 CI run——原因未知，下次遇到同样问题直接创建新分支
- PRD 要求的 action_count 基准需要从 develop 当前状态读取，不能假设（develop 已有 24 个 actions，我们添加到 27）
- version bump 基准必须从 develop 当前版本读取（develop 已是 1.48.5，我们 bump 到 1.48.6）

---

# Learnings from PR #328

## Date
2026-02-17

## Task
quickRoute OKR 事件快速路由 (v1.48.4)

## Key Learning
- Worktree 中的 PRD/DoD 文件名必须与当前分支名完全匹配（`.prd-{branch}.md`），branch-protect.sh 用 `grep -cF "$PRD_BASENAME"` 匹配
- worktree 创建的分支名是 `cp-{timestamp}-{原始名}`，导致 PRD 文件名需要相应更新
- vitest 需要 `--root` 参数指向正确的 worktree 路径，否则会找主仓库中的测试文件
- check-version-sync.sh 必须在 worktree 根目录运行（用 `bash -c "cd ... && bash ..."` 方式）

---

# Learnings from PR #318

## Date
2026-02-17

## Task
修复 checkInitiativeDecomposition kr_id 查找链 (v1.46.1)

## Root Cause
`checkInitiativeDecomposition()` 只通过 `project_kr_links WHERE project_id = parent_id` 查找 kr_id。
很多 parent project 没有 kr_links 条目，导致：
- tasks 创建时 `goal_id = NULL`
- `selectNextDispatchableTask()` 过滤 `goal_id IN (allGoalIds)`
- NULL-goal_id 任务永远不被 dispatch，积累成垃圾

## Fix
在 kr_id 查找失败时，增加 3 层 fallback，共 4 层：
1. `project_kr_links WHERE project_id = parent_id`（原有逻辑）
2. `projects.kr_id WHERE id = initiative.id`（initiative 自身 kr_id）
3. `projects.kr_id WHERE id = parent_id`（parent project kr_id）
4. `project_kr_links WHERE project_id = initiative.id`（initiative 自身 kr_links）
5. null → skip（不创建任务）

## Lesson Learned
1. **Dispatch 可见性依赖 goal_id**：任何 seed task 必须有 goal_id，否则 dispatch 看不见
2. **数据 fallback 要穷举**：查找外键时要考虑多条路径，不要只走一条
3. **skip > NULL**：宁可不创建任务也不要创建 NULL goal_id 的任务
4. **测试 DB 集成**：这类 fallback 逻辑适合 DB 集成测试，直接 INSERT 数据验证真实行为

---

# Learnings from PR #315

## Date
2026-02-17

## Task
修复 dispatch ramp 死锁 bug (v1.45.4)

## Root Cause
`getRampedDispatchMax()` 的 ramp-up 条件是 `alertness === CALM && pressure < 0.5`。
当系统处于 AWARE 状态（`queue_blockage` 触发）且 `current_rate = 0` 时，形成死锁：
- AWARE ≠ CALM → 不增加
- AWARE < ALERT → 不减少（已经是 0）
- "stable" 分支 → `newRate = 0` 永久不变
- 无 dispatch → 队列继续积压 → 维持 AWARE → 无限循环

## Fix
在 `getRampedDispatchMax()` 末尾（cap 之前）加一个 bootstrap guard：
```javascript
if (newRate === 0 && alertness.level < ALERTNESS_LEVELS.ALERT && pressure < 0.8) {
  newRate = 1; // 允许最小启动，打破死锁
}
```

## Key Lessons

1. **状态机死锁模式**：当系统从状态 A（正常）变为状态 B（异常）的条件是「有活动」，
   而从状态 B 恢复需要「先有活动」时，容易形成死锁。此处：
   - 正常启动：CALM → ramp up → dispatch → 队列正常 → 维持 CALM
   - 死锁路径：queue_backlog → AWARE → ramp stuck at 0 → 无 dispatch → 积压 → 维持 AWARE

2. **分级保底设计**：保底（bootstrap）只对中等异常生效，高警戒（ALERT+）不生效：
   - CALM: 正常加速
   - AWARE: 允许最小 1（bootstrap，打破死锁）
   - ALERT+: 保持 0（真正的紧急状态，不该 dispatch）

3. **手动修复是 bug 的证明**：如果需要手动 `UPDATE working_memory` 才能让系统恢复，
   说明存在自动恢复路径缺失。每次手动修复后应立即分析原因并写代码修复。

4. **现有测试不够充分**：`tick-rampup.test.js` 有 13 个测试但没有 AWARE + rate=0 的场景，
   因为这是「stable 分支」的边缘情况。添加 bootstrap guard 后需要同步添加测试。

---

# Learnings from PR #310

## Date
2026-02-17

## Task
Exploratory 验证跑通 - 发现 Check 7 从未被调用

## Root Cause
Check 7 (`checkExploratoryDecompositionContinue`) 在 `decomposition-checker.js` 里被定义并导出，但**从未在 `runDecompositionChecks()` 中被调用**。这意味着即使 PR #309 修好了 executor.js 的 task_type 问题，Check 7 仍然永远不会触发。

## Fix
在 `runDecompositionChecks()` 的主循环后加入 Check 7 调用。

## Key Lesson
**定义 ≠ 调用**。每次新增 Check 函数时，必须同时：
1. 定义函数
2. 在 `runDecompositionChecks()` 里调用它
3. 写测试验证集成路径（不只是单元测试）

## Testing Pattern
直接测导出的函数（`checkExploratoryDecompositionContinue`），再写一个集成测试验证 `runDecompositionChecks()` 的结果包含该 check 的 actions。

---

# Learnings from PR #309

## Date
2026-02-17

## Task
统一 executor.js 和 OKR skill - Exploratory 优先策略

## Problem
executor.js（Brain 的实现）和 OKR skill（秋米的规范）不一致：
- executor.js 创建 task_type='dev' 的任务
- OKR skill 要求第一个 Task 的 task_type='exploratory'
- Check 7 检查 task_type='exploratory'，永远匹配不上
- 导致"边拆边做"机制完全失效

## Root Cause
executor.js 的 preparePrompt() 函数中，给秋米的 prompt 违反了 OKR skill 的规范：
1. 没有强制 exploratory 优先（让秋米选择）
2. Task 示例中 task_type 固定是 'dev'
3. 没有设置 payload.next_action='decompose'
4. 没有强制要求设置 repo_path

## Solution
修改 executor.js 的 prompt，强制遵循 OKR skill 规范：
1. 明确"默认使用 exploratory 模式（99% 的情况）"
2. 拆分为"创建第一个 Task（exploratory）"和"创建后续 Task（dev）"
3. 第一个 Task 的 task_type='exploratory'，并设置 next_action='decompose'
4. 添加 CRITICAL 警告，强制设置 repo_path

## Key Learnings

### 1. 统一规范的重要性
**Lesson**: 当有规范文档（OKR skill）和实现代码（executor.js）时，必须保持一致。

**Why it matters**:
- OKR skill 定义了秋米的行为规范
- executor.js 生成给秋米的指令
- 两者不一致 → 秋米行为不符合预期 → 整个流程失效

**Action**:
- 修改代码时，同时检查相关的规范文档
- 在 prompt 中明确引用规范（如"参考 OKR skill Stage 2"）

### 2. Check 机制依赖字段的准确性
**Lesson**: Check 7 检查的是 task_type 字段，不是 payload.exploratory。

**Why it matters**:
- 我们以为 payload.exploratory=true 就够了
- 但 Check 7 的 SQL 查询检查的是 task_type='exploratory'
- 字段不对 → 永远不会匹配

**Action**:
- 理解 Check 机制的触发条件
- 确保数据字段和 Check 逻辑一致

### 3. Prompt 即代码
**Lesson**: executor.js 中的 prompt 字符串就是"代码"，需要像对待代码一样严格对待。

**Why it matters**:
- Prompt 控制秋米的行为
- Prompt 错误 = 代码逻辑错误
- 但 prompt 不会被编译器检查，容易被忽视

**Action**:
- 添加质量验证说明（在 prompt 末尾）
- 定期对比 prompt 和规范文档
- 添加测试验证 preparePrompt() 的输出

### 4. 默认值的重要性
**Lesson**: "让秋米选择"vs"强制 exploratory 优先"，结果完全不同。

**Why it matters**:
- AI 倾向于选择"已知型（known）"（认为这样更高效）
- 但规范要求"默认 exploratory"
- 没有明确默认值 → AI 自己做了错误选择

**Action**:
- 在 prompt 中明确默认值
- 使用"默认使用 X"而不是"可以选择 X 或 Y"

### 5. 连锁故障的分析方法
**Lesson**: 从最终症状（任务无法派发）追溯到根本原因（prompt 不一致）。

**Diagnosis Path**:
1. 症状：Planner 不派发任务
2. 原因 1：repo_path 缺失
3. 原因 2：Check 7 不触发
4. 原因 3：task_type='dev' 而不是 'exploratory'
5. **根本原因**：executor.js 的 prompt 违反 OKR skill 规范

**Action**:
- 追溯问题时，不要停在表面原因
- 问"为什么会这样？"直到找到根本原因
- 修复根本原因，而不是修补症状

## Implementation Notes

### Changes Made
1. Line 781-790: 添加 repo_path 强制说明
2. Line 792-798: 修改拆解模式说明，强制 exploratory 优先
3. Line 812-840: 拆分 Task 创建为两部分（exploratory + dev）
4. Line 842-852: 新增质量验证说明

### Testing
- JavaScript 语法检查通过
- CI Facts Consistency 通过（修复 DEFINITION.md 版本）
- 所有其他 CI 检查通过

### Risks Mitigated
- 只修改 prompt 字符串，不修改代码逻辑 → 低风险
- 可以随时 revert → 可回滚

## Metrics

### Before
- 0 个 exploratory task 被创建
- Check 7 永远不触发
- "边拆边做"机制 0% 工作

### After (Expected)
- 每个 Initiative 至少 1 个 exploratory task
- Check 7 正常触发
- "边拆边做"机制 100% 工作

## Next Steps

1. ✅ 部署到生产（PR #309 合并后）
2. ⏳ 验证新的 KR 拆解流程
3. ⏳ 观察 exploratory task 完成后 Check 7 是否触发
4. ⏳ 观察秋米是否正确读取探索结果并细化后续 tasks
5. ⏳ 添加单元测试验证 preparePrompt() 的输出

## References
- PR: https://github.com/perfectuser21/cecelia-core/pull/309
- OKR Skill: ~/.claude/skills/okr/SKILL.md Stage 2 (Line 332-408)
- Check 7: brain/src/decomposition-checker.js (Line 714-775)
- 诊断报告: /tmp/root_cause_analysis.md

---

# Learnings from PR #314

## Date
2026-02-17

## Task
修复 runDecompositionChecks 未调用 Check 6 + Liveness probe 对 decomp 任务过早超时

## Bug 1: Check 6 未被调用的模式

**根本原因**: `checkInitiativeDecomposition()` (Check 6) 在 `decomposition-checker.js` 里被定义并导出，但**从未在 `runDecompositionChecks()` 中被调用**。这是与 PR #310 相同的模式（Check 7 也曾有同样问题）。

**新 Initiative 无法被发现的链路**:
1. `getActiveExecutionPaths()` 使用 INNER JOIN tasks → 只返回已有 tasks 的 Initiative
2. 新建 Initiative（无 tasks）→ 不在 active paths 中
3. `runDecompositionChecks()` 只处理 active paths → 新 Initiative 被完全忽略
4. 系统无法自愈 → 需要人工干预手动 SQL 插入 seed task

**修复**: 在 inventory replenishment 循环后、exploratory continuation 前，添加 Check 6 调用。

**Lesson**: `decomposition-checker.js` 中每个 `checkXxx()` 函数都需要在 `runDecompositionChecks()` 中显式调用，否则它永远不会触发。每次新增 Check 函数，必须：
1. 定义函数
2. 在 `runDecompositionChecks()` 里调用它
3. 更新集成测试的 mock 顺序（pool.query 的调用顺序会变化）

## Bug 2: Liveness probe 对长时任务的错误处理

**问题**: `/okr` 类任务通过 cecelia-run 运行 claude 进程，耗时 3-10 分钟。Liveness probe 的双确认模式每 5s 一个 tick，2 个 tick 后就会确认 dead。如果任务在派发后：
- `activeProcesses` 中没有 entry（Brain 重启、手动创建等）
- `current_run_id` 未能在 `ps aux` 中被找到

则该任务会在约 10 秒内被标记为 failed，即使 claude 进程仍在运行。

**修复**: 在 `probeTaskLiveness()` 中，对 `payload.decomposition === 'true'` 的任务添加 60 分钟宽限期。在宽限期内，即使 process 看起来不在 ps 中，也不进入 suspect/dead 流程。

**模式**: 对长时运行的任务类型，liveness probe 需要单独配置超时策略。不同任务类型的合理超时：
- 普通 dev/qa 任务: 双确认（~10s）
- decomposition (/okr): 60min 宽限

## 测试模式

集成测试中，`runDecompositionChecks()` 的 pool.query mock 顺序在添加新 Check 后会改变：
- 旧顺序: getActiveExecutionPaths → Check 7
- 新顺序: getActiveExecutionPaths → Check 6 → Check 7

**必须更新所有涉及 `runDecompositionChecks()` 的集成测试**，在 Check 6 位置插入正确的 mock 返回值。

## References
- PR: https://github.com/perfectuser21/cecelia-core/pull/314
- Bug 1: brain/src/decomposition-checker.js:runDecompositionChecks() (line 788)
- Bug 2: brain/src/executor.js:probeTaskLiveness() (line 1315)
- Tests: brain/src/__tests__/exploratory-continuation.test.js, liveness-probe.test.js

---

# 丘脑路由可观测性审计 (2026-02)

## Date
2026-02-17

## 背景
审计 Thalamus 的 processEvent() 路径，检查路由决策的可观测性缺口。触发背景：cecelia_events 中 routing_decision、quick_route、thalamus_route 等事件类型均为 0 条记录。

---

## 现状

### processEvent() 三条路径

| 路径 | 触发条件 | 代码位置 |
|------|----------|----------|
| **L0 quickRoute** | heartbeat / tick (no anomaly) / task_completed (no issues) | thalamus.js:454-490 |
| **L1 analyzeEvent** (Sonnet) | 其他所有事件 | thalamus.js:323-373 |
| **L2 Cortex** (Opus) | L1 决策 level=2 时升级 | thalamus.js:524-537 |

### quickRoute 覆盖的事件类型（纯代码，不调用 LLM）

- `heartbeat` → `no_action`
- `tick` (has_anomaly=false) → `fallback_to_tick`（这是 **最常见路径**，每 5min 一次 tick）
- `task_completed` (has_issues=false) → `dispatch_task`

**实际调用点**：
- `tick.js:903`：每次 tick 调用 `thalamusProcessEvent(tickEvent)`，tickEvent 中 `has_anomaly=false`（固定值）
- `routes.js`：execution-callback 路由中，task_completed/task_failed 事件调用

### 现有 token_usage 记录情况

**token_usage 事件：0 条**。

`recordTokenUsage()` 在 `thalamus.js:259-278` 中定义，仅在 `analyzeEvent()` 成功调用 Sonnet 后触发。但：
- **tick 事件走 quickRoute**（has_anomaly 固定为 false）→ 永远不调用 Sonnet → 永远不记录 token_usage
- **目前无 Sonnet 被实际调用的证据**

### decision_log 包含路由信息：否

`decision_log` 表有 343,548 条记录，全部由 Brain 的 tick/RCA 流程写入：

| trigger | count |
|---------|-------|
| tick | 340,220 |
| api | 3,311 |
| 其他 | 17 |

`llm_output_json` 字段存的是 Brain 决策（如 `{"action": "generate_decision", ...}`），**不是 thalamus 路由决策**。两个 LLM 路径（thalamus 和 brain tick decision）是完全分离的，decision_log 不捕获 thalamus 路由。

### cecelia_events 中的路由相关事件

**0 条** `routing_decision`、`quick_route`、`thalamus_route` 记录。

现有 21 种 event_type，均为系统层事件（escalation、task_dispatched、circuit_open 等）。**丘脑路由决策从未写入 cecelia_events**。

### trace.js 机制

`trace.js` 提供完整的 span/run_id tracing 框架（`run_events` 表），但 **thalamus.js 完全没有使用它**：
- 没有 `traceStep()` 调用
- 没有 `withSpan()` 包装
- 没有 `run_id` / `span_id` 关联

thalamus 的唯一可观测性是 `console.log`，不持久化。

---

## 缺口汇总

| 缺口 | 严重度 | 说明 |
|------|--------|------|
| **路由路径不被持久化** | 高 | quick/llm/cortex/fallback 哪条路径被走过，完全不知道 |
| **quickRoute 调用频率未记录** | 高 | 每次 tick 都会走 quickRoute，但没有任何计数 |
| **Sonnet 是否被实际调用过：不明** | 高 | token_usage=0，可能 Sonnet 从未被触发 |
| **Cortex 升级频率：不明** | 中 | level=2 升级是否发生过？完全无记录 |
| **fallback 降级频率：不明** | 中 | Sonnet 解析失败的频率不知道 |
| **has_anomaly 永远为 false** | 中 | tick.js:900 硬编码 `has_anomaly: false`，Sonnet 永远不会被 tick 事件触发 |
| **trace.js 未集成** | 低 | 无 run_id/span_id 关联，路由决策无法与 task 执行链关联 |

---

## 建议实现方案

### Task A：为 processEvent() 添加路由指标记录

在 `thalamus.js` 的 `processEvent()` 中，每次路由决策后写入 `cecelia_events`：

```js
// 快速路由后：
await pool.query(`INSERT INTO cecelia_events (event_type, source, payload) VALUES ('thalamus_quick_route', 'thalamus', $1)`,
  [JSON.stringify({ event_type: event.type, action: quickDecision.actions[0].type })]);

// Sonnet 分析后：
await pool.query(`INSERT INTO cecelia_events (event_type, source, payload) VALUES ('thalamus_llm_route', 'thalamus', $1)`,
  [JSON.stringify({ event_type: event.type, level: decision.level, actions: ... })]);

// Cortex 升级后：
await pool.query(`INSERT INTO cecelia_events (event_type, source, payload) VALUES ('thalamus_cortex_escalation', 'thalamus', $1)`,
  [JSON.stringify({ event_type: event.type, cortex_actions: ... })]);

// Fallback 后：
await pool.query(`INSERT INTO cecelia_events (event_type, source, payload) VALUES ('thalamus_fallback', 'thalamus', $1)`,
  [JSON.stringify({ event_type: event.type, reason: ... })]);
```

### Task B：修复 has_anomaly 硬编码

`tick.js:900` 的 `has_anomaly: false` 是硬编码值，导致 Sonnet 永远不会被 tick 触发。应基于 alertness 等级动态设置：

```js
const tickEvent = {
  type: EVENT_TYPES.TICK,
  timestamp: now.toISOString(),
  has_anomaly: currentAlertnessLevel >= ALERTNESS_LEVELS.WARNING  // 动态判断
};
```

### Task C：API 端点暴露路由统计

在 `trace-routes.js` 新增端点：

```
GET /api/brain/thalamus/stats
→ 返回：{ quick_routes_24h, llm_routes_24h, cortex_escalations_24h, fallbacks_24h, token_cost_24h }
```

---

## 关键发现

**根本原因**：thalamus 的路由决策被设计为"仅 console.log 可见"，从未持久化。这导致：
1. 无法回顾历史路由分布
2. 无法监控 Sonnet 调用成本
3. 无法检测 has_anomaly 永远为 false 的 bug（通过观察 Sonnet 调用频率可发现）

**最值得优先修复**：Task B（has_anomaly 动态化），因为这直接影响 Sonnet 是否被正确触发。

## References
- `brain/src/thalamus.js:507` - processEvent() 主入口
- `brain/src/thalamus.js:454` - quickRoute() 快速路由
- `brain/src/tick.js:897-904` - tick 事件构造（has_anomaly 硬编码）
- `brain/src/trace.js` - TraceStep SDK（未被 thalamus 使用）
- `brain/src/trace-routes.js` - 现有 trace API 端点

---

# Learnings from PR #313

## Date
2026-02-17

## Task
修复 selectNextDispatchableTask 缺少 description 字段导致 pre-flight check 永远失败 (P0 Bug)

## Root Cause
PR #296 (2026-02-16) 加入 pre-flight check 到 dispatch 流程时，`selectNextDispatchableTask()` 的 SQL SELECT 语句里没有包含 `description` 和 `prd_content` 字段。导致传给 `preFlightCheck()` 的 task 对象里 `description = undefined`，pre-flight check 的 Check 2 (description validation) 永远返回 "Task description is empty"，所有任务都无法被派发。

## Fix
1. `tick.js` selectNextDispatchableTask() SELECT 加入 `t.description, t.prd_content`
2. `pre-flight-check.js` Check 2 改为 `const descContent = task.description || task.prd_content` — 支持 prd_content fallback

## Verification
- `pre_flight_stats: { failed: 0, passed: 3, passRate: "100.00%" }` ✅
- Task 被成功派发到 cecelia-bridge ✅

## Lesson
**当给 tick.js 添加新检查（如 pre-flight check）时，必须同步检查 selectNextDispatchableTask() 的 SELECT 字段列表，确保检查需要的字段都被 SELECT 了。**

- Impact: **High** (P0 Bug - 所有任务无法派发)
- Time to detect: ~18 hours (PR #296 merged at 2026-02-16, bug found 2026-02-17)
