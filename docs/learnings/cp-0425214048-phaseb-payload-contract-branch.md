# Learning: Phase B sub-task 入库漏写 contract_branch（v6 P0-final）

> 分支: cp-0425214048-phaseb-payload-contract-branch
> Brain task: 1d37b05f-f367-4c92-876d-8245db7ebdd8
> 实证: bb245cb4 / 576f6cf4 两次 Initiative，所有 Generator 容器 ABORT

## 现象

P1-D 修了 harness-task-dispatch.js 注入 CONTRACT_BRANCH env，但运行时 env 仍为空字符串 → Generator 容器读到空 CONTRACT_BRANCH → ABORT（提示 'CONTRACT_BRANCH 未定义'）。

## 根本原因

注入代码 `env.CONTRACT_BRANCH = payload.contract_branch || ''` 依赖 `tasks.payload.contract_branch`，但 `harness-dag.js::upsertTaskPlan` 在 Phase B 入库 4-5 个 sub-task 时压根没在 payload 里写这个字段。

更深层：GAN graph (`harness-gan.graph.js`) 自身从未捕获 proposer 输出的 propose_branch — 信息在 stdout 里被丢弃，从未流到 Phase B。

链路漏点（5 跳全断）：
1. proposer 节点不解析 stdout 的 propose_branch
2. GanContractState 无对应 Annotation
3. runGanContractGraph 返回值无 propose_branch
4. harness-initiative.graph.js 自然没法透传给 upsertTaskPlan
5. upsertTaskPlan 也不接受这个参数

P1-D 修了 dispatch 端但漏了源头。本 PR 把 5 跳都补上 + 加 initiative_contracts.branch 列做 Initiative 级 SSOT。

## 下次预防

- [ ] 任何"env 注入靠 payload 字段"的设计，必须从 payload 来源向上追溯到信息源头，确保链路上每跳都显式持久化
- [ ] GAN proposer SKILL 在 stdout 输出的 JSON 字段（propose_branch / review_branch）必须在 graph state 里有对应 Annotation
- [ ] initiative_contracts 表加 branch 列后，未来排查 Generator ABORT 可直接 `psql -c "SELECT branch FROM initiative_contracts WHERE initiative_id=..."` 一行定位
- [ ] feat(brain) PR 审查清单：若改 dispatch / spawn 路径的 env 注入，必须验证 payload 字段写入点存在
- [ ] Brain core 改动必须 bump `EXPECTED_SCHEMA_VERSION` 和 `DEFINITION.md` 与 migration 编号同步（这次因 facts-check 提示及时发现）
