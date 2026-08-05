# Contract Draft: F6修复——capture-triage pending_review 积压清零

**gear**: hotfix
**task_id**: 96a00f17-c04c-45c2-a000-b32aae80b956
**assembled_by**: harness-controller (hotfix skip GAN)

## Golden Path Behaviors

| # | 场景 | 输入 | 期望输出 |
|---|------|------|----------|
| 1 | no_journey 分诊 | atom 无 journey_id | status='parked' |
| 2 | low_confidence 分诊 | LLM confidence < LLM_CONFIDENCE_FLOOR | status='parked' |
| 3 | gate_fail 分诊 | invariant gate 检查不过 | status='parked' |
| 4 | aging step5 清零 | stuck pending_review (ai_reason 含 [triage:no_journey/low_confidence/gate_fail]) | status='parked'，stuck_parked 计数 |
| 5 | 晨报含归并榜单 | morning cockpit 生成 | bark message 含 triage_items 段 |

## E2E 验收

```bash
cd packages/brain && npx vitest run --reporter=verbose \
  src/__tests__/capture-triage.test.js \
  src/__tests__/capture-aging.test.js \
  src/__tests__/morning-cockpit-bark.test.js
```

预期：全部 PASS，0 失败。

## 未覆盖真实链路清单

**N/A** — 本 hotfix 只修代码路径，不需真实 LLM 调用或 DB 连接即可单元验证。存量积压清零依赖下一轮 aging job 自动执行（PR 合并后 ≤1h），不在本 PR 的 E2E 范围内。
