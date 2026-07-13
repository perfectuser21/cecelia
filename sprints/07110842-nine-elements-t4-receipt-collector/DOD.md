# DoD：九要素T4 回执collector

- [x] [BEHAVIOR] receipt-collector：record 写 pending、resolve 核销 confirmed/failed（仅 pending 行）、tick 超 30min 标 timeout（10min 自 gate）、getUnconfirmedReceipts 查 24h 未确认；全路径 fail-open
  - Test: tests/ packages/brain/src/__tests__/receipt-collector.test.js
- [x] [BEHAVIOR] notifier 三渠道（feishu webhook / open_api / bark）真实发送时写回执并按结果核销；muted/dedupe/未配置跳过不写
  - Test: tests/ packages/brain/src/__tests__/notifier-receipt.test.js
- [x] [BEHAVIOR] feishu-alert skill_eval webhook 发送写回执并核销；未配置本地兜底不写
  - Test: tests/ packages/brain/src/__tests__/feishu-alert-receipt.test.js
- [x] [BEHAVIOR] deploy webhook production/staging 触发写 pending，close/execSync 结果核销；鉴权失败不写
  - Test: tests/ packages/brain/src/__tests__/deploy-receipt.test.js
- [x] [BEHAVIOR] scheduler-jobs 注册 receipt-collector（11 jobs）；battle-report 渲染"未确认动作（24h）"段且查询失败降级
  - Test: tests/ packages/brain/src/__tests__/scheduler-jobs.test.js
- [x] 版本 bump 1.250.0 四处同步（check-version-sync.sh 通过）
- [x] smoke: manual: bash packages/brain/scripts/smoke/t4-receipt-collector-smoke.sh
- [x] CI 全绿
