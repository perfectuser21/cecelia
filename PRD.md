# PRD: Gate 5 B1+B2 — 凭据健康巡检 cron + 每日真业务 E2E smoke

## 背景与目标

Gate 5 持续监控基础设施。本 PR 实现两个 cron 任务接入 Brain tick-runner：

- **B1**: 凭据健康巡检 — 每天北京时间 03:00（UTC 19:00）检查 NotebookLM/Claude OAuth/Codex/发布器凭据，30 天前 P1 告警，7 天前 P0 告警，已过期立即 P0 告警 + 创建 Brain 任务
- **B2**: 每日真业务 E2E smoke — 每天北京时间 04:00（UTC 20:00）触发一条真实 content-pipeline（solo-company-case），30 分钟内验收图片 ≥ 9 + export 完成，否则 P0 飞书告警

## 成功标准

1. `credentials-health-scheduler.js` 在窗口内触发告警逻辑，30 天/7 天/已过期三档正确
2. `daily-real-business-smoke.js` 在窗口内触发 pipeline，30 分钟超时 P0 告警
3. `tick-runner.js` 接入两个新 cron（10.17h + 10.21）
4. `cecelia-bridge.js` 新增 `/notebook/auth-check` 端点
5. 所有单元测试通过（vitest）

## DoD

- [x] [ARTIFACT] `packages/brain/src/credentials-health-scheduler.js` 存在且语法正确
  - Test: `node -e "require('fs').accessSync('packages/brain/src/credentials-health-scheduler.js')"`
- [x] [ARTIFACT] `packages/brain/src/cron/daily-real-business-smoke.js` 存在且语法正确
  - Test: `node -e "require('fs').accessSync('packages/brain/src/cron/daily-real-business-smoke.js')"`
- [x] [ARTIFACT] `packages/brain/src/__tests__/credentials-health.test.js` 存在
  - Test: `node -e "require('fs').accessSync('packages/brain/src/__tests__/credentials-health.test.js')"`
- [x] [ARTIFACT] `packages/brain/tests/brain/daily-smoke.test.js` 存在
  - Test: `node -e "require('fs').accessSync('packages/brain/tests/brain/daily-smoke.test.js')"`
- [x] [BEHAVIOR] tick-runner.js 已接入 runDailySmoke + runCredentialsHealthCheck
  - Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/tick-runner.js','utf8');if(!c.includes('runDailySmoke')||!c.includes('runCredentialsHealthCheck'))process.exit(1)"`
- [x] [BEHAVIOR] cecelia-bridge.js 新增 /notebook/auth-check 端点
  - Test: `node -e "const c=require('fs').readFileSync('packages/brain/scripts/cecelia-bridge.js','utf8');if(!c.includes('/notebook/auth-check'))process.exit(1)"`
- [x] [BEHAVIOR] isInCredentialsHealthWindow 在 UTC 19:00-19:04 返回 true，19:05 返回 false
  - Test: `tests/brain/daily-smoke.test.js` + `src/__tests__/credentials-health.test.js`
- [x] [BEHAVIOR] runDailySmoke 在窗口外返回 skipped_window=true，窗口内且未跑返回 triggered=true
  - Test: `tests/brain/daily-smoke.test.js`
- [x] [ARTIFACT] `packages/brain/scripts/cron/credentials-health-check.sh` 存在
  - Test: `node -e "require('fs').accessSync('packages/brain/scripts/cron/credentials-health-check.sh')"`
- [x] [ARTIFACT] `packages/brain/scripts/smoke/gate5-b1-b2-smoke.sh` 存在
  - Test: `node -e "require('fs').accessSync('packages/brain/scripts/smoke/gate5-b1-b2-smoke.sh')"`
