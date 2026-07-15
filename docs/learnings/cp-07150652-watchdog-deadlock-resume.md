# Watchdog 死局解除 Sprint 复盘

**Sprint**: 07150220-watchdog-deadlock-resume  
**Task ID**: d3343415-8ff6-427c-b867-8d36faa54448  
**PR**: https://github.com/perfectuser21/cecelia/pull/3940  
**Merged**: 2026-07-15T01:48:23Z  
**Verdict**: PASS

---

## 核心问题

Harness relay watchdog 在以下三种状态下陷入死局，PR 永远无法推进：
1. PR 分支落后于 base（BEHIND）
2. CI 红（FAILURE/ERROR）
3. PR 已合并的容器检测（OPEN 状态误判）

---

## 修复思路

### BEHIND → 重点火
`mapCiStatus` 逻辑新增分支：当 `mergeStateStatus === 'BEHIND'` 时，返回 `behind`，
watchdog 将触发 `reignite`（重点火）而非跳过。

### CI FAILURE → 重点火
CI 检查结论为 `FAILURE` 或 `ERROR` 时，watchdog 判定为 `ci_red`，触发重点火续跑。
通过 `harness-relay-watchdog.js` 的 `OPEN` 分支细化实现。

### CI pending → 跳过（wait_ci_running）
CI 仍在运行（`IN_PROGRESS`）时，watchdog 返回 `wait_ci_running`，本轮不点火，
等待下一个 tick 再评估，避免重复点火干扰。

### attempt cap 熔断优先
所有重点火逻辑均在 attempt cap 检查之后执行。cap 触发时无论 CI 状态如何，
立即熔断，不再重点火，防止无限循环。

---

## Evaluator Concerns（观察类，不阻塞）

1. **GP-4 日志顺序**：`resume_ci_red` 日志在 attempt cap 拦截之前打印，
   导致日志顺序与实际执行逻辑不完全对应。后续可将日志移至 cap 检查之后。

2. **execTolerant err.stdout fallback 未覆盖**：`execTolerant` 在命令失败时
   优先取 `err.stderr`，但 `err.stdout` fallback 路径缺少单元测试覆盖，
   边缘场景（stderr 为空但 stdout 有错误信息）可能静默丢失错误上下文。

---

## 测试策略

采用"先写 failing tests"（GP-1 ~ GP-4）再改代码的 TDD 路径：
- GP-1: BEHIND 状态触发重点火
- GP-2: CI FAILURE 触发重点火
- GP-3: CI pending 不点火（wait_ci_running）
- GP-4: attempt cap 优先于重点火熔断

既有 8 条 watchdog 测试全部保持绿色。

---

## 关键文件

- `packages/brain/src/harness-relay-watchdog.js` — 主逻辑修改
- `packages/brain/tests/harness-relay-watchdog.test.js` — GP-1~GP-4 测试
