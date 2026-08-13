# Contract DoD: Preview Brain scheduler-jobs 幂等保护

**Task ID**: 5c32aace-4114-426c-b9dd-765f1c4d5bb2

---

## 行为断言

[BEHAVIOR] B-1: `startSchedulerJobsLoop(pool)` 当 `process.env.BRAIN_PREVIEW === '1'` 时，返回 `null` 且 `setInterval` 不被调用

[BEHAVIOR] B-2: `startProjectionJobsLoop(pool)` 当 `process.env.BRAIN_PREVIEW === '1'` 时，返回 `null` 且 `setInterval` 不被调用

[BEHAVIOR] B-3: `BRAIN_PREVIEW` 未设置时 `startSchedulerJobsLoop` 正常返回 timer，前进 60000ms 后 `triggerArchReview` 被调用一次（现有行为零回归）

[BEHAVIOR] B-4: `BRAIN_PREVIEW=1` 时 `startSchedulerJobsLoop` 调用 `console.log` 且输出包含字符串 `"BRAIN_PREVIEW"`

## DoD 检查清单

- [x] `packages/brain/src/scheduler-jobs.js` 已加 BRAIN_PREVIEW 守卫
- [x] `packages/brain/src/__tests__/scheduler-jobs.test.js` 含 4 个新 [BEHAVIOR] 对应用例
- [x] `vitest run packages/brain/src/__tests__/scheduler-jobs.test.js` 全绿
- [x] 现有测试套件零回归（`vitest run packages/brain` 全通）

## 验收命令

manual:bash
```bash
cd /workspace && npm run test --workspace=packages/brain -- --run packages/brain/src/__tests__/scheduler-jobs.test.js 2>&1 | tail -20
```

## 判定点登记表

| 判定点 | 预期 | 实际（填写后） |
|---|---|---|
| B-1 null return + no setInterval | PASS | — |
| B-2 null return + no setInterval | PASS | — |
| B-3 非 preview 正常启动回归 | PASS | — |
| B-4 console.log 含 BRAIN_PREVIEW | PASS | — |
