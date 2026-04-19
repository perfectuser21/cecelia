# Harness v2 M2 — Initiative Planner 重写 + DAG 调度（Design）

Status: DRAFT · Owner: Alex · Created: 2026-04-19
Parent PRD: `docs/design/harness-v2-prd.md`
Milestone: M2（依赖 M1：PR #2439 已 merge）

---

## 1. 目标

把 Harness v2 阶段 A 的"一次性 Initiative 规划"落到代码：

1. 新的 Planner Skill 模板：输出 `sprint-prd.md` + `task-plan.json`（含 DAG）
2. Brain 层 DAG 调度器：拓扑排序 + 环检测 + 数据入库
3. Initiative Runner：串起 Planner → 入库 → 建合同 + Run

本 M2 不触碰 Proposer / Reviewer / Generator / Evaluator（属 M3/M4）。

## 2. 改动清单

### 2.1 Skill（三处同步）

`~/.claude-account1/skills/harness-planner/SKILL.md`
`~/.claude-account2/skills/harness-planner/SKILL.md`
`~/.claude/skills/harness-planner/SKILL.md`

版本 bump 到 `6.0.0`。新增：
- 输出 `task-plan.json` schema 强约束
- 强制 4-5 Task（>6 需 `justification` 字段）
- 每 Task 20-60 min、禁写 How
- DAG 哪怕线性也写成单链 `depends_on: ["ws1"]`

task-plan.json schema：
```json
{
  "initiative_id": "<UUID or 'pending'>",
  "justification": "<可选，Task > 5 必填>",
  "tasks": [
    {
      "task_id": "ws1",
      "title": "...",
      "scope": "...",
      "dod": ["..."],
      "files": ["packages/brain/src/xxx.js"],
      "depends_on": [],
      "complexity": "S|M|L",
      "estimated_minutes": 30
    }
  ]
}
```

### 2.2 Brain — `packages/brain/src/harness-dag.js`（新）

导出：

- `parseTaskPlan(jsonString)` — 严格校验 schema，返回 validated 对象，或抛 `Error`
- `detectCycle(tasks)` — DFS 环检测，返回 `true | false`
- `topologicalOrder(tasks)` — Kahn 算法，返回按依赖顺序的 `task_id[]`
- `upsertTaskPlan({ initiativeId, initiativeTaskId, taskPlan, client })` — 事务内：
  1. 为每个 logical task_id 建 Brain `tasks` 行（`task_type='harness_task'`，`parent_task_id=initiativeTaskId`）
  2. 建对应 `pr_plans` 行（`depends_on: UUID[]`）
  3. 建 `task_dependencies` 边（hard edges）
  4. 返回 `logicalId → UUID` 映射
- `nextRunnableTask(initiativeId)` — SQL 查 pending task where 所有 depends_on 对应的 task.status='completed'，按 created_at 取第一个

### 2.3 Brain — `packages/brain/src/harness-initiative-runner.js`（新）

导出 `runInitiative(task, opts)`：

1. 调 Planner 节点（复用 `createDockerNodes(...)` 的 planner；或直接 `executeInDocker`），输入 `task.description`
2. 从 Docker stdout 抽取 `task-plan.json` block（兼容 Markdown code fence 或纯 JSON）
3. `parseTaskPlan` → 结构化
4. 事务开启：`upsertTaskPlan` 建全部 subtask + deps
5. 插入 `initiative_contracts`（`version=1, status='draft', prd_content=<planner 输出>`）
6. 插入 `initiative_runs`（`phase='A_contract'`, `deadline_at=NOW() + timeout_sec`）
7. 返回 `{ success, initiativeId, contractId, runId, tasks: [...] }`

### 2.4 Brain — `packages/brain/src/executor.js`（改）

在现有 2.9 LangGraph 分支**之前**加：

```js
if (task.task_type === 'harness_initiative') {
  const { runInitiative } = await import('./harness-initiative-runner.js');
  return await runInitiative(task);
}
```

旧 `harness_planner` 分支保留不动（向后兼容 v1 task）。

### 2.5 测试

`packages/brain/src/__tests__/harness-dag.test.js`（新）—— 纯函数单测：
- `parseTaskPlan` 拒接缺字段 / 拒接无效 complexity / 接受 valid
- `detectCycle` 直接环 / 间接环 / 无环
- `topologicalOrder` 线性 / 分支 / 汇合

`packages/brain/src/__tests__/integration/harness-initiative-runner.integration.test.js`（新）——
- Mock Docker executor 返回固定 planner 输出（PRD + task-plan.json）
- 真 PG（按 integration 约定，使用 `pg.Pool`）
- 校验：3 个 subtask 入库、3 条 task_dependencies 边、1 initiative_contract、1 initiative_run
- **相对路径用 `../../db.js`**（integration 子目录）

## 3. Schema 约束（严格）

`parseTaskPlan` 校验点：
- `initiative_id`：string（'pending' 占位符允许，Runner 会用 task.payload.initiative_id 覆盖）
- `tasks`：非空数组，长度 ≤ 8（>5 必须有 `justification`）
- 每个 task：
  - `task_id`：非空字符串，全局唯一
  - `title`：非空
  - `scope`：非空
  - `dod`：string[] 非空
  - `files`：string[] 非空
  - `depends_on`：string[]（可空），元素必须是其他 task_id
  - `complexity`：'S'|'M'|'L'
  - `estimated_minutes`：20 ≤ n ≤ 60
- `depends_on` 合法性：元素不等于自己、无环（`detectCycle`）、指向存在的 task_id

## 4. 事务 / 一致性

`upsertTaskPlan` 必须在单事务内完成（`pool.connect()` → `BEGIN...COMMIT/ROLLBACK`）：
- 部分失败时回滚，不留孤儿 task 或半截 DAG
- task_id → UUID 映射建立后，`depends_on` 要同步转换为 UUID 数组写入 `pr_plans.depends_on` + 写 `task_dependencies` 边

## 5. 非目标（明确不做）

- 不实现 Proposer / Reviewer（M3）
- 不改 harness-graph.js 的 6 节点结构（M4 会拆子图）
- 不跑真实 Initiative E2E（本 M2 单元 + integration 即可）
- 不做 Dashboard 可视化（M6）
- 不实现预算熔断 / 超时检查 tick（M5）—— M2 只写入 `deadline_at`

## 6. 成功标准（DoD）

1. [BEHAVIOR] `packages/brain/src/harness-dag.js` 存在且导出 4 个函数 — `tests/`
2. [BEHAVIOR] `parseTaskPlan` 拒无效 schema — `tests/harness-dag.test.js`
3. [BEHAVIOR] `detectCycle` 正确识别环 — `tests/harness-dag.test.js`
4. [BEHAVIOR] `topologicalOrder` 线性+分支正确 — `tests/harness-dag.test.js`
5. [BEHAVIOR] `harness-initiative-runner.js` 存在且导出 runInitiative — `tests/`
6. [BEHAVIOR] `executor.js` 已加 `harness_initiative` 分支 — `tests/`
7. [BEHAVIOR] harness-planner SKILL.md 含 `task-plan.json` 模板 — `tests/`
8. [ARTIFACT] PRD 文件引用存在 — `docs/design/harness-v2-prd.md`
