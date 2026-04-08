# Contract Review Feedback (Round 1)

**verdict**: REVISION  
**reviewer_task_id**: c1c9fbc9-6249-4194-aa9e-a8237b11b2f9  
**propose_task_id**: d748ebfb-fe47-4cab-a181-410de5eeb51c  
**日期**: 2026-04-08

---

## 必须修改项

### 1. [歧义] Feature 1 — `harness_evaluate` payload 字段列表用"如"模糊列举

**问题**:  
硬阈值第三条写："`harness_evaluate` 任务的 `payload` 中包含与原 `harness_ci_watch` 关联的上下文字段（如 `sprint_dir`、`planner_task_id`）"。"如"意味着这只是举例，不是强制要求。Generator 可以只传 `ci_timeout: true` 而不传 `sprint_dir`，也能声称满足了所有硬阈值。

**影响**:  
Evaluator 无法裁定"哪些字段是必须存在的"。若 `sprint_dir` 缺失，下游 `harness_evaluate` 任务无法定位 sprint 目录，链路仍会中断，但合同无法判 Generator 违约。

**建议**:  
将模糊的"如"替换为明确的必须字段列表：
```
- 超时后新建的 `harness_evaluate` 任务的 `payload` 必须包含：
  `ci_timeout: true`、`sprint_dir`、`planner_task_id`、`planner_branch`
```

---

### 2. [遗漏] Feature 2 — 合同未要求验证 `lastPollTime.set()` 调用存在

**问题**:  
合同的硬阈值验证了：`POLL_INTERVAL_MS` 常量存在、`lastPollTime` Map 存在、以及 skip 条件表达式 `Date.now() - (lastPollTime.get(task.id) || 0) < POLL_INTERVAL_MS`。但没有要求验证 `lastPollTime.set(task.id, Date.now())` 在实际发起 API 调用前被调用。

**影响**:  
一个"声明了 Map 但从不更新它"的实现能通过所有硬阈值检查。结果是节流逻辑的判断条件永远成立（`0 < 30000`），每次 tick 都跳过，GitHub API 实际上从不被调用。合同无法区分"节流正确工作"和"节流永远跳过"这两种情况。

**建议**:  
在硬阈值中增加：
```
- `harness-watcher.js` 中在决定发起 GitHub API 调用时，调用 `lastPollTime.set(task.id, Date.now())` 更新节流时间戳（在 skip 判断通过后、API 调用前或后均可，但必须存在该 set 调用）
```

---

### 3. [边界] Feature 4 — 未定义 `planner_task_id` 存在但 DB 返回空行时的行为

**问题**:  
合同覆盖了两种情况：①`planner_task_id` 存在且状态为 `cancelled` → 跳过；②`planner_task_id` 为空 → 正常流程。但未覆盖第三种：`planner_task_id` 非空，但该任务在 DB 中不存在（已物理删除或 ID 无效），查询返回 `rows[0] = undefined`。

**影响**:  
Generator 可能实现成"查不到则视为已取消（保守策略，跳过链路）"，也可能实现成"查不到则视为正常（宽松策略，继续派生）"，两者都无法被合同判违约。Evaluator 遇到这种边界时无法裁定。

**建议**:  
在硬阈值或约束说明中明确：
```
- 当 `planner_task_id` 非空但 DB 查询返回空结果时，视为 planner 正常（继续派生子任务），不跳过链路
```
（这与 PRD 代码片段 `plannerRow.rows[0]?.status === 'cancelled'` 的隐含行为一致，应在合同中显式写明。）
