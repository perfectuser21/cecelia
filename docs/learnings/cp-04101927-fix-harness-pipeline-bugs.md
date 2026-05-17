# Learning — harness pipeline 编排 7个Bug修复

**分支**: cp-04101927-fix-harness-pipeline-bugs  
**日期**: 2026-04-10

---

### 根本原因

harness pipeline 的 execution.js 编排逻辑存在多个设计缺陷，全部源于初始实现时没有考虑多 Workstream 场景，以及 BRAIN_QUIET_MODE 对 server.js 独立定时器无效：

1. **Report 过早触发**：harness_report 在任意 WS 完成时创建，而不是等最后一个 WS
2. **goal_id null 导致串行链断裂**：`execution_callback_harness_serial` 不在 actions.js 系统触发源白名单，且 harness 任务 goal_id 为 null
3. **contract_branch null 无 guard**：Reviewer 输出解析失败时静默创建必失败的 Generator
4. **串行链无幂等保护**：callback 重复触发会创建重复 WS 任务
5. **report payload 缺 project_id**：Report skill 无法关联项目
6. **harness_report 用 Sonnet**：report 只是汇总文件，Haiku 够用
7. **BRAIN_QUIET_MODE 不覆盖 server.js 独立定时器**：`startSelfDriveLoop()` 和 `triggerDeptHeartbeats()` 都在 server.js/tick.js 里无条件启动，即使设置了 BRAIN_QUIET_MODE=true 也不受影响

---

### 修复方法

- **Report 触发时机**：把 `createHarnessTask(harness_report)` 移到 `if (currentWsIdx === totalWsCount)` 块内
- **goal_id 问题**：把串行 WS 链的 `trigger_source` 改为 `execution_callback_harness`（已在白名单），不传 `goal_id`
- **contract_branch guard**：APPROVED 后立即检查 `!contractBranch`，null 则 P0 日志 + return
- **幂等保护**：创建 WS{N+1} 前查 DB 检查是否已有同 project_id + workstream_index 的任务
- **project_id 补全**：harness_report payload 加 `project_id: harnessTask.project_id`
- **Haiku 改配置**：model-profile.js 一行改
- **BRAIN_QUIET_MODE guards**：server.js 用 `if (process.env.BRAIN_QUIET_MODE !== 'true')` 包住 `startSelfDriveLoop`；tick.js 用 `if (!BRAIN_QUIET_MODE)` 包住 `triggerDeptHeartbeats`

---

### 下次预防

- [ ] **多 WS pipeline 设计时**：Report 触发逻辑必须检查 currentWsIdx === totalWsCount，不能在任意 WS 完成时触发
- [ ] **新增 trigger_source**：如果新建的 trigger_source 需要绕过 goal_id 校验，必须加到 `actions.js` 的 `systemSources` 白名单
- [ ] **BRAIN_QUIET_MODE 新定时器**：server.js 里任何新的定时器/循环启动，都要用 `if (process.env.BRAIN_QUIET_MODE !== 'true')` 包住
- [ ] **harness 编排测试**：`src/__tests__/harness-pipeline.test.ts` 覆盖了这些路径，后续改 execution.js 时必须跑这个测试
