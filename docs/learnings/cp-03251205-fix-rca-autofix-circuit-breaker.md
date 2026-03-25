# Learning: RCA→auto-fix 熔断机制修复

**Branch**: cp-03251205-fix-rca-autofix-circuit-breaker
**PR**: fix(brain): RCA→auto-fix 熔断机制修复 — stable signature + queued/in_progress guard

---

### 根本原因

`capability-probe.js` 在触发 auto-fix 时使用 `probe_${f.name}_${Date.now()}` 作为 signature。
每次探针失败都生成唯一 signature，导致 `dispatchToDevSkill` 里"同 signature 失败次数 >= 3"的熔断计数器永远无法达到阈值。
即每次探针失败都会创建新任务，形成无限循环，直到把 tasks 表塞满。
`dispatchToDevSkill` 的 Guard 只检查 `status=failed` 的历史任务，不检查正在进行中（queued/in_progress）的任务，导致即使上一轮修复还没完成也会重复派发。

### 修复方案

1. `capability-probe.js:343` — signature 改为 `probe_${f.name}`（去掉 `_${Date.now()}`）
2. `auto-fix.js:dispatchToDevSkill` — 新增 Guard1：先查同 signature 是否有 `queued/in_progress` 任务，有则直接跳过

### 下次预防

- [ ] 任何用作"去重 key"的 signature，禁止包含时间戳（Date.now()、new Date()、随机数）
- [ ] circuit breaker 模式：Guard 必须同时覆盖「历史失败次数」和「当前进行中」两个维度
- [ ] 新增 circuit breaker 逻辑时，单测必须覆盖 queued/in_progress 状态的去重场景
- [ ] auto-fix 任务创建前，log 明确说明"为何决定创建"或"为何决定跳过"，便于排查
