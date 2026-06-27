# Learning: Slice5 — pipeline-patrol 三件接回 live tick

> 2026-06-27 · harness pipeline 9-slice 之 Slice 5 · PR cp-06272018-pipeline-patrol-loop

## 背景
20-agent 审计「调度层 Wave-2 漏接」根因 #2：`pipeline-patrol`（/dev 卡住会话救援）+
`harness-initiative-patrol`（harness Planner/GAN 卡住 → 建 harness_intervention 任务）只挂在
Wave-2 废弃的 `executeTick` 上。`executeTick → runScheduler` 迁移后从不调用 → 整个 harness
干预通道是死代码：patrol 不跑、即使跑了建出的 intervention 任务也无人执行、即使执行了也拿不到
容器 id 只能纯 alert。

## 根本原因（一条链三处断）
1. **调度断**：patrol 函数没有独立 loop，挂废弃 executeTick → 从不运行。
   （同根因已先后修过 harness-watchdog-loop / recovery-loop，这是第三条同款漏接。）
2. **执行断**：即使 patrol 建出 `harness_intervention` 任务，`executor.triggerCeceliaRun` 没有
   internal handler 短路 → 当普通 dev 任务派给 claude/codex（claude 不懂这个 task_type）。
3. **能力断**：即使 handler 跑了，`createInterventionTask` 的 payload 没带 `container_id` →
   `handleIntervention` 永远 `no_container_id`→纯 alert，读不到 docker logs 无法真诊断。

## 非显然点
- **三件缺一不达成设计意图**：单独接 loop 而不修 executor，intervention 任务建出来也空转；
  单独修 executor 而不补 container_id，handler 跑了也只能 alert。必须一起。
- **container_id 来源** = `walking_skeleton_thread_lookup`（spawnNode 写的 container_id↔thread_id，
  thread_id 格式 `harness-task:<initiativeId>:...`），取最近一条未终态容器；查不到 → null 降级仍建任务。
- **internal handler 的 deps.updateTaskResult 必须由 executor 提供**：executor 没有现成的
  updateTaskResult，用 `pool.query(UPDATE tasks SET result=...,status='completed')` 适配。

## 下次预防
- [ ] 新增任何"扫描+干预"周期函数 → 必须接独立 setInterval（仿 recovery-loop/harness-watchdog-loop/
      pipeline-patrol-loop），**禁止只挂 executeTick**（已是第三条同款漏接，executeTick 是死路）。
- [ ] 新增 internal task_type（INTERNAL_TASK_HANDLERS 注册）→ 必须确认 executor.triggerCeceliaRun
      的 getInternalTaskHandler 短路覆盖它，否则会被当普通任务误派。
- [ ] regression 守卫：pipeline-patrol-loop.test / tick-loop.test（接入断言）/ executor-route-override.test
      （短路断言）/ harness-initiative-patrol.test（container_id 断言）已全部留 CI。
