# Red Evidence — 合同测试实跑（commit 1 前）

命令: cd packages/brain && npx vitest run --config ../../sprints/08040916-relay-78e812c0/tests/vitest.config.mjs

总计: total=18 failed=10 passed=8（与合同 Test Contract 预期红证据一致：10 failures / 8 pass）

## auto-learning-harness.test.ts — 1 failed / 2 passed
- [FAIL] VALUABLE_TASK_TYPES 含 harness_initiative
- [PASS] VALUABLE_TASK_TYPES 保留 dev feature research 不回退
- [PASS] VALUABLE_TASK_TYPES 不纳入 code_review 等高频低价值类型

## breach-issue-copy.integration.test.ts — 2 failed / 2 passed
- [FAIL] debt 持平时 issue 文案不含「上升」且含持平或连续第 N 天表述
- [PASS] debt 真实上升时保留上升表述
- [FAIL] 探针自产 issue atom 带 lane=ledger-hygiene 且 routed_to_table=issues routed_to_id 非空
- [PASS] issue title 保持 [ledger-hygiene] 指标名前缀不变

## capture-atom-routing.integration.test.ts — 2 failed / 2 passed
- [FAIL] pushCaptureAtom 传 routedToTable/routedToId 真实落库到 capture_atoms
- [FAIL] pushCaptureAtom 透传 lane 落库
- [PASS] routedToTable/routedToId 未传时列为 NULL（可选参数不回退既有调用方）
- [PASS] 缺 content 或 targetType 返回 null 不写库

## handoff-atom-relay.integration.test.ts — 3 failed / 0 passed
- [FAIL] pushHandoffAtom 写入 target_type=handoff 且 routed_to_table=tasks routed_to_id=task_id
- [FAIL] handoff 为空对象或非对象时不产 atom 且不抛异常
- [FAIL] verdict=PASS 且含真实 next_steps → target_subtype=PASS+NEXT 与 saveHandoff 同口径

## ledger-hygiene-m7-beijing-window.integration.test.ts — 2 failed / 2 passed
- [FAIL] m7 统计窗为上一完整北京日：仅当前时刻 atom 不计入 → debt=1
- [FAIL] m7 排除探针自产 atoms：上一北京日仅 lane=ledger-hygiene 自产 issue atom → debt=1 正确击穿
- [PASS] 上一北京日存在非自产 atom → m7 debt=0 清偿
- [PASS] debt=0 无击穿 → ratchet streak 复位为 0
