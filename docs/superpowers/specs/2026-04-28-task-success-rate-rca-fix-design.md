# RCA + Fix: Brain 任务成功率从 39% 恢复到 >80%

**日期**: 2026-04-28  
**分支**: cp-0428132356-rca-fix-task-success-rate  
**Brain 任务**: 1538e81b-935e-432f-a1e2-32ac520d0115

---

## 问题描述

最近 24h 任务成功率仅 39%（15 完成 / 38 总结案）。

```
status     | count
-----------+-------
failed     |   20
completed  |   15
paused     |   11
queued     |    5
quarantined|    4
```

---

## 根因分析

### 根因 1（主因，占全部 20 个失败）：harness_task 仍被创建但已 retired

**链路**：
1. `harness_initiative` 进入 Phase A 结束时调用 `harness-dag.js:upsertTaskPlan()`
2. `upsertTaskPlan()` 向 `tasks` 表 INSERT `task_type='harness_task'` 行
3. `executor.js` 遇到 `harness_task` → 立即标为 `failed`，`error_message = "task_type harness_task retired"`
4. 7 个 Initiative × 4 sub_tasks = 28 次失败

**根本原因**：Sprint 1 PR 把 Harness 改成 LangGraph full graph（通过 `Send fanout + runSubTaskNode` 内联执行），不再需要在 `tasks` 表创建 `harness_task` 行。但 `upsertTaskPlan()` 和 `createFixTask()` 这两处写入点**没有同步清除**，成为死代码残留。

**修复**：停止在 `upsertTaskPlan()` 中创建 tasks 表行（只保留 task_dependencies 边和 pr_plans 记录即可），同理 `createFixTask()` 也不需要 INSERT。

### 根因 2（次因）：测试 KR 污染，持续触发修复任务

**链路**：
- DB 中存在 7 条测试用 KR（`KR dedup test` × 2、`Test KR for select` × 2、`Empty KR`、`LP Test KR` × 2）
- 这些 KR 处于 `decomposing/in_progress`，但无 okr_projects 关联
- `decomposition-checker.js:checkKRWithoutProject()` 每次 tick 为它们创建 "KR 拆解（修复）" 任务
- 当前已有 2 个重复 "KR 拆解: KR dedup test" 在 queued 队列

**修复**：将这些测试 KR archive，阻止 decomp checker 持续触发。

### 根因 3（结构性）：积压任务占据队列

- 50+ queued 任务，其中含大量过期的 content-pipeline（21 个）和 arch_review（4 个，最早 2026-04-25）
- 这些任务阻塞正常任务被 pick 和 dispatch

**修复**：批量取消明确过期/无效的任务。

---

## 修复方案

### Fix 1: 停止在 upsertTaskPlan() 中 INSERT harness_task（核心）

**文件**: `packages/brain/src/harness-dag.js`

当前代码（line 284-289）：
```js
const taskInsert = await client.query(
  `INSERT INTO tasks (task_type, title, description, status, priority, payload)
   VALUES ('harness_task', $1, $2, 'queued', 'P0', $3::jsonb)
   RETURNING id`,
  [t.title, t.scope, JSON.stringify(payload)]
);
const uuid = taskInsert.rows[0].id;
idMap[t.task_id] = uuid;
insertedTaskIds.push(uuid);
```

**修改**：不再 INSERT tasks 行，改用内存 UUID 作为 idMap 的 key，让 task_dependencies 使用 logical_task_id。`upsertTaskPlan` 的返回值 `{idMap, insertedTaskIds}` 调用方需要检查是否依赖。

**关键决策**：查 harness-initiative.graph.js 对 upsertTaskPlan 返回值的使用——如果 idMap 用于建 task_dependencies 边，且 task_dependencies 仍需 task UUID，则需要生成随机 UUID 而不是从 DB INSERT 拿。

实际检查（line 195-215）：`idMap` 和 `insertedTaskIds` 返回后没有被外部直接使用（Sprint 1 full graph 内联执行，不用 task_dependencies 来驱动）。可以安全地将 upsertTaskPlan 简化为：不写 tasks 表，只写 pr_plans（如有）和返回空 idMap。

### Fix 2: 停止在 createFixTask() 中 INSERT harness_task

**文件**: `packages/brain/src/workflows/harness-initiative.graph.js`

`createFixTask()` 创建 fix-mode `harness_task`，在 full graph 中应改为内联触发 fix round（通过 graph state）而不是写 DB task。

由于 `createFixTask()` 在 `runPhaseCIfReady()` 中被调用（line 482），而 Sprint 1 full graph 使用 `runSubTaskNode` + `joinNode` + `finalE2eNode` 路径，这个 procedural 路径已经不是主路径。检查 `runPhaseCIfReady` 是否仍被 tick 调用：

**修复策略**：在 `createFixTask()` 内部加早返回 guard，检测到 retired 状态（或直接删除 INSERT，改为 console.warn + return noop ID）。

### Fix 3: archive 测试 KR（运维操作，直接 PATCH）

通过 Brain API 批量 archive 7 条测试 KR：
- `04441931`、`61bb6d06`（KR dedup test）
- `294bba5c`（Empty KR）
- `05c757bf`、`8513da8e`（Test KR for select）
- `2f32a1bc`、`f90e6aba`（LP Test KR）

同时取消对应的 queued 修复任务（`e69245f6`、`b6fb9ec4`、`db946add`、`27cb5268`、`3c67abe5`）。

### Fix 4: 取消积压过期任务（运维操作）

批量取消：
- 过期 `arch_review` 任务（4 个，>24h）
- 过期 `content-pipeline` 任务（21 个，最早 4 月 21 日）
- 重复 `harness_initiative` smoke 测试任务（多个 P2，>2 天）

---

## 测试策略

### 单元测试（unit）
- `packages/brain/src/__tests__/harness-dag.test.js`：验证 `upsertTaskPlan()` 不再向 tasks 表写入行
- `packages/brain/src/__tests__/harness-initiative-graph.test.js`：验证 `createFixTask()` 不创建 `harness_task` DB 行

### 集成测试（integration）
- `packages/brain/tests/brain/harness-no-retired-task-spawn.test.js`：启动真实 DB，调用 upsertTaskPlan 后断言 `SELECT COUNT(*) FROM tasks WHERE task_type='harness_task'` = 0

### Smoke 验证
- `packages/brain/scripts/smoke/harness-no-retired-spawn-smoke.sh`：
  - curl `localhost:5221/api/brain/tasks?status=failed&limit=5` 断言 0 个 `harness_task` 新失败
  - psql 查 `key_results` 断言测试 KR 已 archived

---

## 成功标准

1. 24h 后任务失败率 < 20%（成功率 > 80%）
2. `SELECT COUNT(*) FROM tasks WHERE task_type='harness_task' AND status='failed' AND created_at > NOW() - INTERVAL '1 hour'` = 0
3. 7 条测试 KR status = 'archived'
4. 已取消的积压任务不再出现在 queued 列表

---

## 影响评估

- **harness-dag.js** 改动：`upsertTaskPlan` 不写 tasks 行，对 Sprint 1 full graph 零影响（full graph 不依赖 tasks 行驱动）
- **createFixTask()** 改动：fix round 路径暂时 noop，不影响 Phase A/B 正常流程
- **测试 KR archive**：纯数据清理，零代码影响
- **积压任务取消**：释放队列 slot，加速正常任务 dispatch
