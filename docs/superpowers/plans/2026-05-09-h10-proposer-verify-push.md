# H10 proposer verify origin push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal**: proposer 节点 spawn 容器跑完后、return 前主动调 `fetchAndShowOriginFile(worktreePath, proposeBranch, sprintDir+'/task-plan.json')` 验证 push 真发生；失败 throw `proposer_didnt_push: ...`，graph compile 处给 proposer 节点加 `retryPolicy: LLM_RETRY` 让 LangGraph 自动重试 3 次。

**Architecture**: 改 `packages/brain/src/workflows/harness-gan.graph.js` —— (1) 加 import fetchAndShowOriginFile + LLM_RETRY；(2) `createGanContractNodes(executor, ctx)` 的 ctx 加 `fetchOriginFile = fetchAndShowOriginFile` DI 默认；(3) proposer 节点 return 前 try/catch 调 fetchOriginFile，失败 throw；(4) buildHarnessGanGraph 内 `addNode('proposer', nodes.proposer, { retryPolicy: LLM_RETRY })`。

**Tech Stack**: Node.js / vitest / LangGraph

**Spec**: `docs/superpowers/specs/2026-05-09-h10-proposer-verify-push-design.md`

**Brain task**: 9f2e58dd-86ac-4738-9c89-6d3c8fce281f

---

## File Structure

- **Create**: `cp-0509152359-h10-proposer-verify-push.prd.md`
- **Create**: `cp-0509152359-h10-proposer-verify-push.dod.md`
- **Create**: `tests/brain/h10-proposer-verify-push.test.js`
- **Modify**: `packages/brain/src/workflows/harness-gan.graph.js`（imports + ctx DI + proposer return 前 verify + addNode retryPolicy）
- **Create**: `docs/learnings/cp-0509152359-h10-proposer-verify-push.md`

---

### Task 1: PRD + DoD（commit 1）

**Files**:
- Create: `cp-0509152359-h10-proposer-verify-push.prd.md`
- Create: `cp-0509152359-h10-proposer-verify-push.dod.md`

- [ ] **Step 1.1**：写 PRD（worktree 根目录）

```markdown
# PRD: H10 proposer 节点 verify origin push

**Brain task**: 9f2e58dd-86ac-4738-9c89-6d3c8fce281f
**Spec**: docs/superpowers/specs/2026-05-09-h10-proposer-verify-push-design.md
**Sprint**: langgraph-contract-enforcement / Stage 1 (4/4)

## 背景

W8 v10 跑里 proposer r3 容器 exit=0 但 cp-harness-propose-r3-* 分支没 push 到 origin → inferTaskPlan 节点 git show 失败 → graph 卡死。brain 把 docker exit_code=0 等同节点 success，没主动验证 proposer 实际产出的远端 branch + task-plan.json。

## 修法

harness-gan.graph.js：
1. import fetchAndShowOriginFile + LLM_RETRY
2. createGanContractNodes ctx 加 fetchOriginFile DI（默认 = fetchAndShowOriginFile）
3. proposer 节点 return 前调 fetchOriginFile(worktreePath, proposeBranch, sprintDir+'/task-plan.json')，失败 throw 'proposer_didnt_push: ...'
4. buildHarnessGanGraph 给 proposer 节点加 retryPolicy: LLM_RETRY（3 次 backoff retry）

## 成功标准

- proposer 容器 exit=0 但 origin 没 propose_branch + task-plan.json 时，节点 throw 'proposer_didnt_push'，LangGraph retry 3 次后整 graph fail（强信号曝露 push creds 问题，不是 silent 推到 inferTaskPlan）
- proposer push 成功时节点正常 return

## 不做

- 不改 reviewer / inferTaskPlan / sub-task graph
- 不引入 needs_retry / error 字段到 GanContractState（throw + retryPolicy 是 idiomatic）
- 不动 proposer 容器内部 SKILL
- 不引入完整 contract enforcement layer（stage 2 范围）
```

- [ ] **Step 1.2**：写 DoD

```markdown
# DoD: H10 proposer 节点 verify origin push

## 验收清单

- [ ] [BEHAVIOR] proposer 节点 origin verify 失败时 throw Error 含 'proposer_didnt_push'
  Test: tests/brain/h10-proposer-verify-push.test.js

- [ ] [BEHAVIOR] proposer 节点 origin verify 通过时正常 return propose_branch
  Test: tests/brain/h10-proposer-verify-push.test.js

- [ ] [BEHAVIOR] proposer 节点原有 exit_code≠0 throw 'proposer_failed' 行为保留
  Test: tests/brain/h10-proposer-verify-push.test.js

- [ ] [ARTIFACT] harness-gan.graph.js 含 import fetchAndShowOriginFile + LLM_RETRY + 'proposer_didnt_push' 字面量 + addNode 带 retryPolicy: LLM_RETRY
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-gan.graph.js','utf8');if(!/fetchAndShowOriginFile/.test(c))process.exit(1);if(!/LLM_RETRY/.test(c))process.exit(1);if(!/proposer_didnt_push/.test(c))process.exit(1);if(!/addNode\('proposer'[^)]+retryPolicy/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 测试文件存在
  Test: manual:node -e "require('fs').accessSync('tests/brain/h10-proposer-verify-push.test.js')"

## Learning

文件: docs/learnings/cp-0509152359-h10-proposer-verify-push.md

## 测试命令

​```bash
npx vitest run tests/brain/h10-proposer-verify-push.test.js
​```
```

- [ ] **Step 1.3**：commit

```bash
cd /Users/administrator/worktrees/cecelia/h10-proposer-verify-push
git add cp-0509152359-h10-proposer-verify-push.prd.md cp-0509152359-h10-proposer-verify-push.dod.md
git commit -m "docs: H10 proposer verify origin push PRD + DoD"
```

---

### Task 2: Failing vitest test（commit 2，TDD red）

**Files**:
- Create: `tests/brain/h10-proposer-verify-push.test.js`

- [ ] **Step 2.1**：写测试

```javascript
// SPDX-License-Identifier: MIT
// Test for H10: proposer 节点末尾 verify origin push。
// 容器 exit=0 不等于节点 success — brain 必须主动验证 propose_branch + task-plan.json 真在 origin。

import { describe, test, expect, vi } from 'vitest';
import path from 'node:path';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createGanContractNodes } from '../../packages/brain/src/workflows/harness-gan.graph.js';

function makeCtx(overrides = {}) {
  // 给一个 worktreePath 真目录 + sprintDir 真子目录 + contract-draft.md 真文件，
  // 让 readContractFile 能成功读到（不污染节点行为）。
  const dir = mkdtempSync(path.join(tmpdir(), 'h10-test-'));
  const sprintDir = 'sprints/test';
  mkdirSync(path.join(dir, sprintDir), { recursive: true });
  writeFileSync(path.join(dir, sprintDir, 'contract-draft.md'), '# fake contract');
  return {
    taskId: 'task-h10',
    initiativeId: 'init-h10',
    sprintDir,
    worktreePath: dir,
    githubToken: 'gh-token',
    budgetCapUsd: 10,
    readContractFile: async () => '# fake contract',
    ...overrides,
  };
}

const PROPOSER_STDOUT_OK = 'log\n{"verdict":"PROPOSED","propose_branch":"cp-harness-propose-r1-task-h10"}\n';

describe('H10 — proposer 节点 verify origin push', () => {
  test('origin verify 通过 → 正常 return propose_branch', async () => {
    const executor = vi.fn().mockResolvedValue({
      exit_code: 0,
      stdout: PROPOSER_STDOUT_OK,
      stderr: '',
      cost_usd: 0,
    });
    const fetchOriginFile = vi.fn().mockResolvedValue('{"tasks":[]}');
    const { proposer } = createGanContractNodes(executor, makeCtx({ fetchOriginFile }));
    const result = await proposer({ round: 0, prdContent: '#prd' });
    expect(result.proposeBranch).toBe('cp-harness-propose-r1-task-h10');
    expect(fetchOriginFile).toHaveBeenCalledOnce();
    expect(fetchOriginFile.mock.calls[0][1]).toBe('cp-harness-propose-r1-task-h10');
    expect(fetchOriginFile.mock.calls[0][2]).toContain('task-plan.json');
  });

  test('origin verify 失败 → throw proposer_didnt_push 含 branch 名 + 原 err', async () => {
    const executor = vi.fn().mockResolvedValue({
      exit_code: 0,
      stdout: PROPOSER_STDOUT_OK,
      stderr: '',
      cost_usd: 0,
    });
    const fetchOriginFile = vi.fn().mockRejectedValue(new Error('git show failed: ENOENT'));
    const { proposer } = createGanContractNodes(executor, makeCtx({ fetchOriginFile }));

    await expect(proposer({ round: 0, prdContent: '#prd' })).rejects.toThrow(/proposer_didnt_push/);
    await expect(proposer({ round: 0, prdContent: '#prd' })).rejects.toThrow(/cp-harness-propose-r1-task-h10/);
    await expect(proposer({ round: 0, prdContent: '#prd' })).rejects.toThrow(/git show failed: ENOENT/);
  });

  test('原有 exit_code≠0 仍 throw proposer_failed（不被新逻辑破坏）', async () => {
    const executor = vi.fn().mockResolvedValue({
      exit_code: 1,
      stdout: '',
      stderr: 'docker died',
      cost_usd: 0,
    });
    const fetchOriginFile = vi.fn();
    const { proposer } = createGanContractNodes(executor, makeCtx({ fetchOriginFile }));

    await expect(proposer({ round: 0, prdContent: '#prd' })).rejects.toThrow(/proposer_failed/);
    expect(fetchOriginFile).not.toHaveBeenCalled();  // 容器失败时不该 verify origin
  });
});
```

- [ ] **Step 2.2**：跑测试，期待 FAIL

```bash
cd /Users/administrator/worktrees/cecelia/h10-proposer-verify-push
mkdir -p tests/brain
npx vitest run tests/brain/h10-proposer-verify-push.test.js 2>&1 | tail -25
```

期望：
- 测试 1 (verify 通过) FAIL（fetchOriginFile 还没被调用）
- 测试 2 (verify 失败 throw) FAIL（proposer 不 throw proposer_didnt_push，因为没 verify）
- 测试 3 (exit_code≠0) PASS（pre-fix 已抛 proposer_failed）

- [ ] **Step 2.3**：commit (TDD red)

```bash
git add tests/brain/h10-proposer-verify-push.test.js
git commit -m "test(brain): add failing tests for H10 proposer verify origin push"
```

---

### Task 3: Impl（commit 3，TDD green）

**Files**:
- Modify: `packages/brain/src/workflows/harness-gan.graph.js`

- [ ] **Step 3.1**：先 Read line 1-50 看现有 imports 位置

- [ ] **Step 3.2**：加 imports

找现有 import 块（约 line 22-30），在末尾加：

```js
import { fetchAndShowOriginFile } from '../lib/git-fence.js';
import { LLM_RETRY } from './retry-policies.js';
```

具体位置：跟其他 lib import 同区。

- [ ] **Step 3.3**：createGanContractNodes ctx 加 fetchOriginFile DI

old_string（精确匹配）:
```js
  const {
    taskId, initiativeId, sprintDir, worktreePath, githubToken,
    budgetCapUsd = 10,
    readContractFile = defaultReadContractFile,
  } = ctx;
```
new_string:
```js
  const {
    taskId, initiativeId, sprintDir, worktreePath, githubToken,
    budgetCapUsd = 10,
    readContractFile = defaultReadContractFile,
    fetchOriginFile = fetchAndShowOriginFile,
  } = ctx;
```

- [ ] **Step 3.4**：proposer 节点 return 前加 verify

old_string（精确匹配，含上下文）:
```js
    return {
      round: nextRound,
      costUsd: (state.costUsd || 0) + Number(result.cost_usd || 0),
      contractContent,
      proposeBranch,
    };
  }

  async function reviewer(state) {
```
new_string:
```js
    // H10: brain 主动验证 proposer 容器真把 propose_branch + task-plan.json 推到 origin。
    // docker exit_code=0 ≠ 节点 success（contract enforcement 第一层）。
    // 失败时 throw → LangGraph retryPolicy: LLM_RETRY 自动重试 3 次。
    try {
      await fetchOriginFile(worktreePath, proposeBranch, `${sprintDir}/task-plan.json`);
    } catch (err) {
      throw new Error(`proposer_didnt_push: branch ${proposeBranch} 不存在或缺 task-plan.json: ${err.message}`);
    }

    return {
      round: nextRound,
      costUsd: (state.costUsd || 0) + Number(result.cost_usd || 0),
      contractContent,
      proposeBranch,
    };
  }

  async function reviewer(state) {
```

- [ ] **Step 3.5**：graph compile 给 proposer 节点加 retryPolicy

先 Read line 488-500 找 `addNode('proposer', nodes.proposer)` 行。然后 Edit。

old_string:
```js
    .addNode('proposer', nodes.proposer)
```
new_string:
```js
    .addNode('proposer', nodes.proposer, { retryPolicy: LLM_RETRY })
```

- [ ] **Step 3.6**：跑 test 期待 PASS

```bash
cd /Users/administrator/worktrees/cecelia/h10-proposer-verify-push
npx vitest run tests/brain/h10-proposer-verify-push.test.js 2>&1 | tail -10
```

期望：3/3 PASS

- [ ] **Step 3.7**：跑 ARTIFACT 检查

```bash
node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-gan.graph.js','utf8');if(!/fetchAndShowOriginFile/.test(c))process.exit(1);if(!/LLM_RETRY/.test(c))process.exit(1);if(!/proposer_didnt_push/.test(c))process.exit(1);if(!/addNode\('proposer'[^)]+retryPolicy/.test(c))process.exit(1);console.log('ARTIFACT_OK')"
```

期望：`ARTIFACT_OK`

- [ ] **Step 3.8**：跑现有 GAN 测试不破坏

```bash
cd packages/brain
ls src/__tests__/ | grep -i gan
npx vitest run src/__tests__/ 2>&1 | grep -E "FAIL|×|harness-gan|✓.*gan" | head -20
cd ../..
```

期望：现有 GAN 测试仍 PASS（mock executor 行为不变）

如果现有 test mock 的 ctx 没传 fetchOriginFile（用了真 fetchAndShowOriginFile），可能会因 origin git show 失败 → throw → test 挂。这种情况下需要给现有 test 也加 mock fetchOriginFile（DI 注入 spy）。

**重要**：fetchAndShowOriginFile 真调时会 spawnSync git fetch + show。如果测试 worktreePath 是 mkdtemp 临时目录，git fetch origin 失败 → throw 被 H10 catch 转 `proposer_didnt_push` → 现有 test 期望 success 会挂。

→ 必须找现有 GAN 节点测试，给它们 ctx 加 `fetchOriginFile: vi.fn().mockResolvedValue('{}')` 或类似。

具体在 Task 3 执行时：grep 现有 createGanContractNodes 测试，逐个加 fetchOriginFile mock。

- [ ] **Step 3.9**：commit (TDD green)

```bash
git add packages/brain/src/workflows/harness-gan.graph.js packages/brain/src/__tests__/*.test.js  # 后者如果有改动
git commit -m "fix(brain): proposer 节点 verify origin push (H10) — throw proposer_didnt_push + retryPolicy LLM_RETRY"
```

---

### Task 4: DoD checked + Learning（commit 4）

**Files**:
- Modify: `cp-0509152359-h10-proposer-verify-push.dod.md`
- Create: `docs/learnings/cp-0509152359-h10-proposer-verify-push.md`

- [ ] **Step 4.1**：DoD 5 项 `[ ]` → `[x]`

```bash
sed -i '' 's/- \[ \]/- [x]/g' cp-0509152359-h10-proposer-verify-push.dod.md
grep -c '\- \[x\]' cp-0509152359-h10-proposer-verify-push.dod.md
```

期望：`5`

- [ ] **Step 4.2**：写 Learning

```markdown
# Learning: H10 — proposer 节点 verify origin push

**PR**: cp-0509152359-h10-proposer-verify-push
**Sprint**: langgraph-contract-enforcement / Stage 1（4/4 收官）

## 现象

W8 v10 跑里 proposer r3 容器 exit=0 但 cp-harness-propose-r3-* 分支没 push 到 origin → inferTaskPlan 节点 git show 失败 → graph 卡死。看 stderr 没明确 root cause，14h 诊断绕远路。

### 根本原因

brain 把 docker `exit_code=0` 直接等同于节点 success。proposer 节点跑完只读容器 stdout（解析 propose_branch）和本地 worktree（读 contractContent + access task-plan.json），但 origin 上 branch + task-plan.json 真不真存在 brain 完全不验。proposer 容器内部 SKILL 的 git push 失败被 set -e 静默吞，或某些 race 让本地 commit 但没 push 到 origin —— brain 看不出区别。

哲学层根因：LangGraph 节点是 (state) → state_delta 形态时，节点的"成功"应基于**实际副作用 happened** 而不是**子进程 exit code**。LLM/容器节点必须在 return 前显式 verify 它该交付的产出（push、PR、commit、API call 等）。这是 LangGraph community standard "Best Practices for Agent Loop"。Stage 2 应抽 packages/brain/src/lib/contract-verify.js 把这层显式化。

### 下次预防

- [ ] 任何 LangGraph 节点跟 LLM/容器交互产出"远端副作用"（git push / PR create / API call），return 前必须 brain-side verify
- [ ] LLM/容器节点 default 加 retryPolicy: LLM_RETRY，让瞬时网络抖动不让 graph fail
- [ ] PR review 凡涉及 LangGraph 节点改动，问"它的副作用是什么 / brain 怎么验"
```

- [ ] **Step 4.3**：commit

```bash
git add cp-0509152359-h10-proposer-verify-push.dod.md docs/learnings/cp-0509152359-h10-proposer-verify-push.md
git commit -m "docs: H10 DoD checked + Learning"
```

---

### Task 5: Push + PR + foreground CI wait（controller 做）

略 — controller 在 finishing 做。

---

## Self-Review

**Spec coverage**：spec §2 修法（imports / ctx DI / proposer verify / retryPolicy）→ Task 3.2-3.5 全覆盖；§3 不动什么 → Task 3 严守；§4 测试策略（3 BEHAVIOR + ARTIFACT 静态）→ Task 2 + Task 3.7；§5 DoD 5 项 → Task 1.2 + Task 4.1；§6 合并后真实证 → 不在 plan 范围；§7 不做 → Task 3 仅碰 1 文件 ✓

**Placeholder scan**：无 TBD/TODO，每 step 给具体代码、命令、期望输出 ✓

**Type consistency**：
- `fetchOriginFile` / `fetchAndShowOriginFile` / `LLM_RETRY` / `proposer_didnt_push` / `proposer_failed` 命名在 spec/plan/PRD/DoD/test 全部一致
- 测试文件路径 `tests/brain/h10-proposer-verify-push.test.js` 一致 ✓

**TDD iron law**：Task 2 commit-1 = fail test，Task 3 commit-2 = impl，顺序对 ✓

**lint-tdd-commit-order**：Task 2 改 tests/brain/，Task 3 改 brain/src/，commit 时间顺序 Task 2 → Task 3 ✓

**lint-test-pairing**：Task 2 写 tests/brain/h10-*.test.js 覆盖 Task 3 改的 brain/src/workflows/harness-gan.graph.js ✓

**潜在风险（implementer 注意）**：现有 createGanContractNodes 测试如果未传 fetchOriginFile DI 会跑真 git fetch → 在 mkdtemp worktree 失败 → throw proposer_didnt_push → 既有 test 期望 success 会挂。必须在 Task 3.8 时找到这些测试加 fetchOriginFile mock。
