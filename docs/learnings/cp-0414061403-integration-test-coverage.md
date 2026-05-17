# Learning: 集成测试 vi.doMock 跨 describe 污染问题

## 分支
`cp-0414061403-ea8ea8d8-30f2-4ca9-ba3e-8eade1`

## 任务
KR 拆解: 完成集成测试覆盖 — 新增 self-drive-flow 和 quota-auth-guard 集成测试

### 根本原因

在同一测试文件中混合使用 `vi.doMock` 和真实模块导入时，`vi.doMock` 的注册在 describe 块之间持久存在。

具体场景：
- Quota Guard tests 在每个 `beforeEach` 中调用 `vi.doMock('../../account-usage.js', mockFactory)`
- Auth Circuit Breaker tests 在 `beforeEach` 中调用 `await import('../../account-usage.js')` 期望获得真实模块
- 但 `vi.doMock` 的注册未被清除，Auth 测试实际导入了被 mock 的版本
- `markAuthFailure` 是 `vi.fn()` 空函数，不会实际设置 `_authFailureMap`
- `isAuthFailed` 返回 false，测试失败

### 下次预防

- [ ] 在同一测试文件中使用 `vi.doMock` 后，如需在后续 describe 中导入真实模块，必须调用 `vi.doUnmock(modulePath)` + `vi.resetModules()` 清除污染
- [ ] 如果两个 describe 块需要完全不同的 mock 策略（一个 mock，一个真实），优先考虑分成两个文件
- [ ] `vi.clearAllMocks()` 只清除调用历史，不清除 `vi.doMock` 注册。两者是不同机制
- [ ] 模块状态机（内存 Map）测试：用 `vi.resetModules()` + `vi.doUnmock()` 确保每次获得真实模块实例

### 修复方案

```js
// Auth Circuit Breaker beforeEach 中：
beforeEach(async () => {
  vi.clearAllMocks();
  vi.doUnmock('../../account-usage.js'); // 清除 Quota Guard 的 doMock 污染
  vi.resetModules();                      // 清空模块缓存，获得新鲜实例
  const mod = await import('../../account-usage.js'); // 获得真实模块
  // ...
});
```
