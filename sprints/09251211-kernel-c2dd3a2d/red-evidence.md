# Red 阶段证据（冻结档 · TESTS_ALREADY_PRESENT 分支）

冻结档：合同产物（contract-draft.md / contract-dod.md / sprint-prd.md / tests/impact-contract.md）
已由 Runner 在 `chore(harness): import contract` 预提交并置只读，Generator 只读消费。
required_assertions 只有一条 —— G1「指挥舱」的既有回归护栏
`apps/dashboard/src/pages/map/MapPage.test.tsx`，作为本次 bugfix「不回归」的 ground truth。

## Bug 根因（sprint-prd.md 实证）

- fleet-worker `:5231 /health` 冷探测（git worktree + docker）单发 6.6s，命中 30s 缓存到期后
  的首发慢路径。
- Brain 侧 `packages/brain/src/fleet-resource-cache.js` 的采集客户端超时
  `WORKER_HEALTH_TIMEOUT_MS = 5_000`（5s）< 6.6s → `AbortSignal.timeout` 触发 → 该轮
  采集 catch 到 offline → `[fleet-cache] 刷新完成: 1/3 在线` 抖动。
- offline 的 fleetRow 经 `production-probes.js` → `getMachineHealth` 返回
  `signature=machine_offline`、`getMachineCapacity.available=0` → capability preflight
  一跳 `all_execution_targets_exhausted` → infrastructure backoff（run d6acfb0d 实证）。

## 修法（合同 option ②「先做便宜的」）

准入采集客户端超时 5s→15s，并对首发失败重试一次。不动 fleet-worker.cjs 服务端探测语义
（避免回归其 14 条既有 health 行为测试），只放宽 Brain 侧采集客户端的等待与重试。

## required assertion 基线执行（Red 记录）

命令：`npx vitest run apps/dashboard/src/pages/map/MapPage.test.tsx`

```
 ✓ src/pages/map/MapPage.test.tsx (4 tests) 107ms
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

该护栏与 Brain 侧改动模块树完全隔离（dashboard 测试 stub 了 fetch），修复后必须保持全绿。
Green 阶段将补 `packages/brain/src/__tests__/fleet-resource-cache.test.js` 全绿实跑证据，
证明采集客户端改动未回归既有 online/offline/effectiveSlots 语义。
