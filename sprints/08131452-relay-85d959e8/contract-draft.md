# Contract Draft: Preview 主 Tick 隔离修复

**Task ID**: 85d959e8-569e-4a17-a98f-229c71e14e6d
**Gear**: hotfix（controller 内联组装，跳过 GAN）

---

## 背景

`packages/brain/src/tick-recovery.js` 的 `initTickLoop()` 与 `tryRecoverTickLoop()` 缺少 `BRAIN_PREVIEW=1` 守卫。Preview Brain 从克隆 DB（`tick_enabled=true`）读状态后启动主 Tick，造成并发双派发（P0 issue a9a6e3f6）。

## 实现约束

- 只改 `packages/brain/src/tick-recovery.js`，不改 `server.js` 调用侧
- 守卫判断：`process.env.BRAIN_PREVIEW === '1' || process.env.BRAIN_PREVIEW === 'true'`
- `initTickLoop`：守卫插在 `BRAIN_DEPLOY_CANARY` 检查之前（最早返回）
- `tryRecoverTickLoop`：守卫插在 `CECELIA_TICK_HARD_OFF` 检查之后

## 行为契约

| # | 行为 | 断言 |
|---|---|---|
| B-1 | `initTickLoop` BRAIN_PREVIEW=1 早返回 | 返回 `{success:true,enabled:false,loop_running:false,preview:true}`，不调用 `startTickLoop` |
| B-2 | `tryRecoverTickLoop` BRAIN_PREVIEW=1 跳过 | 清除 recoveryTimer 后 return，不调用 `startTickLoop` |
| B-3 | 两函数均打印 BRAIN_PREVIEW 日志 | `tickLog` 输出含 `"BRAIN_PREVIEW"` 字样 |
| B-4 | 非 Preview 零回归 | `BRAIN_PREVIEW` 未设置时，`initTickLoop` 在 DB `tick_enabled=true` 时正常调用 `startTickLoop` |

## E2E 验收

`vitest run packages/brain/src/__tests__/tick-recovery-preview.test.js` 全绿（4 个测试用例，分别覆盖 B-1 ~ B-4）。

## 未覆盖真实链路清单

N/A（单一守卫条件，单元测试可完整覆盖；Preview Brain 真实启动不在 CI 单测范围，通过代码审查和 BRAIN_PREVIEW 守卫一致性保证）
