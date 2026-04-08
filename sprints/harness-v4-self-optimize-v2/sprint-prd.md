# Sprint PRD — Harness v4.0 自身流程优化

**sprint_dir**: sprints/harness-v4-self-optimize-v2  
**planner_task_id**: 6bff876a-e58d-4e4f-a8ce-632634e738f8  
**日期**: 2026-04-07

---

## 背景

Harness v4.0 在实际运行中发现 5 个流程问题，导致链路中断或资源浪费。本 Sprint 修复这些问题，使 Harness 自身更健壮。

---

## 目标

修复 Harness v4.0 流程中的 5 个已知缺陷，确保 CI 超时链路不中断、GitHub API 不被滥调、任务路由正确、已取消任务不继续派生子任务、agent 不依赖 localhost:5221 读写。

---

## 功能列表

### Feature 1: CI watch 超时不中断链路

**用户行为**: CI 持续运行超过最大轮询次数（120 次 × 5s ≈ 10 分钟）  
**系统响应**: harness-watcher 将 `harness_ci_watch` 标记为 completed，并创建 `harness_evaluate` 任务（payload 含 `ci_timeout: true`），由 Evaluator 处理超时情况  
**不包含**: 不更改 MAX_CI_WATCH_POLLS 阈值，不修改 Evaluator 逻辑

**文件**: `packages/brain/src/harness-watcher.js`  
**当前行为**: 超时后 `status=failed`，链路终止  
**目标行为**: 超时后 `status=completed`，创建 `harness_evaluate(ci_timeout:true)`

---

### Feature 2: GitHub API 30s 节流

**用户行为**: Brain tick 每 5s 触发一次，可能同时有多个 `harness_ci_watch` 任务  
**系统响应**: 每个任务每 30 秒最多调用一次 GitHub API（通过模块级 `lastPollTime` Map 实现）；未到节流窗口的任务跳过本次 tick  
**不包含**: 不更改 deploy_watch 的轮询逻辑

**文件**: `packages/brain/src/harness-watcher.js`  
**新增**: `const POLL_INTERVAL_MS = 30000` + `const lastPollTime = new Map()`  
**节流逻辑**: `if (Date.now() - (lastPollTime.get(task.id) || 0) < POLL_INTERVAL_MS) { continue; }`

---

### Feature 3: TASK_REQUIREMENTS 补全所有 harness_* 类型

**用户行为**: Brain 调用 `getTaskRequirements('harness_planner')` 等 harness 类型  
**系统响应**: 返回正确的 capability 要求，不回退到默认值 `['has_git']`  
**不包含**: 不更改 LOCATION_MAP（已有正确映射）

**文件**: `packages/brain/src/task-router.js`  
**需新增的条目**（位于 TASK_REQUIREMENTS 对象）：
```
'harness_planner':          ['has_git'],
'harness_contract_propose': ['has_git'],
'harness_contract_review':  ['has_git'],
'harness_generate':         ['has_git'],
'harness_ci_watch':         ['has_git'],
'harness_evaluate':         ['has_git'],
'harness_fix':              ['has_git'],
'harness_deploy_watch':     ['has_git'],
'harness_report':           ['has_git'],
```

---

### Feature 4: execution-callback 检查父任务是否已取消

**用户行为**: 用户取消了 `harness_planner` 根任务  
**系统响应**: 当某个 harness 子任务回调时，先查询 `planner_task_id` 的状态；若已 cancelled，则跳过派生任何新子任务并打日志  
**不包含**: 不取消现有的 in_progress 子任务，不影响非 harness 任务

**文件**: `packages/brain/src/routes/execution.js`  
**插入位置**: harness 链路处理块开始处（约 line 1582，`harnessRow` 查询之后）  
**逻辑**:
```javascript
const plannerTaskId = harnessPayload.planner_task_id;
if (plannerTaskId) {
  const plannerRow = await pool.query(
    'SELECT status FROM tasks WHERE id = $1', [plannerTaskId]
  );
  if (plannerRow.rows[0]?.status === 'cancelled') {
    console.log(`[execution-callback] harness: planner ${plannerTaskId} is cancelled, skipping chain`);
    return; // 或 continue，取决于控制流
  }
}
```

---

### Feature 5: harness SKILL.md 去掉 localhost:5221 依赖

**用户行为**: agent 执行 harness skill，例如 harness-planner、harness-contract-proposer、harness-contract-reviewer、harness-generator、harness-report  
**系统响应**: agent 从 prompt 中读取 `task_id`、`sprint_dir` 等上下文，不调用 `curl localhost:5221/api/brain/tasks/{TASK_ID}`；完成后输出结构化 JSON 作为 last message（Brain executor 捕获），不再直接 PATCH localhost:5221  
**不包含**: 不修改 harness-evaluator（其已有正确的禁用 localhost 说明）；不修改 Brain executor 的捕获逻辑

**受影响文件**:
- `packages/workflows/skills/harness-planner/SKILL.md`
- `packages/workflows/skills/harness-contract-proposer/SKILL.md`
- `packages/workflows/skills/harness-contract-reviewer/SKILL.md`
- `packages/workflows/skills/harness-generator/SKILL.md`
- `packages/workflows/skills/harness-report/SKILL.md`

**改法**:
- Step 1（读取 payload）→ 改为："从 prompt 中直接读取 `task_id` 和 `sprint_dir`，无需 curl"
- 最后 PATCH 步骤 → 删除；保留结构化 last message 格式（`{"verdict": "...", ...}`）

---

## 成功标准

- CI watch 超时后，`harness_evaluate` 任务被创建，`harness_ci_watch` 状态为 `completed`（非 `failed`）
- `harness-watcher.js` 导出模块中存在 `POLL_INTERVAL_MS = 30000` 常量和 `lastPollTime` Map
- `getTaskRequirements('harness_planner')` 返回 `['has_git']`（非默认值）
- 当 `planner_task_id` 状态为 `cancelled` 时，execution-callback harness 链路不创建任何新子任务
- 所有 5 个 harness SKILL.md 的 Step 1 不含 `curl localhost:5221/api/brain/tasks` 命令；最后步骤不含 `curl -X PATCH localhost:5221`

---

## 范围限定

**在范围内**:
- `harness-watcher.js` 超时和节流
- `task-router.js` TASK_REQUIREMENTS harness_* 条目
- `execution.js` 父任务取消检查
- 5 个 harness SKILL.md 文件（不含 harness-evaluator）

**不在范围内**:
- GAN 对抗轮次限制（刻意无上限，禁止加 MAX_GAN_ROUNDS）
- harness-evaluator SKILL.md（已正确处理 localhost 禁用）
- Evaluator 的 PASS/FAIL 判断逻辑
- deploy_watch 节流
