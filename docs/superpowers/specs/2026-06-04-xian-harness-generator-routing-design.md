---
title: 西安 Codex 作为 Harness Generator 执行机路由
date: 2026-06-04
status: approved
---

## 目标

让 harness pipeline 的 Generator 步骤可以路由到西安 M4（Codex），实现与美国 M4（Claude Code）的真实对比。Planner/Proposer/GAN/Evaluator 仍在美国跑，只有 Generator 路由到西安。

## 根因分析

4 个独立问题导致当前无法工作：

1. `mac-mini-m4-xian` DB 记录的 `metadata.executors = []`，`resolveExecutor` 显式路由抛 `ExecutorRouteError`
2. `runSubTaskNode` 只展开 `subTask.payload = { dod, files, depends_on }`，initiative 的 `machine`/`executor` 丢失，`resolveExecutor` 兜底美国
3. `spawnNode` contract import 只本地 commit 未 push，西安 `git clone from GitHub` 看不到合同文件
4. codex 路径的 `spawnBridgeFn` payload 没有 `GITHUB_TOKEN`，`codex-task.sh` 无法 push 和开 PR

## 修改清单

### Fix 1：DB — mac-mini-m4-xian executor 注册（1 条 SQL）

```sql
UPDATE machines
SET metadata = jsonb_set(
  metadata,
  '{executors}',
  '[{"executor":"codex","url":"http://100.86.57.69:3458","default":true}]'::jsonb
)
WHERE name = 'mac-mini-m4-xian';
```

### Fix 2：harness-initiative.graph.js — runSubTaskNode 透传 machine/executor（+2 行）

```js
// packages/brain/src/workflows/harness-initiative.graph.js
// runSubTaskNode 里 taskForGraph.payload 加：
...(state.task?.payload?.machine ? { machine: state.task.payload.machine } : {}),
...(state.task?.payload?.executor ? { executor: state.task.payload.executor } : {}),
```

### Fix 3：harness-task.graph.js — codex 路径 push contract 到 GitHub（+5 行）

```js
// spawnNode 里 route.executor === 'codex' 分支，spawnBridgeFn 调用前：
if (state.contractImported && worktreePath) {
  await execFile('git', ['-C', worktreePath, 'push', 'origin',
    `HEAD:${precomputedBranch}`], { timeout: 60_000 });
}
```

### Fix 4：harness-task.graph.js — codex payload 加 GITHUB_TOKEN（+1 行）

```js
// spawnBridgeFn payload：
env: { GITHUB_TOKEN: token },
```

## 不改

- Planner / Proposer / GAN / Evaluator 节点
- `resolve-executor.js` 路由逻辑
- `spawnCodexBridgeDetached` 实现
- worker-daemon（西安侧）

## 测试策略

- Fix 1/2：单测 `runSubTaskNode` 验 machine/executor 透传（mock `resolveExecutor`）
- Fix 3：单测 `spawnNode` codex 路径验 push 在 spawnBridgeFn 之前被调用
- Fix 4：单测 payload 含 GITHUB_TOKEN
- Integration：fire 两条 harness_initiative（US M4 + 西安），对比 PR 质量

## 验收标准

1. `POST /api/brain/tasks` 带 `payload.machine=mac-mini-m4-xian, payload.executor=codex` → harness pipeline Generator 步骤 POST 到 `http://100.86.57.69:3458/run`
2. 西安 codex-task.sh 能看到合同文件（contract-dod.md, tests/）
3. 西安出 PR，callback 回 Brain，pipeline 继续走 Evaluator
4. 与美国 M4 同任务对比：两个 PR 都能过 CI
