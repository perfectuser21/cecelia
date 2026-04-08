# Sprint Contract (APPROVED)

**reviewer_task_id**: fe44c8ca-1506-4bad-b40d-a34de183e167  
**propose_task_id**: 2932ea31-ffb4-4738-8c53-e81d7f137d93  
**propose_round**: 2  
**verdict**: APPROVED  
**日期**: 2026-04-08

> 本合同由 Evaluator 审查通过，所有 Feature 均满足：行为描述清晰可验证、硬阈值完全量化、正常路径与边界情况覆盖完整、Evaluator 可独立验证。

---

## Feature 1: CI watch 超时不中断链路

**行为描述**:  
当 `harness_ci_watch` 任务的轮询次数达到上限（超时）时，该任务的最终状态为 `completed`（而非 `failed`），并且系统会自动创建一个新的 `harness_evaluate` 任务，使链路得以继续向下流转。

**硬阈值**:
- `harness_ci_watch` 任务在超时后的 `status` 字段值为 `completed`（不得为 `failed`）
- 超时后系统中存在一条新建的 `harness_evaluate` 任务，其 `payload.ci_timeout` 为 `true`
- 超时后新建的 `harness_evaluate` 任务的 `payload` 必须包含以下全部四个字段：
  `ci_timeout: true`、`sprint_dir`、`planner_task_id`、`planner_branch`
  （缺少任意一个字段均视为合同违约）

---

## Feature 2: GitHub API 30s 节流

**行为描述**:  
`harness-watcher` 模块对每个 `harness_ci_watch` 任务实施独立的 30 秒节流窗口：在同一任务的两次 GitHub API 调用之间，间隔不足 30 秒的 tick 被静默跳过，不触发任何 API 请求。

**硬阈值**:
- `harness-watcher.js` 模块顶层存在 `POLL_INTERVAL_MS` 常量，值为 `30000`
- `harness-watcher.js` 模块顶层存在 `lastPollTime` Map 实例（模块级，非函数内局部变量）
- 节流判断逻辑使用 `task.id` 作为 Map 的 key，条件为 `Date.now() - (lastPollTime.get(task.id) || 0) < POLL_INTERVAL_MS` 时跳过本次 tick
- `harness-watcher.js` 中在决定发起 GitHub API 调用时，必须存在 `lastPollTime.set(task.id, Date.now())` 调用，用于更新节流时间戳（位置：skip 判断通过后，可在 API 调用前或调用后，但必须存在该 set 调用）

---

## Feature 3: TASK_REQUIREMENTS 补全所有 harness_* 类型

**行为描述**:  
`task-router.js` 的 `TASK_REQUIREMENTS` 对象覆盖所有 `harness_*` task_type，使得调用 `getTaskRequirements` 时，任意 harness 类型均返回明确的 capability 列表，不回退到默认值 `['has_git']`（实际值也是 `['has_git']`，但必须显式声明）。

**硬阈值**:
- `task-router.js` 的 `TASK_REQUIREMENTS` 对象中包含以下 9 个 key，每个 key 的值均为 `['has_git']`：
  - `harness_planner`
  - `harness_contract_propose`
  - `harness_contract_review`
  - `harness_generate`
  - `harness_ci_watch`
  - `harness_evaluate`
  - `harness_fix`
  - `harness_deploy_watch`
  - `harness_report`
- 调用 `getTaskRequirements('harness_planner')` 的返回值等于 `['has_git']`（不经过默认分支）

---

## Feature 4: execution-callback 检查父任务是否已取消

**行为描述**:  
当 harness 子任务回调时，系统先查询其关联的 `planner_task_id` 任务状态；若该 planner 任务已处于 `cancelled` 状态，则跳过派生任何新子任务，并输出一条包含 "skipping chain" 字样的日志，链路在此静默终止。

**硬阈值**:
- 当 `harnessPayload.planner_task_id` 对应的任务 `status = 'cancelled'` 时，execution-callback 的 harness 处理块不创建任何新的子任务
- 跳过时控制台输出包含字符串 `"skipping chain"` 的日志（不含引号）
- 该检查仅在 `planner_task_id` 存在时触发，`planner_task_id` 为空时不影响正常流程
- 当 `planner_task_id` 非空但 DB 查询返回空结果（该任务不存在）时，视为 planner 正常，继续派生子任务，不跳过链路（等效于 `plannerRow.rows[0]?.status === 'cancelled'` 为 false）
- 不影响已处于 `in_progress` 的子任务（不取消它们）

---

## Feature 5: harness SKILL.md 去掉 localhost:5221 依赖

**行为描述**:  
以下 5 个 harness SKILL.md 文件的 Step 1 不包含对 `localhost:5221` 的 curl 调用；最后步骤不包含 `curl -X PATCH localhost:5221`。agent 通过 prompt 中直接注入的字段获取 `task_id`、`sprint_dir` 等上下文，完成后输出结构化 JSON 作为 last message。

受影响文件：
- `packages/workflows/skills/harness-planner/SKILL.md`
- `packages/workflows/skills/harness-contract-proposer/SKILL.md`
- `packages/workflows/skills/harness-contract-reviewer/SKILL.md`
- `packages/workflows/skills/harness-generator/SKILL.md`
- `packages/workflows/skills/harness-report/SKILL.md`

**硬阈值**:
- 上述 5 个文件的 Step 1 不含字符串 `curl localhost:5221/api/brain/tasks`（用于读取 payload 的 curl 调用）
- 上述 5 个文件的最后步骤不含字符串 `curl -X PATCH localhost:5221`
- 每个文件保留结构化 last message 输出格式（以 `{"verdict": ...}` 形式结尾）
- harness-evaluator/SKILL.md 不在修改范围内（已正确处理）

---

## 合同约束说明

1. **GAN 对抗轮次无上限**：禁止在任何文件中引入 `MAX_GAN_ROUNDS` 常量或等效限制。
2. **不修改 Evaluator 判断逻辑**：harness-evaluator 的 PASS/FAIL 判断不在本 Sprint 范围内。
3. **不修改 deploy_watch 节流**：Feature 2 节流逻辑仅适用于 `harness_ci_watch`。
4. **不取消已有子任务**：Feature 4 仅阻止新建，不取消 `in_progress` 的子任务。
