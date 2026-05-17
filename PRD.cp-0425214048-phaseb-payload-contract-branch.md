# PRD: Phase B 入库 sub-task 时 set payload.contract_branch

**分支**：cp-0425214048-phaseb-payload-contract-branch
**日期**：2026-04-25
**Brain task**：1d37b05f-f367-4c92-876d-8245db7ebdd8

## 背景

P1-D 修了 `harness-task-dispatch.js` 注入 CONTRACT_BRANCH env，但 sub-task 入库时 payload 没设 `contract_branch` → 注入空字符串 → Generator ABORT（'CONTRACT_BRANCH 未定义'）。

实证: bb245cb4 / 576f6cf4 两次 Initiative，所有 Generator 容器都 ABORT。

## 根因

注入代码 `env.CONTRACT_BRANCH = payload.contract_branch || ''` 依赖 `tasks.payload.contract_branch`，但 `harness-dag.js::upsertTaskPlan` 在 Phase B 入库 4-5 个 sub-task 时压根没在 payload 里写这个字段。

更深层：GAN graph (`harness-gan.graph.js`) 自身从未捕获 proposer 输出的 `propose_branch` — 信息在 stdout 里被丢弃，从未流到 Phase B。

链路漏点（5 跳全断）：
1. proposer 节点不解析 stdout 的 `propose_branch`
2. `GanContractState` 无对应 Annotation
3. `runGanContractGraph` 返回值无 `propose_branch`
4. `harness-initiative.graph.js` 无法透传给 `upsertTaskPlan`
5. `upsertTaskPlan` 也不接受这个参数

## 修复范围

补全 5 跳，并加 `initiative_contracts.branch` 列做 Initiative 级 SSOT：

1. **migration 246**: `ALTER TABLE initiative_contracts ADD COLUMN branch TEXT`
2. **GAN graph**:
   - `GanContractState` 加 `proposeBranch` Annotation（reducer 取最新）
   - `proposer` 节点解析 stdout 中 `propose_branch` JSON 字段写到 state
   - `runGanContractGraph` 返回值新增 `propose_branch`
3. **harness-dag.js::upsertTaskPlan**: 接收可选 `contractBranch` 参数，非空时写入每个 sub-task 的 `payload.contract_branch`
4. **harness-initiative.graph.js** 两个 upsertTaskPlan 调用点（runInitiative + dbUpsertNode）：
   - 透传 `ganResult.propose_branch` 到 `upsertTaskPlan({ contractBranch })`
   - INSERT initiative_contracts 时写 `branch` 列
5. **selfcheck**: bump `EXPECTED_SCHEMA_VERSION` 到 246 + `DEFINITION.md` 同步

## 成功标准

- 单元测试：`upsertTaskPlan({ contractBranch: 'X' })` → 所有 sub-task INSERT 的 payload JSON 解析后 `contract_branch === 'X'`
- 单元测试：`runGanContractGraph` 在 proposer stdout 含 `propose_branch` 时返回值有该字段
- 向后兼容：不传 `contractBranch` → payload 不含该 key（不破坏现有 priority test）
- facts-check 通过：`schema_version: 246`
- 集成：未来跑新 Initiative 后 `psql -c "SELECT branch FROM initiative_contracts WHERE id=..."` 非空 + `SELECT payload->>'contract_branch' FROM tasks WHERE payload->>'parent_task_id'=..."` 非空

## 不做

- 不改 `harness-task-dispatch.js`（P1-D 已修）
- 不改 GAN proposer skill（已经在 stdout 输出 `propose_branch`）
- 不补 `git ls-remote` fallback（独立 task；本 PR 聚焦 happy path）
