# H10 — proposer 节点末尾 verify origin push

**日期**: 2026-05-09
**状态**: design APPROVED
**Sprint**: langgraph-contract-enforcement / Stage 1（最后 1 个 PR，4/4）
**Brain task**: 9f2e58dd-86ac-4738-9c89-6d3c8fce281f
**接手 PRD**: docs/handoffs/2026-05-09-langgraph-contract-enforcement-prd.md（Fix 2）

---

## 1. 背景

W8 v10 跑里 proposer r3 容器 exit=0 但 cp-harness-propose-r3-* 分支没 push 到 origin → inferTaskPlan 节点 `git show origin/cp-harness-propose-r3-...:sprints/task-plan.json` 失败 → graph 卡死。

根因（统一根因家族）：brain 把 docker `exit_code=0` 等同于节点 success，没主动验证 proposer 容器实际产出（远端 branch + task-plan.json）真存在。

`packages/brain/src/workflows/harness-gan.graph.js` proposer 节点（line 361-405）目前只做：
- 读容器 exit_code
- 读 contractContent（本地 worktree file）
- 解析 propose_branch
- access 本地 task-plan.json（缺失只 console.warn，不 fail 节点）

但 origin 上 branch + task-plan.json 真不真存在，brain 完全不验。

## 2. 修法

proposer 节点 spawn 容器跑完后、return 前，主动调 `fetchAndShowOriginFile(worktreePath, proposeBranch, sprintDir+'/task-plan.json')` 验证：

- 验证通过 → 节点正常 return propose_branch
- 验证失败 → throw Error 让 LangGraph retryPolicy 重试节点

graph compile 时给 proposer 节点加 `retryPolicy: LLM_RETRY`（已有）：3 次重试，exponential backoff，rolls 过瞬时网络抖动，永久 push 失败仍 fail（强信号曝露 push creds 问题）。

具体改动：

**packages/brain/src/workflows/harness-gan.graph.js**

1. 加 import：
```js
import { fetchAndShowOriginFile } from '../lib/git-fence.js';
import { LLM_RETRY } from './retry-policies.js';
```

2. proposer 节点 return 前加 verify：
```js
// H10: brain 主动验证 proposer 容器真把 propose_branch + task-plan.json 推到 origin。
// docker exit_code=0 ≠ 节点 success（contract enforcement 第一层）。
try {
  await fetchAndShowOriginFile(worktreePath, proposeBranch, `${sprintDir}/task-plan.json`);
} catch (err) {
  throw new Error(`proposer_didnt_push: branch ${proposeBranch} 不存在或缺 task-plan.json: ${err.message}`);
}

return { round: nextRound, ... };
```

3. graph compile 处加 retryPolicy：
```js
.addNode('proposer', nodes.proposer, { retryPolicy: LLM_RETRY })
```

## 3. 不动什么

- reviewer 节点不动
- inferTaskPlan / sub-task graph 不动
- proposer 容器内部 SKILL（packages/workflows/skills/harness-contract-proposer/SKILL.md）不动
- 现有 task-plan.json 本地 access warn（line 391-397）保留（向后兼容；新加的 origin verify 是更强 check）
- GanContractState schema 不变（不引入 needs_retry / error 字段；用 throw + retryPolicy 是更 idiomatic 做法）

## 4. 测试策略

按 Cecelia 测试金字塔：H10 改动跨多模块（harness-gan.graph.js + retry policy），属于 **integration 类**（多模块行为）+ proposer 节点 行为变化。但单元行为可以 mock fetchAndShowOriginFile 通过 spy 验证。

### 测试

`tests/brain/h10-proposer-verify-push.test.js`（vitest，新增）：

- **test A — proposer 节点：origin verify 通过 → 正常 return propose_branch**
  - mock executor return exit_code=0 + 含 propose_branch 的 stdout
  - mock fetchAndShowOriginFile resolve 不抛
  - 期望节点 return 含 proposeBranch / round / costUsd 等

- **test B — proposer 节点：origin verify 失败 → throw 'proposer_didnt_push'**
  - mock executor return exit_code=0
  - mock fetchAndShowOriginFile reject Error('git show failed: ENOENT')
  - 期望节点 throw Error，message 含 `proposer_didnt_push` + branch 名 + 原 err.message

- **test C — proposer 节点：原有 exit_code 非 0 仍 throw `proposer_failed`**（不破坏既有行为）
  - mock executor return exit_code=1
  - 期望 throw Error('proposer_failed: ...')

`fetchAndShowOriginFile` 通过 ctx.fetchOriginFile（或类似 DI）注入 spy。如 buildGanGraphNodes 当前不支持 DI fetchOriginFile，改动里加一个 `opts.fetchOriginFile` 参数（默认 = 真 fetchAndShowOriginFile）。

### 不做 docker E2E

CI 没 docker runtime；W8 v11 真跑（合并后手动）兜住 integration 行为。

## 5. DoD

- [BEHAVIOR] proposer 节点 origin verify 失败时 throw Error 含 'proposer_didnt_push'
  Test: tests/brain/h10-proposer-verify-push.test.js
- [BEHAVIOR] proposer 节点 origin verify 通过时正常 return propose_branch
  Test: tests/brain/h10-proposer-verify-push.test.js
- [BEHAVIOR] proposer 节点原有 exit_code≠0 throw 'proposer_failed' 行为保留
  Test: tests/brain/h10-proposer-verify-push.test.js
- [ARTIFACT] harness-gan.graph.js 含 import fetchAndShowOriginFile + LLM_RETRY + 'proposer_didnt_push' 字面量 + addNode 带 retryPolicy: LLM_RETRY
  Test: manual:node -e 检查
- [ARTIFACT] 测试文件存在
  Test: manual:node -e require('fs').accessSync

## 6. 合并后真实证（手动）

1. brain redeploy
2. 跑 W8 v11 一次：
   - proposer r1 push 成功 → graph 推进到 reviewer
   - 模拟 push 失败场景（如临时改 PUSH 模拟错）→ 节点 retry 3 次后 fail，错误 'proposer_didnt_push' 暴露
3. PG 查 task_events proposer 节点 stderr 含明确 'proposer_didnt_push' 而非 silent 推到 inferTaskPlan

## 7. 不做（明确范围）

- ❌ 不引入 needs_retry / error 字段到 GanContractState（throw + retryPolicy 是 idiomatic 做法）
- ❌ 不动 inferTaskPlan / sub-task graph / reviewer
- ❌ 不动 proposer 容器内部 SKILL
- ❌ 不引入完整 contract enforcement layer（stage 2 范围 — 抽 packages/brain/src/lib/contract-verify.js）
- ❌ 不做 H7/H9/H8（已合 PR）
