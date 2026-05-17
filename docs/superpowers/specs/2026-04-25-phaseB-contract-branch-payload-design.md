# Phase B 入库 sub-task 时 set payload.contract_branch — 设计

> Brain task: `1d37b05f-f367-4c92-876d-8245db7ebdd8`
> Harness v6 P0-final：修 Generator ABORT 最后一跳

## 背景

P1-D 修了 `harness-task-dispatch.js` 注入 `CONTRACT_BRANCH` env，但 Phase B 入库 sub-task 时 `payload.contract_branch` 字段没设 → 注入空串 → Generator ABORT（`'CONTRACT_BRANCH 未定义'`）。

**实证**：bb245cb4 / 576f6cf4 两次 Initiative，所有 Gen 容器都 ABORT。

## 漏点定位

1. `packages/brain/src/harness-dag.js::upsertTaskPlan` 的 `INSERT INTO tasks ... payload` 没含 `contract_branch`。
2. `packages/brain/src/workflows/harness-gan.graph.js` 的 GAN graph 不返回 propose branch。
3. `packages/brain/src/workflows/harness-initiative.graph.js` 两个 upsertTaskPlan 调用点没传 contractBranch。
4. `initiative_contracts` 表无 `branch` 列。

## 数据流（修复后）

```
GAN proposer 节点 (每轮)
  → stdout JSON {"propose_branch": "cp-harness-propose-rN-XXX"}
  → 解析写到 state.proposeBranch
  ↓
runGanContractGraph 返回 { contract_content, rounds, cost_usd, propose_branch }
  ↓
runInitiative / dbUpsertNode
  ├─ upsertTaskPlan({ contractBranch: ganResult.propose_branch }) → 每个 sub-task payload.contract_branch
  └─ INSERT initiative_contracts (..., branch=ganResult.propose_branch)
  ↓
harness-task-dispatch.js: env.CONTRACT_BRANCH = payload.contract_branch (非空)
  ↓
Generator container 拿到非空 CONTRACT_BRANCH → 不 ABORT
```

## 改动清单

### 1. Migration 246

`packages/brain/migrations/246_add_branch_to_initiative_contracts.sql`：

```sql
ALTER TABLE initiative_contracts
  ADD COLUMN IF NOT EXISTS branch TEXT;
```

不加 NOT NULL（历史行已存在）；不加 default（旧记录保持 NULL）。

### 2. GAN graph state 扩展

`packages/brain/src/workflows/harness-gan.graph.js`：

- `GanContractState` 添加 `proposeBranch` Annotation（reducer 取最新）
- `proposer` 节点解析 result.stdout 中 `"propose_branch":"..."` 写入 state.proposeBranch
- `runGanContractGraph` 返回对象增 `propose_branch: finalState.proposeBranch || null`

### 3. upsertTaskPlan 接受 contractBranch

`packages/brain/src/harness-dag.js`：

```js
export async function upsertTaskPlan({
  initiativeId, initiativeTaskId, taskPlan, client,
  contractBranch = null,  // 新增可选参数
}) {
  ...
  const payload = {
    logical_task_id: t.task_id,
    initiative_id: initiativeId,
    parent_task_id: initiativeTaskId,
    complexity: t.complexity,
    estimated_minutes: t.estimated_minutes,
    files: t.files,
    dod: t.dod,
    depends_on_logical: t.depends_on || [],
  };
  if (contractBranch) payload.contract_branch = contractBranch;
  ...
}
```

### 4. harness-initiative.graph.js 两点都传 contractBranch + 持久化 branch

```js
const { idMap, insertedTaskIds } = await upsertTaskPlan({
  initiativeId, initiativeTaskId, taskPlan, client,
  contractBranch: ganResult.propose_branch,
});

await client.query(
  `INSERT INTO initiative_contracts (..., branch, approved_at) VALUES (..., $N, NOW())`,
  [..., ganResult.propose_branch],
);
```

### 5. 单元测试

`packages/brain/src/__tests__/harness-dag-contract-branch.test.js`（新建）：

- mock client.query
- 调 upsertTaskPlan({ contractBranch: 'cp-harness-propose-r3-abc12345' })
- 验证：每个 sub-task INSERT 的 payload JSON 解析后 `contract_branch === 'cp-harness-propose-r3-abc12345'`
- 边界：不传 contractBranch → payload 不含该 key（向后兼容）

## 成功标准（对应 PRD）

- [ARTIFACT] upsertTaskPlan 在 INSERT sub-task 时 payload 含 contract_branch（contractBranch 非空时）
- [BEHAVIOR] 单元测试: 4 个 sub-task 创建后每个 payload.contract_branch === approved_contract.branch
- [BEHAVIOR] 集成: psql 查 sub-tasks payload->>'contract_branch' 非空（运行时验证，新 Initiative 跑后）

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 老测试不传 contractBranch 失败 | contractBranch 默认 null，仅当非 null 时写 payload |
| stdout `propose_branch` 解析失败 | 兜底 null（Generator 仍 ABORT，但比当前漂移好；后续可加 git-ls-remote fallback） |
| migration 在生产无法回滚 | branch 是新增列允许 NULL，回滚 migration 用 DROP COLUMN，不破坏旧行 |

## 范围边界

不做：
- 不改 harness-task-dispatch.js（P1-D 已修）
- 不改 GAN proposer skill（已经在 stdout 输出 propose_branch）
- 不补 git-ls-remote fallback（独立 task；本 PR 聚焦 happy path）
