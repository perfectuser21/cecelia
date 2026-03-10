---
id: learning-isolate-false-batch34
version: 1.0.0
created: 2026-03-10
updated: 2026-03-10
changelog:
  - 1.0.0: 初始版本
---

# Learning: isolate:false Batch 3/4 — vi.resetModules 修复 + vi.isolateModules 陷阱

## 背景

PR #753 目标：将 `vitest.config.js` 从 `isolate: true` 改为 `isolate: false`，解决 Mac mini OOM（4.5GB → 596MB）。Batch 3/4 修复了剩余 32 个测试文件的环境污染问题。

## 核心陷阱：vi.isolateModules 不存在于 vitest 1.x

### 问题

在修复过程中，错误地使用了 `vi.isolateModules()`：

```js
// ❌ BROKEN - vi.isolateModules 在 vitest 1.6.1 中不存在
beforeAll(async () => {
  await vi.isolateModules(async () => {
    pool = (await import('../db.js')).default;
  });
});
```

该函数是 **vitest v3+** 才引入的（类似 Jest 的 `jest.isolateModules`）。在 vitest 1.6.1 中调用会报：`TypeError: vi.isolateModules is not a function`。

### 正确方案（vi.resetModules）

```js
// ✅ CORRECT - 适用于 vitest 1.x
beforeAll(async () => {
  vi.resetModules();
  pool = (await import('../db.js')).default;
  someFunc = (await import('../executor.js')).someFunc;
});
```

**为什么有效**：
- `vi.resetModules()` 清除模块缓存，确保获取真实（非被其他文件缓存的）模块实例
- `vi.mock()` 注册**不被** `vi.resetModules()` 清除，mock 文件仍然获得 mock 模块

## 两类测试文件的处理策略

### 真实 DB 文件（需要真实 pool）

```js
let pool, someFunc;
beforeAll(async () => {
  vi.resetModules();
  pool = (await import('../db.js')).default;
  someFunc = (await import('../other.js')).someFunc;
});
```

### Mock 文件（需要 mock pool）

```js
// 1. 用 vi.hoisted 稳定 mock 引用（survive resetModules）
const mockQuery = vi.hoisted(() => vi.fn());

// 2. 顶层 vi.mock()（persist across resetModules）
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));

// 3. beforeAll 中 resetModules + 动态导入
let pool, targetFunc;
beforeAll(async () => {
  vi.resetModules();
  pool = (await import('../db.js')).default; // 获得 mock pool
  targetFunc = (await import('../target.js')).targetFunc;
});
```

## 级联污染问题

真实 DB 文件调用 `vi.resetModules()` 会清空全局模块缓存，导致后续 mock 文件的缓存 mock 引用失效。

**受影响的 4 个 mock 文件**（需要加 vi.resetModules 到 beforeAll）：
- `capabilities-api.test.js`
- `callback-dev-serial.test.js`
- `cecelia-proactive-push.test.js`
- `chaos-hardening.test.js`

## smoke.test.js 特殊处理

`child_process` 被 `heartbeat.test.js` 的 `vi.mock('child_process')` 污染。必须：

```js
beforeAll(async () => {
  vi.unmock('child_process'); // 先取消 mock 注册
  vi.resetModules();
  const { spawn } = await import('child_process'); // 再动态导入
  // ...
});
```

## 版本警告

| API | vitest 1.x | vitest 3.x |
|-----|-----------|-----------|
| `vi.resetModules()` | ✅ 存在 | ✅ 存在 |
| `vi.isolateModules()` | ❌ 不存在 | ✅ 存在 |

**确认版本后再用 API**：`cat packages/brain/package.json | grep vitest`

## 下次预防

1. 使用新 vitest API 前，先 `grep "vitest" package.json` 确认版本
2. isolate:false 修复的标准模式只用 `vi.resetModules()` + 动态导入
3. 不要尝试 `vi.isolateModules`，除非已升级到 vitest v3+
