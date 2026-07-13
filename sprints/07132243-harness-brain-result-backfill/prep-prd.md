# Bug PrepPRD：harness 验证+交付环节 Brain 侧三修复（issue a638f840 / 45dd6925）

## 症状
1. harness-report Step 1 回写 task.result：task 已是 completed 时被状态机 409 拒绝（INVALID_TRANSITION: completed→completed, allowed:[]），补写路径永久堵死；且即使 in_progress→completed 成功，PATCH 端点也**从不写 result 列**（setClauses 无 result），result 静默丢弃。
2. harness-report TOTAL_COST fallback 调 `/api/brain/relay-runs?task_id=...` 不存在（真实路由 `/api/brain/orchestrator/relay-runs`，且 GET 列表不支持 task_id 过滤）。
3. harness-skill-relay spawn 时缺省生成的 sprint_dir（时间戳）不回写 payload，重派后换新目录，断点恢复的产物路径漂移。

## 根因假设（已实证，非假设）
- packages/brain/src/routes/tasks.js:400 allowedTransitions `'completed': []`；:427 起 setClauses 只有 status/status_history/claimed_by，无 result。
- packages/brain/src/routes/initiatives.js:212 GET /relay-runs 只支持 limit/phase/since。
- packages/brain/src/harness-skill-relay.js:183 `task.payload?.sprint_dir || 生成`，生成值不持久化（对比 review_required 有持久化）。

## 修法
1. tasks.js PATCH /tasks/:task_id：
   - body.result 存在时 setClauses 增加 `result = COALESCE(result,'{}'::jsonb) || $x::jsonb`（merge 语义，对齐 execution.js/handoff.js 既有写法）
   - status === currentStatus 时视为幂等 no-op：跳过 transition 校验、不追加 status_history、不重发 task_status_changed 事件，但仍应用 result 更新（completed→completed 补写场景）
   - 放宽 400：status 与 result 至少给一个（只带 result 的纯补写合法）
2. initiatives.js GET /relay-runs：新增 ?task_id= 过滤（uuid 校验，WHERE current_task_id = $）
3. harness-skill-relay.js：两个 spawn 路径生成 sprint_dir 后回写 payload（COALESCE merge，模式抄 review_required）

## Regression Test 计划
- routes/__tests__/tasks 相关 test 文件：a) completed task PATCH result → 200 且 result 落库 b) completed→completed 幂等不 409、不重发事件 c) in_progress→completed 带 result → result 落库 d) 纯 result 无 status → 200
- initiatives 测试：GET /relay-runs?task_id= 过滤命中/不命中/非法 uuid 400
- harness-skill-relay 测试：payload 无 sprint_dir 时 spawn 后 payload.sprint_dir 已持久化

## 验收标准
- [ ] failing test 先 commit（commit-1）
- [ ] 修复代码让 test 变绿（commit-2）
- [ ] 守卫：以上 regression tests 永久进 CI（逻辑接缝，CI test 即守卫形态）
- [ ] CI 全绿
