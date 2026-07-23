# Bug 修复设计：strategist_decision 卡死于 S2 锚点执法

## 症状

`task_type='strategist_decision'` 的任务（line-strategist 军师循环，事件驱动，由 `run_terminal` 触发）派发后立即被判 `failed`，从未进入 `in_progress`。DB 实证：8 条 failed（error_message 均为"S2锚点执法：task缺少 payload.anchor..."），另有 6 条仍 `queued`，一旦被 tick 选中会复现同样失败。

## 根因

`packages/brain/src/line-strategist-dispatch.js` 建任务时 payload 只写扁平字段（`journey_id`/`trigger`/`trigger_context`），不带 `payload.anchor.{journey_id,gp_id,step_id}`。07-17 上线的 `anchor-check.js`（S2 锚点执法闸）要求所有非豁免 `task_type` 必须带 `payload.anchor`，否则派发时"先 claim → 查锚点 → 缺锚立即判 failed"。`strategist_decision` 这个类型在 S2 上线时被漏掉，没加进 `ANCHOR_EXEMPT_TASK_TYPES` 白名单。

## 方案

在 `packages/brain/src/anchor-check.js` 的 `ANCHOR_EXEMPT_TASK_TYPES` 里加入 `'strategist_decision'`，紧邻 `arch_review`/`ci_patrol` 等"系统例行分析"类型。

**为什么不是反过来给任务补 payload.anchor**：strategist_decision 由系统事件（journey 内任务终态）自动触发，是"系统观察系统"的分析类任务，不对应人工拍下的功能承诺，本身没有自然锚点——语义上和 arch_review/ci_patrol 是同一类，该走豁免而非补造一个假锚点。

## 影响范围

只影响 `anchor-check.js` 的一个 Set 常量，不改动其他豁免逻辑、不改动 dispatcher 派发顺序。豁免生效后，现存 6 条 queued 的 strategist_decision 任务下次被 tick 选中即可正常执行；8 条已 failed 的历史任务不会自动重跑（failed 是终态，超出本次修复范围，可后续人工按需重开）。

## 测试策略

Regression test（unit）：对 `checkAnchor` / 等价导出函数传入 `{task_type: 'strategist_decision', payload: {journey_id: 'x', trigger: 'run_terminal', trigger_context: {...}}}`（无 `payload.anchor`），断言返回 `{blocked: false}`。先跑确认此测试在修复前失败（红），加白名单后变绿。

## 不包含

- 不修复历史 8 条 failed 任务（终态，不在本次范围）
- 不改动 anchor-check.js 其他判定逻辑（存量豁免、payload.action 豁免等）
- 不涉及排序官（triage-officer）接线——那是另一个独立问题，本次不做
