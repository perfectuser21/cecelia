# Design: quarantine.js 的 rumination 归因调用接入 consciousness.enabled 门禁

## 背景

`packages/brain/src/quarantine.js` 在任务失败满 `FAILURE_THRESHOLD`（3）次触发隔离时，会内嵌调用 `callLLM('rumination', quarantinePrompt, { maxTokens: 150 })` 做失败归因分析（写入 `learnings` 表）。

`packages/brain/src/consciousness-guard.js`（2026-04-20 引入，PR #2447）是全仓统一的意识层开关 SSOT，`GUARDED_MODULES` 常量里已经明确把 `'rumination'` 列为应受门禁的模块，`isConsciousnessEnabled()` 是判断函数。但 `quarantine.js:268` 这次调用是 2026-02-27（PR #52，早于 consciousness-guard 系统整整两个月）引入的，PR #2447 引入门禁体系时未追溯审计这个较早的调用点，导致它从未接入检查。

2026-07-20 14:53 主理人拍板封存意识流（决策 `76194f29`，`consciousness.enabled=false`）后，`quarantine.js` 这条线依然持续触发，2026-07-21 因 arch_review 任务反复隔离叠加 Anthropic API 账户余额不足（fallback 到本机 `claude -p` CLI 子进程），造成本机资源风暴（负载峰值 80+、约 110 个子进程堆积）并消耗用户 Claude Code 订阅额度。

## 目标

`isConsciousnessEnabled()` 返回 `false` 时，`quarantine.js` 跳过这次 LLM 归因分析调用，不触发 `callLLM`；返回 `true` 时行为不变。隔离主流程（写 `quarantine_info`、`emit('task_quarantined', ...)`）不受影响。不改动 `routes/ops.js` 里 `callLLM('mouth', ...)` 的 inbox 群消息判断/印象更新逻辑（独立功能）。

## 方案

在 `quarantine.js` 顶部新增 `import { isConsciousnessEnabled } from './consciousness-guard.js';`，在第 268 行 `callLLM('rumination', ...)` 调用前包一层判断：

```js
if (!isConsciousnessEnabled()) {
  console.log(`[quarantine] consciousness disabled, skip LLM analysis for task ${taskId}`);
} else {
  // 原有的 callLLM('rumination', ...) + upsertLearning(...) 逻辑
}
```

这是本仓库已有的标准接入模式，`consciousness-loop.js:160/171` 就是同样写法，无需新造机制。

## 测试策略

单元测试，扩展 `packages/brain/src/__tests__/` 下 quarantine 相关测试文件（若已有 quarantine 测试文件则加进去，没有则新建 `quarantine-consciousness-gate.test.js`）：

1. mock `isConsciousnessEnabled` 返回 `false`，触发任务达到 `FAILURE_THRESHOLD` 走 `quarantineTask`，断言 `callLLM` **未被调用**、`upsertLearning` **未被调用**、但隔离本身（返回值 `success:true`、`emit` 事件）仍正常发生。
2. mock `isConsciousnessEnabled` 返回 `true`，同样触发流程，断言 `callLLM` **正常被调用一次**（对照组，防止改坏原有行为）。

纯逻辑接缝（读一个内存缓存的 flag 决定是否调用），CI regression test 即为充分的 proven-to-fire 守卫，不需要运行时自检。

## 范围边界

- 不动 `rumination.js` / `rumination-scheduler.js`（它们的调度入口本来就受 `isConsciousnessEnabled()` 保护，这次不涉及）
- 不动 `routes/ops.js` 的 `mouth`/inbox 逻辑
- 不处理 dispatcher 隔离阈值本身是否失效（`failure_count` 超过 3 仍未被隔离的疑点）——这是本次调研中发现的另一个独立可疑点，超出本次修复范围，留给后续单独排查
- 不处理 Anthropic API 账户余额问题——账单事项，用户自行处理
