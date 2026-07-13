# capture-triage line_backlog 路由真正建 task

## 背景 / 决策来源

决策 `57d296a1`：`capture-triage.js` 的 `routeAtom` 函数 line_backlog 分支（`packages/brain/src/capture-triage.js` 第88-97行）目前只是把 `capture_atom` 标记为 `status=confirmed` + `routed_to_table=journeys`，从未真正创建可执行的 Brain task。需要改成真正建 task，让 Brain 既有 dispatcher tick 自动拾取执行，闭合"决策→行动"这条环。

## 设计

### 1. 生产环境护栏

新增 `isProductionSensitive(atom)`：atom 的 `content` + `target_subtype` 命中关键词正则（`生产环境|生产|production|prod\s*env|LLM渠道切换`）时返回 `true`。命中 → 保留原有仅标记流程（`routed_to_table=journeys`），留人工排期，不自动建 task。

### 2. line_backlog 分支改造

在原有解析 `journeyId` 逻辑之后（`atom.routed_to_table==='tasks'` 时查源 task 的 `payload.journey_id`）：

- 若无 `journeyId` → 行为不变（留 `pending_review`，标 `no_journey`）
- 若命中生产护栏 → 保留原逻辑，`ai_reason` 追加护栏说明
- 否则 → 调用 `actions.js` 的 `createTask()`：
  - `task_type: 'harness_initiative'`
  - `payload: { orchestrator: 'skill-relay', executor: 'claude', mode: 'headed', journey_id: journeyId, thin_prd: atom.content }`
  - `trigger_source: 'cortex'`（复用 `learning.js` 已有的绕过 `goal_id` 必填校验写法，`isSystemTask` 已把 `cortex` 列入白名单）
  - `priority`: `atom.target_subtype === 'FAIL'` → `P1`，其余默认 `P2`
  - `title`: `[自动派工] ${atom.content 前80字}`
  - `description`: 含 `系统自动创建（来源: capture_atoms分诊, atom_id=...）` 溯源标记
  - createTask 成功 → atom 更新为 `status=confirmed`、`routed_to_table=tasks`、`routed_to_id=<新task id>`
  - createTask 未返回 task id（含 dedup 命中已有任务的情形，此时 `result.task.id` 仍存在）／抛异常 → 由外层 `runCaptureTriage` 的 try/catch 计入 `failed`，atom 留 `pending_review` 供下轮重试（不吞异常）

### 3. Brain dispatcher

已有 tick 逻辑自动拾取 `status=queued` 的 `harness_initiative` 任务，本次不改动派发逻辑本身。

## 测试策略

- **Unit（capture-triage.test.js）**：mock `actions.js` 的 `createTask`
  1. line_backlog + 有 journeyId + 非生产敏感 → 断言 `createTask` 被调用且参数含 `orchestrator:'skill-relay'`/`executor:'claude'`/`mode:'headed'`/`journey_id`；atom 更新为 `routed_to_table='tasks'`, `routed_to_id=<createTask 返回的 id>`
  2. 命中生产护栏（content 含"生产环境"）→ `createTask` 不被调用，atom 仍走 `routed_to_table='journeys'` 旧路径
  3. 无 journeyId → 行为不变（保留既有测试）
- **Regression**：保留并更新既有 `line_backlog：handoff FAIL → routed 改写为 journeys/journey_id` 测试为新行为（改写为 tasks）

## 不包含

- 不改 Brain dispatcher 派发逻辑本身（已验证可用）
- 不改 `urgent`/`invariant`/`okr` 三路
- 不实现"事后验货"机制（决策 57d296a1 已声明沿用 467ced6b 原有次日验货）
