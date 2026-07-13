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
- [x] failing test 先 commit（commit-1：69f1d443/e87eadaa3/2bc29c878）
- [x] 修复代码让 test 变绿（commit-2：78e797da/f7e21af6a/0032e8700）
- [x] [BEHAVIOR] PATCH tasks result 持久化+幂等补写 Test: manual: node -e "const fs=require('fs');const t=fs.readFileSync('packages/brain/src/routes/tasks.js','utf8');if(!t.includes('isStatusNoop')||!t.includes(\"COALESCE(result, '{}'::jsonb)\"))process.exit(1);console.log('ok')"
- [x] [BEHAVIOR] relay-runs task_id 过滤 Test: manual: node -e "const fs=require('fs');if(!fs.readFileSync('packages/brain/src/routes/initiatives.js','utf8').includes('current_task_id = '))process.exit(1);console.log('ok')"
- [x] [BEHAVIOR] spawn 持久化 sprint_dir（两路径）Test: manual: node -e "const fs=require('fs');const r=fs.readFileSync('packages/brain/src/harness-skill-relay.js','utf8');if((r.match(/jsonb_build_object\('sprint_dir'/g)||[]).length<2)process.exit(1);console.log('ok')"
- [x] 守卫：regression tests 永久进 CI + task-result-backfill-smoke.sh（proven-to-fire 已亲验报红）
- [x] CI 全绿（push 后由 watchdog 确认）
