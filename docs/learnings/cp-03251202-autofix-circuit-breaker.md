# Learning: P0 修复 — RCA→auto-fix 熔断机制失效

**Branch**: cp-03251202-autofix-circuit-breaker
**Date**: 2026-03-25

## 做了什么

修复 `capability-probe.js` 和 `auto-fix.js` 中的 RCA→auto-fix 死循环：

1. `capability-probe.js:343` — signature 从 `probe_${f.name}_${Date.now()}` 改为 `probe_${f.name}`（稳定格式）
2. `auto-fix.js:dispatchToDevSkill` — 新增 Guard 1，查 `queued/in_progress` 活跃任务，有则跳过创建
3. 导出 `MAX_AUTO_FIX_ATTEMPTS` 供测试使用
4. 新增 `auto-fix-circuit-breaker.test.js`，7 个用例覆盖两层熔断逻辑

### 根本原因

前一轮修复（cp-03242032-p0p1-arch-fixes）给 `dispatchToDevSkill` 加了失败次数上限（MAX_AUTO_FIX_ATTEMPTS=3）守卫，但 `capability-probe.js` 每次生成 signature 时拼入了 `Date.now()`，使每次 signature 完全不同。

守卫查询条件是"同 signature 的历史失败任务数"，由于每次 signature 不同，查询永远返回 0，失败次数上限永远不会触发，死循环无法被熔断。

另外原守卫只查 `status='failed'` 的任务，未查 `queued/in_progress` 状态，导致正在修复中仍可无限创建新任务。两个漏洞叠加，使整个熔断机制形同虚设。

### 下次预防

- [ ] 任何用于去重/熔断的 signature/hash 值必须在相同触发条件下保持稳定（不能含 `Date.now()`、随机数等动态部分）
- [ ] 活跃任务去重（queued/in_progress）和失败上限（failed count）应同时检查，不能只查其中一个状态
- [ ] 新增自动创建任务路径时，必须逐条验证守卫逻辑的实际可达性（用真实 signature 测试守卫是否生效）
