# Learning: 架构意图要钉在代码层，别只钉在 LLM skill 的自觉里

**分支**: cp-0620110209-harness-dag-pin-1pr
**日期**: 2026-06-20
**Decision**: 145fd4d5-8982-4f8d-b6bf-a0c391190d9e

## 背景

「1 harness = 1 sprint = 1 PR」是 v8.0.0 移除 workstream 拆分后的核心架构意图（对齐 Anthropic 官方 v2）。但审查 pipeline 时发现：这个「只出 1 个 PR」的约束**只活在 harness-contract-proposer 这个 LLM skill 的死规则里**（它自觉只写一个 ws1），而 brain 代码层的 `parseTaskPlan` 校验仍放行 `tasks.length ≤ 8`（workstream 模型的残留）。

### 根本原因

架构意图变更（移除 workstream 概念）时，**只在 LLM skill 层落地了，brain 的确定性校验层没同步收紧**：
1. `parseTaskPlan` 保留旧的 `> 8` cap，等于"软约束"——一旦 proposer LLM 漂移多写 task，brain 会照单全收，真跑出 N 个 PR，违背架构意图。保证落在"LLM 自觉"而非"代码硬保证"上。
2. 旧 workstream 机制的死代码（`nextRunnableTask` 函数 + harness-phase-advancer.test.js）没随概念移除一起清掉，残留下来还**把后续的架构调查带偏**（一度被误判为"系统会产 N 个 PR"）。

本质：可机械验证的约束（"只出 1 个 task"）被留给了不可靠的 LLM 判断；而退役机制的死代码污染了系统的可读性。

### 下次预防

- [ ] 架构意图变更（尤其"移除某个概念"）时，必须问一句："这个约束有没有可机械验证的判据？有的话钉在确定性代码层（validator/CI gate），不能只写进 LLM skill 的 prompt"
- [ ] 移除一个概念时，同步搜并清掉它的死代码（函数 + 测试 + 注释引用），用 `grep -rn <symbol>` 确认零引用，避免残留误导后续调查
- [ ] 校验函数里的上限/范围（如 `length > N`）若对应一个已废弃的设计概念，应主动收紧到当前意图（如 `=== 1`），而不是留着宽松旧值
- [ ] 删函数前先 `grep` 全仓真实调用点，区分"注释/skip 测试引用"与"生产调用"，确认安全再删

## 本次落地

- `parseTaskPlan`: `tasks.length > 8` cap → `tasks.length !== 1` 即 throw（代码硬保证 1 PR）
- 删 `nextRunnableTask`（零生产调用）+ 头部 doc + dispatch-helpers 注释引用 + 死测试文件 harness-phase-advancer.test.js + 5 处 vi.mock 残留
- 红线未碰：pick/advance 循环、task_loop_index、ws1 命名、detectCycle、topologicalOrder
