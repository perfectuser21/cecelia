# 退役 ZenithJoy 旧客户 staging

Task: 146c51f5-cbfa-494b-b43f-d392ae970d2f
GP-Anchor: none(infra)

- [x] 已退役客户提交返回 410，缺失或与 PR 地址冲突的仓库字段不会绕过，且不会建单。
  Test: manual:cd packages/brain && npx vitest run src/__tests__/staging-e2e-api.test.js
- [x] 恢复旧客户任务只记录退役；不再访问旧 staging，保留历史 verdict 与晋级台账。内部 Brain 和 Dashboard 核验继续通过。
  Test: manual:cd packages/brain && npx vitest run src/__tests__/staging-e2e-runner.test.js src/__tests__/staging-e2e-runner-dashboard-seam.test.js src/__tests__/staging-e2e-runner-promote.test.js
- [x] 旧客户确认返回 410 且不改历史台账；内部确认按已存仓库身份运行 Cecelia 晋级。
  Test: manual:cd packages/brain && npx vitest run src/routes/__tests__/staging-promote.test.js
