# Bug PrepPRD：Kernel GAN cost 零回写致 budget cap 失效

## 症状
r17（run 5172f36e）8 个 attempt 全部完成后 initiative_runs.cost_usd 仍为 0.00；BUDGET_CAP_USD=10 永不触发，GAN 唯一的钱闸死亡，对抗环可无限烧配额。

## 根因假设
`deriveGan` 的 `counters.ganCostUsd` 来自 `observed.run.cost_usd`（loop.js:588）；`patchKernelRunById`/`finalizeKernelRun` 支持写 cost_usd（COALESCE $7），但全 orchestrator **没有任何调用方**在 attempt 完成时提取用量并累加回写。链路从未接线，不是数值错误。

## 关联上下文
- Issue：ce42f68f（Kernel GAN 收敛保护全断，P0）
- 决策：ba33fc68（案卷式 GAN，安全网含"cost 回写复活 budget cap"）/ c953a263（上下文闭环）
- 实证：r17 attempt result.provider_metadata 未见 usage 字段——数据源需在 Phase 1 探明（codex callback 是否带用量；不带则回退固定估算价）

## 修法
attempt 终态处理路径（callback → attempt 完成落库处）提取该 attempt 用量（provider usage 或估算价）→ 累加写 initiative_runs.cost_usd。deriveGan 现有 budgetExceeded 判断不动。

## Regression Test 计划
failing test 复现：attempt completed（带用量数据）后 run.cost_usd 仍为 0 → FAIL；修复后断言 cost_usd 单调累加、多 attempt 累计正确、无用量数据时按估算价累加不为 0。永久留 CI。

## 验收标准
- [ ] failing test 先 commit（commit-1）
- [ ] 修复代码让 test 变绿（commit-2）
- [ ] 守卫：纯逻辑接缝，CI regression test 即守卫（proven-to-fire：先红后绿）
- [ ] DevGate 三关（facts-check / version-sync / dod-mapping）+ brain version bump
- [ ] CI 全绿
