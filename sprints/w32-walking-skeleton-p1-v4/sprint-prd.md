# Sprint PRD — W32 Walking Skeleton P1 终验 round 4 (after B10)

## OKR 对齐

- **对应 KR**：Walking Skeleton P1（端到端 1node harness pipeline 零中断闭环）
- **当前进度**：B1-B10 全部 merge（commits 197dc7b05 → 6d9060d72），但前 3 轮终验未通过（round 1/2/3 均暴露新 hole）
- **本次推进预期**：B10 修复 evaluator 阶段 thread_id 复用 hole 后，end-to-end 跑一个完整 harness Initiative，所有 5 阶段 (planner → proposer → reviewer → generator → evaluator) 在 1 个 LangGraph thread 内贯通，**判定 P1 是否可以从"Active fixing"状态切到"Closed"**。

## 背景

Walking Skeleton P1 自 2026-04 启动，B1-B10 逐个修补 dispatcher / reaper / dispatch_events / harness thread lookup / callback_queue 回写 / evaluator thread_id 复用等 10 个端到端 hole：

- B1 reportNode 回写 tasks.status（fixed #2903）
- B2 zombie in_progress reaper（fixed #2905）
- B3 slot accounting 实时对齐（fixed #2909）
- B4 consciousness-loop guidance TTL（fixed 7eb7a2fc5）
- B5 dispatcher HOL blocking（fixed #2911）
- B6 dispatch_events 真写入（fixed #2904）
- B7 fleet heartbeat 可信度（fixed cc7901ccb）
- B8 reaper threshold 30→60min + harness_* 豁免（fixed #2913）
- B9 lookupHarnessThread 加 harness-evaluate dispatch（fixed #2917）
- B10 evaluate_contract 复用 task graph thread_id（fixed #2920）

round 1/2/3 终验暴露了 B7/B8/B9/B10，分别因 heartbeat 误杀、reaper 误杀 harness 子任务、evaluator dispatch 找不到 thread、evaluator 起新 thread 导致 graph state 断裂而失败。**round 4 必须在 0 新 hole 的情况下端到端跑完，方可关闭 P1。**

OKR 关联：P1 闭合是 Walking Skeleton 整个 KR 的前置条件（P2/P3 都依赖 P1 端到端零中断的稳定基线）。

---

## Golden Path（核心场景）

**Brain（系统）从 [派发一个新建 harness_initiative 任务] → 经过 [5 阶段顺序执行 + dispatcher/reaper/heartbeat 全部不误杀不漏派] → 到达 [Initiative 任务 status=completed + 同一 LangGraph thread_id 串起 5 阶段 + dispatch_events 完整可审计 + 无 zombie/HOL/orphan]**

具体：

1. **入口（触发条件）**：通过 `POST /api/brain/tasks` 创建一个 `task_type=harness_initiative` 任务，PRD 为最简内容（如 "echo hello" 级别 playground 任务，不依赖外部资源）。Brain 已运行至少 1 个完整 tick loop。

2. **系统处理（关键步骤）** — 必须按顺序、在**同一 thread_id** 下完成，无任何阶段需要人工介入或重试：
   1. **planner 阶段**：dispatcher 拾起 initiative 任务 → 派给 harness-planner agent → agent 产出 sprint-prd.md → reportNode 回写 task 为 completed（B1 路径）→ 调度下游 harness_propose 子任务。
   2. **proposer 阶段**：harness_propose 任务派出 → agent 产出合同草案 → 入库 → 调度 harness_review 子任务。
   3. **reviewer 阶段**：harness_review 任务派出 → GAN 多轮直到 APPROVED → 调度 harness_generate 子任务。
   4. **generator 阶段**：harness_generate 任务派出 → TDD 两次 commit → 调度 harness_evaluate 子任务。
   5. **evaluator 阶段**（B9/B10 重点）：harness_evaluate 任务派出 → `lookupHarnessThread` 命中已存在 thread_id（不另起新 thread，B10）→ evaluate_contract 在同一 graph state 内执行验证命令 → 最终 verdict 写回 initiative 任务的 result 字段。

3. **出口（可观测结果）** — 全部必须满足：
   - **a. Initiative 任务状态**：根 `harness_initiative` 任务 `status=completed`，`result.verdict ∈ {PASS, FAIL}` 但**不允许 stuck/in_progress/error**。
   - **b. Thread 连续性**：5 个阶段子任务的 `thread_id` 字段**完全相同**（B9/B10 oracle）。
   - **c. Dispatch 可审计**：`dispatch_events` 表中本 Initiative 关联的 events 数量 ≥ 5（每阶段至少 1 条 dispatched event，B6 oracle）。
   - **d. 无 zombie**：终态后 `tasks` 表中本 Initiative 及其子任务**无任何**仍处于 `in_progress` 且 `last_heartbeat_at` 超过 60min 的记录（B2/B8 oracle）。
   - **e. Slot 一致性**：fleet slot accounting 与 `tasks.status='in_progress'` 实时计数**完全相等**（B3 oracle，从 `/api/brain/fleet/slots` 拉取对比）。
   - **f. 无 HOL**：在本 Initiative 派发期间 `dispatch/recent` 端点显示 dispatcher 至少有 1 次"队首跳过 → 后续任务被派出"行为（B5 验证，确认 HOL fix 生效；如果队列从头到尾没有跳过事件，跑一个并发场景补充验证）。
   - **g. heartbeat 不误杀**：本 Initiative 5 阶段执行期间**无任何子任务**被 reaper 标记为 zombie 后又被外部回报为 completed（B7/B8 反向 oracle，证明 heartbeat 可信、reaper 不误判 harness_*）。

---

## Response Schema（API 任务必填，其他任务标 N/A）

> 本任务核心是 Brain 内部 dispatcher / reaper / harness graph 行为验证，不引入新 HTTP endpoint。但**验收时**会调用以下既有端点抓取 oracle 数据，列出预期 shape 锁死 evaluator 解析逻辑：

### Endpoint: GET /api/brain/tasks/{task_id}

**Query Parameters**：路径参数 `task_id` (uuid string, 必填)，无 query。

**Success (HTTP 200)**:
```json
{
  "id": "<uuid>",
  "task_type": "<string>",
  "status": "<string 字面量之一: pending|in_progress|completed|failed|skipped>",
  "thread_id": "<string|null>",
  "parent_task_id": "<uuid|null>",
  "result": { "verdict": "<string|null>" },
  "last_heartbeat_at": "<ISO-8601 string|null>"
}
```
- `status` 必须是上述 5 个字面量之一，**禁用** `done`/`complete`/`success`/`running`/`active` 等变体
- `thread_id` 必填字段（可为 null），oracle 比对依赖此 key 字面量
- **禁用响应字段名**: `state`/`task_state`/`phase`/`stage`（统一用 `status`）

### Endpoint: GET /api/brain/dispatch/recent?initiative_id={uuid}&limit=50

**Query Parameters**（B6 oracle 必填）:
- `initiative_id` (uuid string, 必填): 过滤 Initiative
- `limit` (integer-as-string, 可选, 默认 50): 返回条数上限
- **禁用 query 名**: `iid`/`task`/`task_id`/`root_id`/`max`/`count`/`n`

**Success (HTTP 200)**:
```json
{
  "events": [
    {
      "id": "<uuid>",
      "task_id": "<uuid>",
      "event_type": "<string 字面量之一: dispatched|skipped|completed|failed|reaped>",
      "created_at": "<ISO-8601>"
    }
  ],
  "count": <integer>
}
```
- `events` 必须是数组（即使空也是 `[]`，**禁用** `null`）
- `event_type` 字面量集合**禁止扩展**为 `dispatch`/`send`/`out`/`error`
- **Schema 完整性**: 顶层 keys 必须完全等于 `["count", "events"]`

### Endpoint: GET /api/brain/fleet/slots

**Query Parameters**: 无

**Success (HTTP 200)**:
```json
{
  "total_slots": <integer>,
  "in_use": <integer>,
  "in_progress_task_count": <integer>
}
```
- B3 oracle 核心: `in_use === in_progress_task_count` 必须恒等
- **禁用字段名**: `used`/`busy`/`active`/`running_count`/`task_count`（generator/evaluator 不得自由替换）

### Endpoint: POST /api/brain/tasks

**Query Parameters**: 无（body JSON）

**Request Body**:
```json
{
  "task_type": "harness_initiative",
  "prd": "<string>",
  "priority": <integer>
}
```

**Success (HTTP 201)**:
```json
{ "id": "<uuid>", "task_type": "harness_initiative", "status": "pending" }
```

**Error (HTTP 400)**:
```json
{ "error": "<string>" }
```
- 必有 `error` key，**禁用** `message`/`msg`/`reason`/`detail`

---

## 边界情况

- **e1 终验任务自己卡住**：如果本 W32 验证 Initiative 自己在某阶段 stuck，evaluator 必须把它判 FAIL 并写明卡在哪一阶段（不能 self-loop）。
- **e2 真实跑出 FAIL verdict**：内层 playground PRD 跑出业务 verdict=FAIL 不影响 P1 终验本身的通过/失败 — P1 看的是**管道是否贯通**，不是业务结果。Initiative status=completed + result.verdict ∈ {PASS,FAIL} 即可。
- **e3 并发**：终验过程中若有其他 harness Initiative 同时在跑，B3 slot 比对必须容忍其他 Initiative 的 slot 占用（按 `initiative_id` 过滤后比对）。
- **e4 reaper 60min 触发窗口**：若某阶段确实运行超过 60min（generator agent 在跑），不能算 zombie。oracle 必须查 `last_heartbeat_at` 在最近 60min 内才判 zombie。
- **e5 evaluator 起新 thread**：如果 B10 fix 未生效，evaluator 会创建新 thread_id，oracle b 直接 FAIL。这是最关键的回归点。

---

## 范围限定

**在范围内**：
- 端到端跑一个最简 harness_initiative（PRD 内容随便，重点是 5 阶段贯通）
- 验证 7 条 oracle (a-g)，全 PASS 才算 P1 终验通过
- 产出终验报告（PASS/FAIL + 每条 oracle 实测值 + 任何 anomaly）

**不在范围内**：
- 不修任何代码（如果跑出新 hole，登记 B11 并 reject 终验，但不在本 sprint 内修）
- 不引入新端点 / 不改 schema
- 不验 P2/P3 范畴（如多 Initiative 并发、错误恢复语义、cortex 学习闭环等）
- 不做性能基准

---

## 假设

- [ASSUMPTION: Brain API localhost:5221 在执行 evaluator 阶段时可用 — 当前采集上下文时不可达，可能是 Brain 暂未启动；evaluator 阶段需先确认 Brain 运行]
- [ASSUMPTION: harness-planner / proposer / reviewer / generator / evaluator 5 个 agent skill 已部署且 cecelia-run.sh 可正常派发 — 本 sprint 自身能跑到这一步就是部分证据]
- [ASSUMPTION: 4 个相关端点 `/api/brain/tasks/{id}`、`/api/brain/dispatch/recent`、`/api/brain/fleet/slots`、`POST /api/brain/tasks` 已实现并返回上述 schema — B6 commit #2904 引入了 dispatch/recent；其他为既有端点]
- [ASSUMPTION: `dispatch_events` 表 schema 包含 `task_id`、`event_type`、`created_at` 列，event_type 枚举包含 `dispatched`]
- [ASSUMPTION: round 4 之前没有遗漏的 B11+ hole — 若 round 4 暴露新 hole，按 round 1/2/3 模式登记新 B 任务并启动 round 5]

---

## 预期受影响文件

> 本 sprint 是**验证型**，不改 Brain 代码。受"影响"的文件仅指本 sprint 自身产出的工件：

- `sprints/w32-walking-skeleton-p1-v4/sprint-prd.md`：本 PRD（已生成）
- `sprints/w32-walking-skeleton-p1-v4/sprint-contract.md`：Proposer 阶段产出
- `sprints/w32-walking-skeleton-p1-v4/evaluator-report.md`：Evaluator 阶段产出（7 oracle 实测 + verdict）
- `sprints/w32-walking-skeleton-p1-v4/p1-final-acceptance.md`：终验结论（PASS → 关闭 P1 / FAIL → 登记 B11）

**只读访问**（不修改）：
- `packages/brain/src/server.js` / `tick.js` / `dispatcher.js` / `reaper.js`：仅供 evaluator 在产生 anomaly 时定位
- `packages/brain/src/harness/*`：5 阶段 graph node 实现
- `dispatch_events` / `tasks` / `fleet_slots` 数据库表：oracle 数据源

---

## journey_type: autonomous
## journey_type_reason: 全部触发与可观测信号均在 Brain 内部（dispatcher / reaper / harness graph / dispatch_events 表），无 UI、无远端 agent 协议改动、无 dev pipeline hook 变化；B1-B10 全部 commit 都改 packages/brain/。
