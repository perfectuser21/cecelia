# Learning: harness_task retired 但创建方未同步停止

**分支**: cp-0428132356-rca-fix-task-success-rate  
**日期**: 2026-04-28  
**Brain 任务**: 1538e81b-935e-432f-a1e2-32ac520d0115

### 根本原因

Sprint 1 PR 把 Harness 改成 LangGraph full graph，将 `harness_task` 在
`executor.js` 中标记为 RETIRED。但该 PR **没有同步修改创建方**：

1. `harness-dag.js:upsertTaskPlan()` 仍 INSERT `task_type='harness_task'`
2. `harness-initiative.graph.js:createFixTask()` 仍 INSERT `task_type='harness_task'`

结果：每个 harness_initiative 进入 Phase A 结束时批量创建子任务行，这些行
立即被 executor 标为 failed，导致 24h 内 20 个 failed，成功率降至 39%。

同时，测试 KR 污染（7 条 decomposing 状态的 test KR）导致 decomp-checker 持续
创建无意义的修复任务，占用队列槽位。

### 影响

- 24h 内：20 failed / 55 total = 39% 成功率
- 根因 1 占 100% failed（所有失败都是 harness_task retired）
- 积压 40+ queued 任务（34 content-pipeline + arch_review）阻塞队列调度

### 修复措施

1. `harness-dag.js:upsertTaskPlan()` 改用 `crypto.randomUUID()` 内存 UUID，不写 tasks 表
2. `harness-initiative.graph.js:createFixTask()` 加早返回 guard，返回 noop UUID
3. 7 条测试 KR archived，关联修复任务 canceled
4. 40 个过期积压任务批量 canceled

### 下次预防

- [ ] **退役 task_type 时，必须在同一 PR 内修改所有 INSERT 该 task_type 的调用方**
      验证命令：`grep -rn "task_type.*=.*'<retired_type>'\|'<retired_type>'.*task_type" packages/brain/src/ | grep -v "RETIRED\|retired\|test"`
- [ ] retire PR 的 DoD 必须含一条 `[BEHAVIOR]` 断言："调用方不再 INSERT 此 task_type"
      示例：`manual:node -e "const r=require('fs').readFileSync('packages/brain/src/harness-dag.js','utf8');if(r.includes(\"'harness_task'\"))process.exit(1);console.log('ok')"`
- [ ] 测试 KR 创建后必须立即在测试结束时清理（archive 或 psql DELETE），避免 decomposing 状态残留占用 decomp-checker
- [ ] 成功率监控：Brain tick 应每小时统计 `failed/(failed+completed)` 比率，超 30% 时触发 P0 SelfDrive 任务（已在 Brain 任务 `ee0b51c7` 中有类似 SelfDrive 任务，但没有自动触发机制）
