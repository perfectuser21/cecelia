# cp-0509000000-lg-hotfix-subtask-payload

**日期**: 2026-05-09
**触发**: W8 v9 acceptance 11 nodes 全跑过但最终 fail at terminal_fail，sub_task generator 自报 ABORTED

## 现象

W8 v9 跑到 sub_task fanout：sub_task 容器 spawn → claude CLI 真启动 → 6 turns 后 **主动 ABORT**：

```json
{
  "verdict": "ABORTED",
  "reason": "missing env WORKSTREAM_INDEX (Brain harness-task-dispatch must inject); also HEAD currently sits on CONTRACT_BRANCH cp-harness-propose-r2-485f6817 instead of a fresh cp-* worktree off origin/main"
}
```

## 根本原因（双 bug）

### Bug 1: WORKSTREAM_INDEX 空

`runSubTaskNode` (line 944) 构造 `taskForGraph.payload`：
```js
payload: { ...subTask.payload, ...(fixCount > 0 ? {...} : {}) }
```

subTask.payload 来自 task-plan.json 的 sub_task 定义，含 `dod`/`files`/`scope` 等，**没有 `logical_task_id` 也没有 `workstream_index`**。

下游 spawnNode 调 `extractWorkstreamIndex(payload)`：
- 看 payload.workstream_index → 无
- 看 payload.logical_task_id → 无
- 返回空字符串

generator skill 检测到 WORKSTREAM_INDEX 空 → ABORT。

### Bug 2: worktree HEAD 在 contract branch

`runSubTaskNode` 把 `state.worktreePath` 传给 sub-graph：
```js
worktreePath: state.worktreePath,
```

但 `state.worktreePath` 是 **initiative 的 worktree**，GAN 阶段被 proposer push 到 contract branch（如 `cp-harness-propose-r2-485f6817`），**HEAD 一直在 contract branch**。

sub-graph spawnNode 看 `state.worktreePath` 已存在 → 跳过 ensureHarnessWorktree → sub_task 容器看到 HEAD = contract branch（不是 fresh main）。

generator skill 期待 fresh worktree off main → ABORT。

## 修复

`runSubTaskNode`:
1. 加 `logical_task_id: subTask.id` 注入 payload
2. 不传 `worktreePath` 给 sub-graph（让 sub-graph spawnNode 自己 ensureHarnessWorktree 建独立 worktree off main）

## 下次预防

- [ ] **sub_task spawn 必须独立 worktree**：每个 sub_task off main，不共享父 initiative worktree
- [ ] **dispatch payload 必须含完整协议字段**：generator skill 检查的字段（logical_task_id / workstream_index / contract_branch）必须 spawn 端注入
- [ ] **每加一个 dispatch consumer 都要审计 payload 协议**：generator skill 改了协议，runSubTaskNode 没跟着改

## 关联

- W8 v9 实证 11 nodes 推过（含 run_sub_task / evaluate / retry / terminal_fail）
- LangGraph 编排架构层完成（PR #2840-2850）
- 本 hotfix 解 sub_task ABORT
