# H13 — spawnGeneratorNode 容器启动前 import contract artifacts

**日期**: 2026-05-09
**状态**: design APPROVED
**Sprint**: langgraph-contract-enforcement / Stage 1 supplement-3
**Brain task**: 4b0cce61-5cbd-4371-9795-4d782503a308

---

## 1. 背景

W8 v14 11 nodes terminal_fail，evaluator 自己说出真根因：

> "DoD 文件 `sprints/w8-langgraph-v14/contract-dod-ws1.md` 在当前 generator worktree 中不存在 — 它只存在于 proposer 分支 `cp-harness-propose-r3-...` 上。当前分支只新增了 `docs/learnings/w8-langgraph-v14-e2e.md`，没把 proposer 的 sprints 目录带入。"

H11 让 sub-task generator 用独立 worktree（`task-<init8>-<logical>`）fresh off main —— **没合并 proposer 分支的 sprints 目录**（含 `contract-draft.md` / `contract-dod-wsN.md` / `task-plan.json` / `tests/`）。Generator 容器看不到合同 → 自己产个 docs/learnings 当 skeleton → evaluator 找不到 DoD 要的 trigger.sh → FAIL。

`state.contractBranch` 已 schema 内（harness-task.graph.js:62）+ runSubTaskNode 已注入（harness-initiative.graph.js:970）+ env 已传给容器（line 168 `CONTRACT_BRANCH`）。但 spawnNode 拿到 worktreePath 后**没主动把合同 checkout 进 worktree**。

## 2. 修法

`packages/brain/src/workflows/harness-task.graph.js` spawnNode 函数，在 ensureWt 拿到 worktreePath 之后、buildGeneratorPrompt 之前（约 line 130-132 之间），加 contract import 步骤：

```js
// H13: 把 proposer 分支的合同物件（sprints/）checkout 到 generator worktree。
// proposer push 了 contract-dod-wsN.md / tests/ws*/ / task-plan.json 到 cp-harness-propose-r3-*，
// 但 generator worktree fresh off main 看不到。先 fetch + checkout，让 generator 容器内 SKILL
// 能 read 合同基于它干活；不做 contract import → generator 不知道 DoD 存在 → evaluator 永远 FAIL。
const contractBranch = state.contractBranch;
if (contractBranch && !state.contractImported) {
  try {
    await execFile('git', ['fetch', 'origin', `${contractBranch}:refs/remotes/origin/${contractBranch}`], { cwd: worktreePath });
    await execFile('git', ['checkout', `origin/${contractBranch}`, '--', 'sprints/'], { cwd: worktreePath });
    // 把 checkout 出的 sprints/ 文件 stage + commit（generator 后续 commit 时一起带进 PR）
    await execFile('git', ['add', 'sprints/'], { cwd: worktreePath });
    // commit 失败（无变更）非阻塞 — generator 仍能在 worktree 里看到 sprints/
    await execFile('git', ['commit', '-m', `chore(harness): import contract from ${contractBranch}`], { cwd: worktreePath })
      .catch(() => null);
  } catch (err) {
    return { error: { node: 'spawn', message: `prep: import contract from ${contractBranch}: ${err.message}` } };
  }
}
```

加 sub-graph state 字段 `contractImported`（避免 resume 时重复 import）：

```js
// harness-task.graph.js line 62 附近 schema 加：
contractImported: Annotation({ reducer: (_o, n) => n, default: () => false }),
```

return 加：

```js
return {
  containerId: finalContainerId,
  ...(contractBranch ? { contractImported: true } : {}),
};
```

## 3. 不动什么

- 不动 H7/H9/H8/H10/H11/H12 已合 PR
- 不动 generator SKILL（让 SKILL 自己读 DoD）
- 不动 evaluator / proposer
- 不引入完整 contract enforcement layer（stage 2）
- 不破坏现有 spawnNode 幂等门（state.containerId 已设直接 short-circuit）

## 4. 测试策略

按 Cecelia 测试金字塔：H13 是单文件单函数改动 + 几行 git 命令调用。属于 **integration 类**（多 git 命令编排），但用 spy execFile 可以纯 unit 覆盖逻辑。

### 测试

`tests/brain/h13-import-contract-artifacts.test.js`（vitest）：

- **A. spawnNode 在 contractBranch 存在时调用 git fetch + checkout sprints/ + add + commit**
  - mock execFile (spy)，state.contractBranch='cp-harness-propose-r3-abc'
  - 期望 spy 收到 4 个 git 调用，参数顺序对：fetch → checkout → add → commit

- **B. spawnNode 在 contractBranch null 时不调 git import**
  - state.contractBranch=null → spy execFile 没收到 fetch/checkout 调用

- **C. spawnNode 幂等：state.contractImported=true 时不重复 import**
  - state.contractImported=true → spy 没收到 fetch/checkout

- **D. import 失败 → return error 节点不推进**
  - mock execFile fetch reject → 期望返回 `{ error: { node: 'spawn', message: /import contract/ } }`

不做 docker E2E；W8 v15 真跑兜 integration。

## 5. DoD

- [BEHAVIOR] spawnNode contractBranch 存在时 import sprints/（git fetch + checkout + add + commit）
  Test: tests/brain/h13-import-contract-artifacts.test.js
- [BEHAVIOR] spawnNode contractBranch null 时不 import
  Test: tests/brain/h13-import-contract-artifacts.test.js
- [BEHAVIOR] spawnNode contractImported=true 时短路（幂等门）
  Test: tests/brain/h13-import-contract-artifacts.test.js
- [BEHAVIOR] spawnNode import 失败 return error
  Test: tests/brain/h13-import-contract-artifacts.test.js
- [ARTIFACT] harness-task.graph.js 含 'fetch' + 'checkout' + 'sprints/' + 'import contract' 字面量
  Test: manual:node -e 检查
- [ARTIFACT] sub-graph state schema 含 contractImported field
  Test: manual:node -e 检查
- [ARTIFACT] 测试文件存在
  Test: manual:node -e accessSync

## 6. 合并后真实证（手动）

1. brain redeploy
2. 跑 W8 v15 一个 sub_task
3. 容器内 `ls /workspace/sprints/` 含 contract-dod-wsN.md / tests/wsN/ 等
4. evaluator stdout 不再说"DoD 文件不存在"
5. evaluate verdict=PASS（如果 generator 真按 DoD 干活）
6. 父 graph 推进到 advance/finalE2e/final_evaluate/report → status=completed

## 7. 不做（明确范围）

- ❌ 不动 H7-H12 已合 PR
- ❌ 不动 generator SKILL prompt
- ❌ 不引入 contract enforcement verify layer（stage 2）
- ❌ 不动 proposer / reviewer / inferTaskPlan / evaluator
