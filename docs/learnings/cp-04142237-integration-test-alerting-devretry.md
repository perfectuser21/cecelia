# Learning: Brain 集成测试覆盖 — alerting-flush + dev-retry-flow

**分支**: cp-0414072955-ea8ea8d8-30f2-4ca9-ba3e-8eade1
**日期**: 2026-04-14

---

### 根本原因

`alerting.js`（P0/P1/P2 分级告警系统）和 `dev-failure-classifier.js`（dev 任务失败重试决策）
缺少集成测试覆盖。单元测试已存在，但未验证跨模块行为（alerting + notifier flush 时序、
dev-failure 分类结果 → DB 写入字段的结构一致性）。

### 覆盖的盲区

1. **alerting.js** — P0 5 分钟限流窗口、P1/P2 缓冲区 flush 时机、flushAlertsIfNeeded 时间门控
2. **dev-failure-classifier.js** — 5 类失败分类链路（transient/code_error/auth/resource/unknown）、
   max retries 边界、calcNextRunAt 退避梯度、重试 payload 字段完整性

### alerting 测试的模块级状态重置技巧

`alerting.js` 使用模块级变量（Map、数组、计数器），单测文件内无法清除。
必须在 `beforeEach` 中用 `vi.resetModules()` + 重新 `import` 来获取全新状态：

```js
beforeEach(async () => {
  vi.resetModules();
  const mod = await import('../../alerting.js');
  raise = mod.raise; // 每次都是全新模块实例
});
```

### dev-failure-classifier 是纯函数，测试最简单

该模块没有任何副作用，所有函数都是纯函数，无需 mock DB。
集成测试意义在于验证模式优先级（auth > resource > transient > code_error）
和 payload 结构与 `execution.js` 写入 DB 时的字段期望匹配。

### auth 模式匹配注意点

AUTH_PATTERNS 要求 `authentication failed` 或 `auth error`（含空格）。
`authentication_error`（下划线）、`Failed to authenticate`（词序不同）都**不匹配**。
测试用例必须使用与模式完全一致的错误文本。

### 下次预防

- [ ] 新增 Brain 告警相关模块时，同步验证模块级状态能否被测试框架重置
- [ ] dev-failure-classifier 等纯函数模块每次新增模式后，在集成测试里添加对应的典型错误文本
- [ ] auth 熔断路径（markAuthFailure + raise P0）的集成测试还可进一步加强
