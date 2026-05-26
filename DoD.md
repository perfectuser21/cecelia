contract_branch: cp-harness-propose-r3-a11b8abb
workstream_index: 2
sprint_dir: sprints/harness-self-heal

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 2: harness-container-monitor.js + tick-runner.js 注册

**范围**: 新建 `packages/brain/src/harness-container-monitor.js`（容器健康检查 + dispatch + 幂等 + Bark + cecelia_events）；`tick-runner.js` 注册 30s 节拍（MINIMAL_MODE 守护）
**大小**: M（~170 行净增，2 文件）
**依赖**: Workstream 1

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/src/harness-container-monitor.js` 存在，导出 `checkHarnessContainers` 和 `createInterventionTask`
- [ ] [ARTIFACT] `checkHarnessContainers` 函数签名接受 `opts: { pool, dockerUnavailable?: boolean }` 参数对象
- [ ] [ARTIFACT] `packages/brain/src/tick-runner.js` 包含 `harness-container-monitor` import 调用

## BEHAVIOR 条目

- [ ] [BEHAVIOR] checkHarnessContainers 函数可调用且不抛异常（docker 不可用时 warn 不 throw）
- [ ] [BEHAVIOR] createInterventionTask 向 DB tasks 表写入 harness_intervention 记录（带时间窗口防造假）
- [ ] [BEHAVIOR] 幂等保护：同 initiative 重复调用 createInterventionTask 返回 skipped:true
- [ ] [BEHAVIOR] monitor 在 harness-container-monitor.js 中集成 cecelia_events 写入（intervention_result）
- [ ] [BEHAVIOR] tick-runner.js MINIMAL_MODE 守护 + 30s 间隔配置
- [ ] [BEHAVIOR] Bark→飞书→cecelia_events 三级降级告警链
- [ ] [BEHAVIOR] error path — Bark + 飞书均失败/未配置时降级写 cecelia_events
