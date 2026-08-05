# Sprint PRD: F6修复——WS1 排序官消费链盘活

**gear**: hotfix
**task_id**: 96a00f17-c04c-45c2-a000-b32aae80b956
**gp_anchor**: factory/f6_inbox_homing

## 问题描述

capture_atoms 58条 `pending_review` 积压，永不清零。

**根因**：`capture-triage.js` 的三路分诊（`no_journey` / `low_confidence` / `gate_fail`）未显式设 `status='parked'`，原子停在 `pending_review` 被 triage-officer-rank 反复捡起却无法路由，形成积压循环。

## Golden Path

入口：`runCaptureTriage(pool)` 对 pending_review 原子分诊
步骤：
1. no_journey → `updateAtom(pool, id, { status: 'parked', ... })`
2. low_confidence → `updateAtom(pool, id, { status: 'parked', ... })`
3. gate_fail → `updateAtom(pool, id, { status: 'parked', ... })`
4. `runCaptureAging(pool)` step5 兜底清零历史遗留 stuck atoms

出口：`SELECT COUNT(*) FROM capture_atoms WHERE status='pending_review'` = 0（运行一轮 aging job 后）

## DoD

1. capture-triage.js 三路显式设 status='parked'（no_journey / low_confidence / gate_fail）
2. capture-aging.js 新增 step5 兜底清零 stuck_parked atoms
3. 永久回归测试：3条 triage + 2条 aging（commit 进 CI，永不删）
4. 晨报归并榜单守卫测试（morning-cockpit-bark.test.js）

## NFR

- 不得静默删除积压原子（禁 DELETE，只允许 status→parked 或路由到 journey）
- 修复不引入新外部依赖

## 锚定声明

> hotfix gear 锚定断言（确定性可验证，不含 LLM 调用）

**A1**. 在 `packages/brain/src/capture-triage.js` 的 `routeAtom` 函数中，`no_journey` 分支调用 `updateAtom` 时携带 `status: 'parked'`。

**A2**. 在 `packages/brain/src/capture-triage.js` 的 `runCaptureTriage` 函数中，`low_confidence` 分支调用 `updateAtom` 时携带 `status: 'parked'`。

**A3**. 在 `packages/brain/src/capture-triage.js` 的 `routeAtom` 函数中，`gate_fail` 分支调用 `updateAtom` 时携带 `status: 'parked'`。

**A4**. `packages/brain/src/capture-aging.js` 导出 `runCaptureAging`，执行后返回值含 `stuck_parked`（number）字段。

**A5**. `capture-triage.test.js` 含针对 A1/A2/A3 的回归测试，`capture-aging.test.js` 含针对 A4 的回归测试，永久留 CI。

## E2E 验收

```bash
# 单元测试全跑（验证 A1-A5）
cd packages/brain && npx vitest run --reporter=verbose \
  src/__tests__/capture-triage.test.js \
  src/__tests__/capture-aging.test.js \
  src/__tests__/morning-cockpit-bark.test.js
# 预期：全部 PASS，0 失败
```

journey_id: 824ee0f5-aeb9-4972-909d-37dd17b75617
step_id: 7f3931a4-fcac-46af-bcfc-fed1f80f0613
journey_type: repair
target_environment: local_api
