# Learning — Harness v2 M3 GAN 合同 v2

PR 分支：cp-0419231924-harness-v2-m3-gan-contract
PR 标题：feat(brain): Harness v2 M3 — GAN 合同 v2 (Tasks + skeptical Reviewer)
日期：2026-04-19

## 做了什么

- `packages/brain/src/harness-graph.js` 新增 `parseTasks(contract)`，解析 `## Tasks` 区块里 N 个 `### Task: <id>` 子块，每 Task 返回 `{task_id, title, scope, depends_on[], files[], dod, unit_test_plan, integration_test_plan, verify_commands}`。
- proposer 节点优先用 `parseTasks`（v2），返回空时 fallback 到 `parseWorkstreams`（v1），保证旧合同仍能解析。
- reviewer 节点 prompt 重写：删除"避免无限挑剔导致对抗循环无法收敛"的妥协语；加入"你的工作是找风险，不是认可合同"、"每轮必须列出 ≥2 个具体风险点（at least 2 concrete risks）"硬约束，以及 3 个新挑战维度（DAG 合理性 / Initiative 级 E2E 覆盖 / 测试金字塔完整性）。
- `harness-contract-proposer` SKILL.md（4 份硬链接同步）：从 `## Workstreams` 改为 `## Tasks`，每 Task 子块必须含 `#### Unit Test Plan` + `#### Integration Test Plan`（测试金字塔强制），新增 Initiative 级 `## E2E Acceptance` 区块（Given-When-Then + curl/playwright 命令 + 覆盖的 Tasks 字段）。
- `harness-contract-reviewer` SKILL.md（4 份硬链接同步）：撤销"避免无限挑剔 / 避免过度挑剔"字样，强化 skeptical tuning，写明 4 挑战维度和 ≥2 风险点硬约束。

## 根本原因

v1 的 Reviewer prompt 显式写了"避免无限挑剔导致对抗循环无法收敛"，等于给 Reviewer 一个"早 APPROVED"的借口，GAN 对抗会快速收敛到弱合同。Proposer 的 `## Workstreams` 格式只要求列 DoD，没有强制测试金字塔，也没有 Initiative 级 E2E 验收章节，导致：
1. Task 级 evaluator 只能看到 per-Task DoD，跨 Task 行为无验收依据
2. 合同里缺 Integration 覆盖点时没有机制挡住
3. Reviewer 没有明确的 DAG / E2E 维度可以挑战

M3 同步升级 Proposer 模板 + Reviewer 硬约束，让对抗深度在合同层面就建立起来。

## 下次预防

- [ ] 保留 `parseWorkstreams`，v1 合同历史数据仍能读；M4 Generator/Evaluator 迁移时再考虑是否删除
- [ ] M4 Evaluator 去 E2E 改造时，新 E2E 验收来源必须是 Initiative 级 `## E2E Acceptance`，不再是 Task 级 `## Feature` 的命令堆
- [ ] M2 / M4 合并 `initiative_contracts` 写入逻辑时，要把 `tasks[]` 入库（本 PR 只输出到 state.tasks，未入库）
- [ ] Reviewer 若在真实对抗中仍过早 APPROVED，检查是否 ≥2 风险点门槛需要提高到 ≥3

## 和 M2（PR #2442）的冲突

- 本 PR 改动 `packages/brain/src/harness-graph.js`：新增 `parseTasks` 纯增 + proposer 节点改解析调用 + reviewer prompt 改文本。
- 如果 M2 也改了 `harness-graph.js` 的 proposer 节点或 reviewer prompt，需要 rebase 处理冲突。
- SKILL.md 4 份同步是硬链接，不在 git 仓库里，无冲突。
- 不改 `initiative_contracts` 写入（M2 域）、不动 Generator / Evaluator（M4 域）。
