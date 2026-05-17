# B39 Evaluator Verdict Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 harness pipeline 三个 Bug：evaluator "FIXED" 被误判 FAIL 导致无限 fix loop、`gh pr merge --auto` 在不支持 auto-merge 的仓库报错、`evaluate_contract` 的 LLM_RETRY 导致并发 evaluator 容器爆炸。

**Architecture:** 所有改动集中在 `packages/brain/src/workflows/harness-task.graph.js` 一个文件（4 处修改）。提取 `normalizeVerdict(raw)` 纯函数并导出，供 Protocol v1 和 v2 两条路径共用；去掉 `merge` 命令的 `--auto` 标志；去掉 `evaluate_contract` 节点的 `retryPolicy`。

**Tech Stack:** Node.js, vitest, LangGraph, @langchain/langgraph

---

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/brain/src/workflows/harness-task.graph.js` | Modify | 4 处修改 + 提取 normalizeVerdict |
| `packages/brain/src/__tests__/harness-task-verdict.test.js` | Create | 新增单元测试 |

---

## Task 1: 写失败单元测试

**Files:**
- Create: `packages/brain/src/__tests__/harness-task-verdict.test.js`

**背景：** `normalizeVerdict` 函数尚不存在，import 会失败 → 测试 FAIL。`mergePrNode` 当前包含 `--auto`，arg 检查会 FAIL。这是 TDD 第一步：先写红测试，再写实现。

- [ ] **Step 1: 运行 DevGate 预检**

```bash
cd /Users/administrator/worktrees/cecelia/b39-evaluator-verdict-fix
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/engine/scripts/devgate/check-dod-mapping.cjs
```

预期：三个命令均 exit 0（不报错）。如有报错先修再继续。

- [ ] **Step 2: 创建测试文件（期望 import 失败）**

创建 `packages/brain/src/__tests__/harness-task-verdict.test.js`，内容：

```js
import { describe, it, expect } from 'vitest';
import { normalizeVerdict, mergePrNode } from '../workflows/harness-task.graph.js';

describe('normalizeVerdict — Protocol v1 + v2 统一标准化', () => {
  it('"FIXED" → "PASS"', () => {
    expect(normalizeVerdict('FIXED')).toBe('PASS');
  });

  it('"APPROVED" → "PASS"', () => {
    expect(normalizeVerdict('APPROVED')).toBe('PASS');
  });

  it('"PASS" → "PASS"', () => {
    expect(normalizeVerdict('PASS')).toBe('PASS');
  });

  it('"FAIL" → "FAIL"', () => {
    expect(normalizeVerdict('FAIL')).toBe('FAIL');
  });

  it('"GARBAGE" → "FAIL"', () => {
    expect(normalizeVerdict('GARBAGE')).toBe('FAIL');
  });

  it('空字符串 → "FAIL"', () => {
    expect(normalizeVerdict('')).toBe('FAIL');
  });

  it('大小写不敏感：lowercase "fixed" → "PASS"', () => {
    expect(normalizeVerdict('fixed')).toBe('PASS');
  });
});

describe('mergePrNode — 合并命令不含 --auto', () => {
  it('gh pr merge 参数不含 --auto', async () => {
    const captured = [];
    const execFn = async (_cmd, args) => {
      captured.push(...args);
      return { stdout: 'PR merged' };
    };
    const state = { pr_url: 'https://github.com/perfectuser21/cecelia/pull/999' };
    await mergePrNode(state, { execFile: execFn });
    expect(captured).not.toContain('--auto');
    expect(captured).toContain('--squash');
    expect(captured).toContain('--delete-branch');
  });
});
```

- [ ] **Step 3: 运行测试，确认失败**

```bash
cd /Users/administrator/worktrees/cecelia/b39-evaluator-verdict-fix
npx vitest run packages/brain/src/__tests__/harness-task-verdict.test.js --reporter=verbose 2>&1 | tail -30
```

预期：FAIL，原因是 `normalizeVerdict` 不是 `harness-task.graph.js` 的导出项（import 报错或 undefined）。

- [ ] **Step 4: Commit 红测试**

```bash
cd /Users/administrator/worktrees/cecelia/b39-evaluator-verdict-fix
git add packages/brain/src/__tests__/harness-task-verdict.test.js
git commit -m "test(harness): add failing unit tests for verdict normalization and merge args

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: 实现 4 处修改让测试变绿

**Files:**
- Modify: `packages/brain/src/workflows/harness-task.graph.js`

**背景：** 找到 4 处需要修改的位置：
- 提取 `normalizeVerdict` 纯函数（Protocol v1 + v2 共用）
- Protocol v2 fileVerdict 路径（约第 594 行）
- Protocol v1 stdout 路径（约第 605 行）
- merge 命令去掉 `--auto`（约第 402、411 行）
- evaluate_contract 去掉 retryPolicy（约第 627 行）

- [ ] **Step 1: 在文件顶部附近提取 normalizeVerdict 并 export**

在 `harness-task.graph.js` 文件中，找到现有导出常量区域（`MAX_FIX_ROUNDS` 附近，约第 64-70 行），在其后添加 `normalizeVerdict` 函数：

找到：
```js
export const MAX_POLL_COUNT = 20;          // 90s × 20 = 30 min
export const POLL_INTERVAL_MS = 90 * 1000;
```

在其后添加：
```js
export function normalizeVerdict(raw) {
  const upper = raw ? String(raw).toUpperCase().trim() : '';
  return new Set(['PASS', 'FIXED', 'APPROVED']).has(upper) ? 'PASS' : 'FAIL';
}
```

- [ ] **Step 2: 修复 Protocol v2 fileVerdict 路径（约第 593-598 行）**

找到：
```js
  if (state.worktreePath) {
    const fileVerdict = await readVerdictFile(state.worktreePath);
    if (fileVerdict) {
      return {
        evaluate_verdict: fileVerdict.verdict,
        evaluate_error: fileVerdict.verdict === 'FAIL' ? (fileVerdict.feedback || 'evaluator returned FAIL') : null,
      };
    }
  }
```

替换为：
```js
  if (state.worktreePath) {
    const fileVerdict = await readVerdictFile(state.worktreePath);
    if (fileVerdict) {
      const normV = normalizeVerdict(fileVerdict.verdict);
      return {
        evaluate_verdict: normV,
        evaluate_error: normV === 'FAIL' ? (fileVerdict.feedback || 'evaluator returned FAIL') : null,
      };
    }
  }
```

- [ ] **Step 3: 修复 Protocol v1 stdout 路径（约第 603-605 行）**

找到：
```js
  const verdictRaw = extractField(stdout, 'verdict');
  const verdictUpper = verdictRaw ? String(verdictRaw).toUpperCase().trim() : '';
  const verdict = (verdictUpper === 'PASS' || verdictUpper === 'FAIL') ? verdictUpper : 'FAIL';
```

替换为：
```js
  const verdictRaw = extractField(stdout, 'verdict');
  const verdict = normalizeVerdict(verdictRaw);
```

- [ ] **Step 4: 修复 merge 命令去掉 --auto（约第 402、411 行）**

找到：
```js
      ['pr', 'merge', prUrl, '--auto', '--squash', '--delete-branch'],
```

替换为：
```js
      ['pr', 'merge', prUrl, '--squash', '--delete-branch'],
```

同一函数内，找到：
```js
      merge_command: 'gh pr merge --auto --squash',
```

替换为：
```js
      merge_command: 'gh pr merge --squash',
```

- [ ] **Step 5: 去掉 evaluate_contract 的 retryPolicy（约第 627 行）**

找到：
```js
    .addNode('evaluate_contract', evaluateContractNode, { retryPolicy: LLM_RETRY })
```

替换为：
```js
    .addNode('evaluate_contract', evaluateContractNode)
```

- [ ] **Step 6: 运行单元测试，确认全绿**

```bash
cd /Users/administrator/worktrees/cecelia/b39-evaluator-verdict-fix
npx vitest run packages/brain/src/__tests__/harness-task-verdict.test.js --reporter=verbose 2>&1 | tail -30
```

预期：8 tests PASS（7 normalizeVerdict + 1 mergePrNode）。

- [ ] **Step 7: 运行相关测试套件确认无回归**

```bash
cd /Users/administrator/worktrees/cecelia/b39-evaluator-verdict-fix
npx vitest run packages/brain/src/__tests__/harness-gan-graph.test.js packages/brain/src/__tests__/harness-pipeline.test.ts packages/brain/src/__tests__/harness-utils.test.js packages/brain/src/__tests__/harness-shared-b39.test.js --reporter=verbose 2>&1 | tail -40
```

预期：全部 PASS。如有失败，先修复再继续。

- [ ] **Step 8: Commit 实现**

```bash
cd /Users/administrator/worktrees/cecelia/b39-evaluator-verdict-fix
git add packages/brain/src/workflows/harness-task.graph.js
git commit -m "fix(harness): B39 evaluator verdict normalization + remove --auto merge + remove evaluate_contract LLM_RETRY

- normalizeVerdict(): accept FIXED/APPROVED as PASS (Protocol v1 + v2)
- mergePrNode: remove --auto flag (auto-merge not enabled in repo)
- evaluate_contract: remove retryPolicy LLM_RETRY (prevents concurrent container explosion)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```
