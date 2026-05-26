# Harness Pipeline Brain 修复设计

**日期**：2026-05-24  
**分支**：cp-0524153048-fix-harness-pipeline-brain-4issues  
**类型**：fix（修复已有行为缺口，非新功能）

---

## 背景

Walking Skeleton skill 审计发现 harness pipeline 三处断链：

1. `harness_evaluate` 任务类型只在 `SKILL_WHITELIST` 中注册，`VALID_TASK_TYPES` 和 `LOCATION_MAP` 均缺失，导致路由校验失败
2. Planner 节点不透传 `prep_prd_body`（PrepPRD 全文）和 `CECELIA_JOURNEY_ID`，Planner agent 无法获取用户确认过的产品上下文
3. `reportNode` 只做 DB 状态回写，不派 `harness_report` 子任务，导致 Notion 同步、飞书通知、harness-report.md 均不执行

---

## 修复方案

### Fix 1：task-router.js — harness_evaluate 双写

**文件**：`packages/brain/src/task-router.js`

**改动 A**（VALID_TASK_TYPES 数组，第 55 行后）：
```js
'harness_evaluate',    // Evaluator 对抗性功能验收（已在 SKILL_WHITELIST 第 129 行）
```

**改动 B**（LOCATION_MAP，`'harness_final_e2e'` 之后）：
```js
'harness_evaluate': 'us',  // Layer 3e: Evaluator 对抗性功能验收
```

**原因**：`isValidTaskType()` 查 `VALID_TASK_TYPES`；`getTaskLocation()` 查 `LOCATION_MAP`。两表互不自动同步，必须双写。

---

### Fix 2：harness-initiative.graph.js — Planner 注入 prep_prd_body + CECELIA_JOURNEY_ID

**文件**：`packages/brain/src/workflows/harness-initiative.graph.js`

**改动（runPlannerNode 函数，约第 568-598 行）**：

在 prompt 的 `## 任务描述` 之后追加：
```js
## PrepPRD（产品语言，用户确认过的需求文档）
${state.task?.payload?.prep_prd_body || '（未提供，Planner 从 sprint-prd.md 推断）'}
```

在 env 对象中追加：
```js
CECELIA_JOURNEY_ID: state.task?.payload?.journey_id || '',
```

**原因**：PrepPRD 是唯一人工确认点，Planner 需要它来准确生成 sprint-prd.md；CECELIA_JOURNEY_ID 供 Planner 和后续节点做 Journey 回写。

---

### Fix 3：harness-initiative.graph.js — reportNode 派 harness_report 子任务

**文件**：`packages/brain/src/workflows/harness-initiative.graph.js`

**改动（reportNode 函数，约第 1263 行后，现有两个 DB 写完成之后）**：

```js
// 派 harness_report 子任务（6 步交付：Notion / 飞书 / harness-report.md）
try {
  await dbPool.query(
    `INSERT INTO tasks (title, description, task_type, status, priority, payload)
     VALUES ($1, $2, 'harness_report', 'queued', 'P2', $3::jsonb)`,
    [
      `[Harness Report] ${state.task?.title || state.initiativeId}`,
      `Auto-spawned by reportNode for initiative ${state.initiativeId}`,
      JSON.stringify({
        initiative_id: state.initiativeId,
        final_e2e_verdict: state.final_e2e_verdict,
        sprint_dir: state.sprintDir,
        journey_id: state.task?.payload?.journey_id,
        feature_id: state.task?.payload?.feature_id,
        sub_tasks: state.sub_tasks || [],
      }),
    ]
  );
} catch (err) {
  console.warn(`[harness-initiative.graph] reportNode spawn harness_report failed: ${err.message}`);
}
```

**原因**：保留现有 DB 写（task.status 回写是必须的），在此基础上触发 harness-report skill 完整的 6 步交付流程。`harness_report` 任务 status='queued'，Brain tick 自动 pick up。

---

### Fix 4：_routeAfterFinalE2E — 不变

FAIL → 'pick_sub_task'（无限重试直到 PASS）是设计意图，不改。

---

## 测试策略

commit 类型为 `fix:`，不需要 smoke.sh。

| 修复 | 测试类型 | 文件 |
|------|---------|------|
| Fix 1：VALID_TASK_TYPES + LOCATION_MAP | unit | `src/__tests__/task-router-initiative.test.js` |
| Fix 2：runPlannerNode prompt 含 prep_prd_body | unit | `src/workflows/__tests__/harness-initiative.graph.full.test.js` |
| Fix 3：reportNode INSERT harness_report | unit | `src/workflows/__tests__/harness-initiative.graph.full.test.js` |

**TDD 顺序**：
- commit-1：3 个 failing tests（无实现，测试直接失败）
- commit-2：3 个 fixes 让测试全部通过

---

## 影响范围

- `packages/brain/src/task-router.js`（2 处添加）
- `packages/brain/src/workflows/harness-initiative.graph.js`（2 处修改）
- 测试文件（新增 case，不改现有 case）
- 无 schema 变更，无 API 变更
