# 设计：harness 验证+交付环节 Brain 侧三修复（issue a638f840 / 45dd6925）

日期：2026-07-13　　任务：3bce156b　　类型：bug-fix（路径 A）

## 背景

issue a638f840 实测发现 harness-report Step 1 的 task.result 回写路径双重损坏；issue 45dd6925 发现断点恢复失效的帮凶之一是 sprint_dir 重派漂移。三处 Brain 侧根因（均已实证）：

1. `routes/tasks.js` PATCH /tasks/:task_id 的 setClauses **从不写 result 列**——即使 in_progress→completed 合法迁移，body.result 也被静默丢弃（仅转发给 promoteRegressionOnHarnessMerged 后即弃）。
2. 状态机 `'completed': []`——task 已 completed 后任何补写请求 409 INVALID_TRANSITION，报告回写路径永久堵死且无法事后补救。
3. `harness-skill-relay.js:183` 缺省生成的 sprint_dir（时间戳）不回写 payload——重派后生成新目录，产物路径漂移。

附带修：report TOTAL_COST fallback 需要按 task 查 relay runs，`GET /api/brain/orchestrator/relay-runs` 不支持 task_id 过滤。

## 修法

### 1. tasks.js PATCH handler（routes/tasks.js:357）

- **result 持久化**：body.result 存在（且为对象）时，setClauses 追加 `result = COALESCE(result,'{}'::jsonb) || $x::jsonb`（浅合并，写法对齐 harness-skill-relay.js:188 与 execution.js:1621 既有先例）。
- **幂等 no-op**：`status === currentStatus` 时跳过 transition 校验，也**不**追加 status_history、**不**发 task_status_changed 事件、**不**触发 promoteRegression / KR 重算（这些全在 `if (status)` 事件块内，no-op 时整块跳过），但仍应用 result 等字段更新。响应 200。
- **必填放宽**：status 与 result 至少一个（现在缺 status 直接 400）。全部现有调用点恒带 status，无影响。

非目标：不改 allowedTransitions 表本身（completed 仍不能迁去任何**不同**状态）；不修 promoteRegression 读顶层 pr_url 与 callback 把 pr_url 放 result 内部的既有错位（记录在案，另立）。

### 2. initiatives.js GET /relay-runs（:212）

新增 `?task_id=` 查询参数：uuid 格式校验（非法 → 400），`WHERE current_task_id = $`（列在 migration 238）。与既有 limit/phase/since 过滤可组合。

### 3. harness-skill-relay.js spawn 持久化 sprint_dir

两个 spawn 路径（:183 无头、:350 有头）在缺省生成 sprint_dir 后，回写 `payload.sprint_dir`（COALESCE || jsonb_build_object，fail-open try/catch warn，模式照抄 review_required :186-196）。payload 已有 sprint_dir 时不生成也不回写。

## 测试策略（unit 档）

跟 `routes/__tests__/tasks-canceled-transition.test.js` 的模式（vi.mock db.js + express + supertest）：

- tasks PATCH：a) completed task + body.result → 200 且 UPDATE 含 result COALESCE merge；b) completed→completed 不 409、不写 status_history、不发事件；c) in_progress→completed 带 result → result 进 setClauses；d) 只带 result 无 status → 200；e) 既无 status 也无 result → 400（守住原语义）。
- relay-runs：`__tests__/relay-runs.test.js` 族追加 task_id 过滤命中/组合/非法 uuid 400。
- harness-skill-relay：`__tests__/harness-skill-relay.test.js` deps 注入模式，断言缺省生成 sprint_dir 后触发 `UPDATE tasks ... sprint_dir` 的 SQL。

守卫形态：纯逻辑接缝 → CI regression test 即守卫（永久入库）。

## 影响面核查结论（Research subagent，2026-07-13）

全 repo 12 个 PATCH 调用点全部恒带 status 且把非 200 当 non-fatal；改动 1 是补齐被丢弃的写入，改动 2 把重复回调从 409 变 200 no-op，改动 3 对已带 sprint_dir 的任务无感。非破坏。
