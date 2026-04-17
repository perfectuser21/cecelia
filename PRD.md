# PRD: C4 Pre-flight Cancel Alerting

Task ID: `61fd2d0d-7b4d-4c21-92b9-344b62dede74`
Branch: `cp-04172342-c4-preflight-alert`

## 背景

今天发现 27 个 autonomous dev 任务被 pre-flight 静默 cancel 一周没人看。根因：
`packages/brain/src/tick.js` 在 pre-flight fail 分支仅写 `metadata.pre_flight_failed = true`，没有任何告警通道。

## 方案

用 Brain 现有 `packages/brain/src/alerting.js` 的 `raise(level, source, message)` 推送飞书。
- 每次 pre-flight 失败 → 立即 `raise('P2', 'pre_flight_cancel', msg)`（进 24h 汇总）
- 24h 内累计 fail_count >= 3 → 升级 `raise('P0', 'pre_flight_burst', msg)`（立即推送）

## 不做

- 不加新推送通道（复用现有飞书）
- 不改 pre-flight 判断逻辑（只加告警 hook）
- 不改已 cancel 的历史任务
- 不做 Engine bump

## 实现位置

- `packages/brain/src/pre-flight-check.js` 末尾添加 `alertOnPreFlightFail(pool, task, checkResult)`
- `packages/brain/src/tick.js` 在 UPDATE 之后、recordDispatchResult 之前增加 1 行 `await alertOnPreFlightFail(...)`
- 新增 `packages/brain/src/__tests__/pre-flight-alerting.test.js`

## DoD

- [x] [BEHAVIOR] pre-flight 失败 → raise(P2, 'pre_flight_cancel', msg) 被调用
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/pre-flight-check.js','utf8');if(!/raise\('P2', 'pre_flight_cancel'/.test(c))process.exit(1)"`
- [x] [BEHAVIOR] 24h 内 fail_count >= 3 → 升级 raise(P0, 'pre_flight_burst', msg)
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/pre-flight-check.js','utf8');if(!/raise\('P0', 'pre_flight_burst'/.test(c))process.exit(1)"`
- [x] [ARTIFACT] alertOnPreFlightFail 函数导出，签名为 (pool, task, checkResult)
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/pre-flight-check.js','utf8');if(!/export async function alertOnPreFlightFail\s*\(\s*pool,\s*task,\s*checkResult\s*\)/.test(c))process.exit(1)"`
- [x] [ARTIFACT] 单元测试覆盖单次 fail + 累计阈值 + issues 空数组三个 case
  Test: `tests/pre-flight-alerting.test.js`

## 成功标准

- `pre-flight-alerting.test.js` 全绿
- tick.js 改动仅一行 `await alertOnPreFlightFail(pool, candidate, checkResult);`
- Engine 不需要 bump
