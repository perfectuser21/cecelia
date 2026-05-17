# Learning: harness task types missing from pre-flight whitelist

## 根本原因

`pre-flight-check.js` 的 `SYSTEM_TASK_TYPES` 白名单在加入 sprint_* 系列时遗漏了对应的 harness_* 系列。两套类型共存但只同步了一套，导致 harness_* 任务因 description=null 被 pre-flight 永久拒绝。

## 下次预防

- [ ] 新增任务类型时，检查 `pre-flight-check.js` 的 `SYSTEM_TASK_TYPES`、`executor.js` 的跳过列表、`nightly-orchestrator.js` 的过滤列表是否同步
- [ ] 成对出现的类型族（sprint_* / harness_*）加入时应作为一个原子操作，避免只加一套

