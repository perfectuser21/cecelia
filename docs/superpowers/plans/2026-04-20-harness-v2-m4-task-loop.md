# Harness v2 M4 — Task 级循环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 改造 Harness v2 阶段 B — Task 级循环：Generator 两模式（新建 PR / Fix 同分支 commit）、CI Gate 非 LLM 节点、Evaluator 去 E2E 改为对抗 QA、撤销 PR #2420 的 Workstream 循环。

**Architecture:** `harness-graph.js` 保持线性图（不上 subgraph）但 Generator 节点根据 `state.eval_round` 切换两模式；在 `generator` 和 `evaluator` 之间插入新的非 LLM `ci_gate` 节点用 `harness-ci-gate.js` 轮询 GitHub Actions；Evaluator SKILL.md 四处同步，移除所有起 Brain 5222 / curl 回写指令，改为 unit/integration/对抗 QA 模板。

**Tech Stack:** LangGraph + Docker executor（保留）+ 新模块 `harness-ci-gate.js`（gh CLI 轮询）；测试 vitest + mock。

---

## File Structure

**Modify**：
- `packages/brain/src/harness-graph.js` — Generator 去 WS 循环 + 加 isFixMode；Evaluator 去 WS 循环 + 去 E2E prompt；加 ci_gate 节点；HarnessState 删 WS 字段；buildHarnessGraph 插入 ci_gate 边
- `~/.claude-account1/skills/harness-generator/SKILL.md` + 3 副本 — 明确两模式
- `~/.claude-account1/skills/harness-evaluator/SKILL.md` + 3 副本 — 去 E2E

**Create**：
- `packages/brain/src/harness-ci-gate.js` — pollPRChecks(prUrl, opts)
- `packages/brain/src/__tests__/harness-ci-gate.test.js` — mock gh CLI
- `packages/brain/src/__tests__/harness-graph-v2-flow.test.js` — Generator 两模式 + CI gate 路由
- `docs/learnings/cp-04200010-harness-v2-m4-task-loop.md` — Learning

**Do NOT touch**：
- Docker executor (`docker-runner.js` / `executor.js` §2.9)
- M5-scoped 代码（harness-final-e2e.js 等）
- Proposer / Reviewer 节点（M3 已做）

---

## Task 1: 新建 harness-ci-gate.js

**Files:**
- Create: `packages/brain/src/harness-ci-gate.js`

- [ ] **Step 1: 写 pollPRChecks 函数**

```js
/**
 * Harness v2 M4 — CI Gate 非 LLM 节点
 *
 * 轮询 GitHub Actions 状态，供 harness-graph.js 的 ci_gate 节点调用。
 * 不跑 Docker，不调 LLM — 纯 gh CLI 查询。
 *
 * 三个返回状态：
 *   - { status: 'PASS', checks }          — 所有 required check 为 SUCCESS
 *   - { status: 'FAIL', failedCheck, logSnippet } — 任一 check 为 FAILURE
 *   - { status: 'TIMEOUT' }               — 超过 timeoutMs（默认 30 min）
 *
 * Usage:
 *   const result = await pollPRChecks(prUrl, { intervalMs: 30000, timeoutMs: 1800000 });
 */

import { execSync } from 'child_process';

const DEFAULT_INTERVAL_MS = 30 * 1000;       // 30 秒
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;   // 30 分钟
const LOG_SNIPPET_MAX_BYTES = 4000;

/**
 * 跑一次 gh pr checks --json，返回解析后的数组。
 * 注入点：opts.exec 可替换（测试用）。
 *
 * @returns {Array<{name, state, bucket, workflow, link}>}
 */
function runGhChecks(prUrl, exec) {
  const raw = exec(
    `gh pr checks ${JSON.stringify(prUrl)} --json name,state,bucket,workflow,link --required`,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const str = typeof raw === 'string' ? raw : raw.toString('utf8');
  try {
    const arr = JSON.parse(str || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/**
 * 取某个失败 check 的日志片段（最多 4KB）。
 *
 * gh run view <run-id> --log-failed 会输出失败 job 的完整 log；
 * 我们截取最后 4KB 注入 Generator 的 Fix prompt。
 */
function fetchLogSnippet(link, exec) {
  if (!link) return '';
  // link 形如 https://github.com/<owner>/<repo>/actions/runs/<run_id>/job/<job_id>
  const m = link.match(/\/actions\/runs\/(\d+)(?:\/job\/(\d+))?/);
  if (!m) return '';
  const runId = m[1];
  try {
    const raw = exec(`gh run view ${runId} --log-failed`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 20 * 1024 * 1024,
    });
    const str = typeof raw === 'string' ? raw : raw.toString('utf8');
    return str.length > LOG_SNIPPET_MAX_BYTES
      ? str.slice(-LOG_SNIPPET_MAX_BYTES)
      : str;
  } catch (err) {
    return `(failed to fetch log: ${err.message})`;
  }
}

/**
 * 判别 checks 的整体状态。
 *
 * 规则：
 *   - 任一 check 为 fail / cancelled → FAIL
 *   - 所有 check 为 pass → PASS
 *   - 其他（含 pending / in_progress / queued） → PENDING
 *
 * gh pr checks 的 bucket 字段取值：pass | fail | pending | skipping | cancel
 */
export function classifyChecks(checks) {
  if (!Array.isArray(checks) || checks.length === 0) {
    return { overall: 'PENDING', failed: null };
  }
  const failed = checks.find((c) => {
    const b = (c.bucket || c.state || '').toLowerCase();
    return b === 'fail' || b === 'cancel' || b === 'cancelled' || b === 'failure';
  });
  if (failed) return { overall: 'FAIL', failed };
  const allPass = checks.every((c) => {
    const b = (c.bucket || c.state || '').toLowerCase();
    return b === 'pass' || b === 'success' || b === 'skipping' || b === 'skip';
  });
  if (allPass) return { overall: 'PASS', failed: null };
  return { overall: 'PENDING', failed: null };
}

/**
 * 主入口 — 轮询直到 PASS / FAIL / TIMEOUT。
 *
 * @param {string}    prUrl
 * @param {Object}    [opts]
 * @param {number}    [opts.intervalMs=30000]
 * @param {number}    [opts.timeoutMs=1800000]
 * @param {Function}  [opts.exec]     注入点（测试用）— 默认 child_process.execSync
 * @param {Function}  [opts.sleep]    注入点（测试用）— 默认 setTimeout promise
 * @returns {Promise<{status:'PASS'|'FAIL'|'TIMEOUT', checks?, failedCheck?, logSnippet?}>}
 */
export async function pollPRChecks(prUrl, opts = {}) {
  const intervalMs = Number.isFinite(opts.intervalMs) ? opts.intervalMs : DEFAULT_INTERVAL_MS;
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const exec = opts.exec || execSync;
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));

  if (!prUrl || typeof prUrl !== 'string') {
    return { status: 'FAIL', failedCheck: null, logSnippet: 'prUrl 缺失' };
  }

  const deadline = Date.now() + timeoutMs;
  let lastChecks = [];

  while (Date.now() < deadline) {
    try {
      lastChecks = runGhChecks(prUrl, exec);
    } catch (err) {
      // gh 命令本身失败（未登录/网络问题/PR 不存在）→ 当作 FAIL
      return {
        status: 'FAIL',
        failedCheck: null,
        logSnippet: `gh pr checks 失败: ${err.message}`,
      };
    }

    const { overall, failed } = classifyChecks(lastChecks);
    if (overall === 'PASS') {
      return { status: 'PASS', checks: lastChecks };
    }
    if (overall === 'FAIL') {
      const logSnippet = fetchLogSnippet(failed && failed.link, exec);
      return {
        status: 'FAIL',
        failedCheck: failed,
        logSnippet,
      };
    }

    await sleep(intervalMs);
  }

  return { status: 'TIMEOUT', checks: lastChecks };
}
```

- [ ] **Step 2: 确保无语法错误 + import cycle**

Run: `cd packages/brain && node --check src/harness-ci-gate.js`
Expected: 无输出、exit 0

- [ ] **Step 3: Commit**

```bash
git add packages/brain/src/harness-ci-gate.js
git commit -m "feat(brain): harness-ci-gate.js — pollPRChecks PASS/FAIL/TIMEOUT (M4)"
```

---

## Task 2: harness-ci-gate 单元测试

**Files:**
- Create: `packages/brain/src/__tests__/harness-ci-gate.test.js`

- [ ] **Step 1: 写 mock exec 的单元测试**

```js
import { describe, it, expect } from 'vitest';
import { pollPRChecks, classifyChecks } from '../harness-ci-gate.js';

// -- classifyChecks 单元测试 ------------------------------------------------

describe('classifyChecks', () => {
  it('空列表返回 PENDING', () => {
    expect(classifyChecks([]).overall).toBe('PENDING');
    expect(classifyChecks(null).overall).toBe('PENDING');
  });

  it('所有 pass → PASS', () => {
    const r = classifyChecks([
      { name: 'L1', bucket: 'pass' },
      { name: 'L2', bucket: 'pass' },
    ]);
    expect(r.overall).toBe('PASS');
    expect(r.failed).toBeNull();
  });

  it('任一 fail → FAIL 并返回失败项', () => {
    const r = classifyChecks([
      { name: 'L1', bucket: 'pass' },
      { name: 'L2', bucket: 'fail', link: 'https://x/actions/runs/1/job/2' },
    ]);
    expect(r.overall).toBe('FAIL');
    expect(r.failed.name).toBe('L2');
  });

  it('含 pending → PENDING', () => {
    const r = classifyChecks([
      { name: 'L1', bucket: 'pass' },
      { name: 'L2', bucket: 'pending' },
    ]);
    expect(r.overall).toBe('PENDING');
  });

  it('skipping 视为 pass', () => {
    const r = classifyChecks([
      { name: 'L1', bucket: 'pass' },
      { name: 'L2', bucket: 'skipping' },
    ]);
    expect(r.overall).toBe('PASS');
  });
});

// -- pollPRChecks 集成 mock ------------------------------------------------

/**
 * 构造一个 exec mock：
 *   - calls[] 按 gh pr checks 返回的值序列轮换
 *   - 遇到 "gh run view ... --log-failed" → 固定返回 mock log
 */
function buildExec({ checksSeq, failedLog = 'MOCK FAILED LOG' }) {
  let i = 0;
  return (cmd) => {
    if (cmd.includes('gh run view')) return failedLog;
    const next = checksSeq[Math.min(i, checksSeq.length - 1)];
    i++;
    return JSON.stringify(next);
  };
}

describe('pollPRChecks', () => {
  const sleep = async () => {}; // 不真 sleep

  it('所有 check pass → PASS', async () => {
    const exec = buildExec({
      checksSeq: [[{ name: 'L1', bucket: 'pass' }]],
    });
    const r = await pollPRChecks('https://github.com/o/r/pull/1', {
      exec,
      sleep,
      intervalMs: 1,
      timeoutMs: 10000,
    });
    expect(r.status).toBe('PASS');
    expect(Array.isArray(r.checks)).toBe(true);
  });

  it('check fail → FAIL 带 failedCheck + logSnippet', async () => {
    const exec = buildExec({
      checksSeq: [[
        { name: 'L1', bucket: 'pass' },
        { name: 'L2', bucket: 'fail', link: 'https://github.com/o/r/actions/runs/123/job/456' },
      ]],
      failedLog: 'Error: something bad',
    });
    const r = await pollPRChecks('https://github.com/o/r/pull/1', {
      exec,
      sleep,
      intervalMs: 1,
      timeoutMs: 10000,
    });
    expect(r.status).toBe('FAIL');
    expect(r.failedCheck.name).toBe('L2');
    expect(r.logSnippet).toContain('Error');
  });

  it('pending 超过 deadline → TIMEOUT', async () => {
    const exec = buildExec({
      checksSeq: [[{ name: 'L1', bucket: 'pending' }]],
    });
    const r = await pollPRChecks('https://github.com/o/r/pull/1', {
      exec,
      sleep,
      intervalMs: 1,
      timeoutMs: 3, // 3ms 立即超时
    });
    expect(r.status).toBe('TIMEOUT');
  });

  it('prUrl 缺失 → FAIL', async () => {
    const r = await pollPRChecks('', { exec: () => '[]', sleep });
    expect(r.status).toBe('FAIL');
    expect(r.logSnippet).toMatch(/prUrl/);
  });

  it('gh 命令抛错 → FAIL', async () => {
    const exec = () => {
      throw new Error('gh: not logged in');
    };
    const r = await pollPRChecks('https://github.com/o/r/pull/1', {
      exec,
      sleep,
      intervalMs: 1,
      timeoutMs: 100,
    });
    expect(r.status).toBe('FAIL');
    expect(r.logSnippet).toMatch(/gh pr checks 失败/);
  });

  it('pending 两次后 pass → PASS', async () => {
    const exec = buildExec({
      checksSeq: [
        [{ name: 'L1', bucket: 'pending' }],
        [{ name: 'L1', bucket: 'pending' }],
        [{ name: 'L1', bucket: 'pass' }],
      ],
    });
    const r = await pollPRChecks('https://github.com/o/r/pull/1', {
      exec,
      sleep,
      intervalMs: 1,
      timeoutMs: 10000,
    });
    expect(r.status).toBe('PASS');
  });
});
```

- [ ] **Step 2: 跑测试**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-ci-gate.test.js`
Expected: 全部 PASS

- [ ] **Step 3: Commit**

```bash
git add packages/brain/src/__tests__/harness-ci-gate.test.js
git commit -m "test(brain): harness-ci-gate.test.js — classifyChecks + pollPRChecks (M4)"
```

---

## Task 3: 改 harness-graph.js — HarnessState 删 WS 字段 + 加 ci_* 字段

**Files:**
- Modify: `packages/brain/src/harness-graph.js:89-121` (HarnessState)

- [ ] **Step 1: HarnessState 字段重写**

删除：`workstreams`/`pr_urls`/`pr_branches`/`ws_verdicts`/`ws_feedbacks`
保留：`pr_url`/`pr_branch`/`evaluator_verdict`/`eval_feedback`/`eval_round`
新增（M4）：
- `tasks` — M3 已加
- `commit_shas` — Fix 模式累积 commit（array）
- `ci_status` — 'pending'|'pass'|'fail'|'timeout'
- `ci_feedback` — CI FAIL 时 log 片段
- `ci_failed_check` — 失败 check 名
- `evaluator_feedback`（= eval_feedback alias，统一用 eval_feedback 即可，不加新字段）

- [ ] **Step 2: Commit**

```bash
git add packages/brain/src/harness-graph.js
git commit -m "refactor(brain): HarnessState 删 WS 字段 + 加 M4 ci_* 字段"
```

---

## Task 4: 改 harness-graph.js — Generator 单次执行 + 两模式 prompt

**Files:**
- Modify: `packages/brain/src/harness-graph.js:701-845` (generator 节点)

- [ ] **Step 1: 改写 Generator**

- 删除 `for (const wsIndex of targetIndexes)` 循环，Generator 单次执行一条 Task
- `isFixMode = (state.eval_round || 0) > 0`
- prompt 分两模式：
  - 新建 PR 模式：checkout 新分支 → commit → push → gh pr create → 输出 `pr_url` + `pr_branch`
  - Fix 模式：checkout **同一个** `state.pr_branch` → commit → push → 输出 `commit_sha`
- Fix 模式 prompt 写死约束："永远不要在 Fix 模式开新 PR"
- 从 `state.ci_feedback`（CI FAIL 时）或 `state.eval_feedback`（Evaluator FAIL 时）注入反馈

- [ ] **Step 2: Commit**

```bash
git add packages/brain/src/harness-graph.js
git commit -m "refactor(brain): Generator 去 WS 循环 + 两模式 prompt (新建/Fix)"
```

---

## Task 5: 改 harness-graph.js — 加 ci_gate 节点 + 图结构

**Files:**
- Modify: `packages/brain/src/harness-graph.js:488-1068` (createDockerNodes + buildHarnessGraph)

- [ ] **Step 1: 加 ci_gate 节点 factory**

新增：`createCiGateNode(pollFn)` 返回一个普通 async 节点（非 Docker），输入 `state.pr_url` 调 `pollPRChecks`，输出 `ci_status`/`ci_feedback`/`ci_failed_check`。

- [ ] **Step 2: buildHarnessGraph 插入 ci_gate 边**

边：
- `generator → ci_gate`
- `ci_gate (PASS) → evaluator`
- `ci_gate (FAIL | TIMEOUT) → generator` 并 `eval_round += 1`（通过 state update）

注意：LangGraph 条件边 key 对齐 pr_url 存在与否。若 Generator 失败无 PR，直接 `pr_url=null` → ci_gate 返回 `status=FAIL` → 回 generator。

- [ ] **Step 3: 改 Evaluator 节点单次执行**

删除 for 循环；Prompt 去 "起临时 Brain 5222" 指令（由 SKILL.md 承载），保留 task_id/pr_url/eval_round 注入。

- [ ] **Step 4: Commit**

```bash
git add packages/brain/src/harness-graph.js
git commit -m "refactor(brain): 加 ci_gate 节点 + Evaluator 去 WS 循环 (M4)"
```

---

## Task 6: harness-graph-v2-flow 单测

**Files:**
- Create: `packages/brain/src/__tests__/harness-graph-v2-flow.test.js`

- [ ] **Step 1: 写测试**

```js
import { describe, it, expect, vi } from 'vitest';
import {
  createDockerNodes,
  createCiGateNode,
  buildHarnessGraph,
  compileHarnessApp,
  HARNESS_NODE_NAMES,
} from '../harness-graph.js';

// Generator 新建模式 vs Fix 模式 prompt 分流
describe('Generator isFixMode 分流', () => {
  it('eval_round=0 → 新建 PR 模式', async () => {
    const captured = { prompt: null, task_type: null };
    const dockerMock = vi.fn(async ({ prompt, task }) => {
      captured.prompt = prompt;
      captured.task_type = task.task_type;
      return { exit_code: 0, timed_out: false, stdout: 'pr_url: https://github.com/o/r/pull/1\npr_branch: cp-0420-x' };
    });
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    const out = await nodes.generator({
      task_id: 't1',
      task_description: '',
      contract_content: '',
      eval_round: 0,
    });
    expect(captured.task_type).toBe('harness_generate');
    expect(captured.prompt).toMatch(/新建\s*PR\s*模式|checkout 新分支|gh pr create/);
    expect(captured.prompt).not.toMatch(/永远不要.*开新 PR/);
    expect(out.pr_url).toBe('https://github.com/o/r/pull/1');
  });

  it('eval_round>0 → Fix 模式', async () => {
    const captured = { prompt: null, task_type: null };
    const dockerMock = vi.fn(async ({ prompt, task }) => {
      captured.prompt = prompt;
      captured.task_type = task.task_type;
      return { exit_code: 0, timed_out: false, stdout: 'commit_sha: abc123' };
    });
    const nodes = createDockerNodes(dockerMock, { id: 't1' });
    const out = await nodes.generator({
      task_id: 't1',
      pr_url: 'https://github.com/o/r/pull/1',
      pr_branch: 'cp-0420-x',
      eval_round: 1,
      eval_feedback: 'Feature A broken',
    });
    expect(captured.task_type).toBe('harness_fix');
    expect(captured.prompt).toMatch(/Fix\s*模式|同分支|永远不要.*开新\s*PR/);
    expect(captured.prompt).toMatch(/cp-0420-x/); // 注入了已有分支
    // Fix 模式输出应保留原 pr_url（不开新 PR）
    expect(out.pr_url).toBe('https://github.com/o/r/pull/1');
  });
});

// ci_gate 节点路由：PASS → evaluator，FAIL → generator
describe('ci_gate 节点', () => {
  it('pollPRChecks PASS → ci_status=pass', async () => {
    const pollFn = vi.fn(async () => ({ status: 'PASS', checks: [{ name: 'L1', bucket: 'pass' }] }));
    const node = createCiGateNode(pollFn);
    const out = await node({ pr_url: 'https://github.com/o/r/pull/1' });
    expect(out.ci_status).toBe('pass');
    expect(out.ci_feedback).toBeFalsy();
  });

  it('pollPRChecks FAIL → ci_status=fail + feedback + eval_round++', async () => {
    const pollFn = vi.fn(async () => ({
      status: 'FAIL',
      failedCheck: { name: 'L1', link: 'x' },
      logSnippet: 'Error: foo',
    }));
    const node = createCiGateNode(pollFn);
    const out = await node({ pr_url: 'https://github.com/o/r/pull/1', eval_round: 0 });
    expect(out.ci_status).toBe('fail');
    expect(out.ci_feedback).toContain('Error: foo');
    expect(out.ci_failed_check).toBe('L1');
    expect(out.eval_round).toBe(1);
  });

  it('pollPRChecks TIMEOUT → ci_status=timeout (FAIL 下游)', async () => {
    const pollFn = vi.fn(async () => ({ status: 'TIMEOUT' }));
    const node = createCiGateNode(pollFn);
    const out = await node({ pr_url: 'https://github.com/o/r/pull/1', eval_round: 0 });
    expect(out.ci_status).toBe('timeout');
  });

  it('pr_url 缺失 → ci_status=fail（不调 pollFn）', async () => {
    const pollFn = vi.fn();
    const node = createCiGateNode(pollFn);
    const out = await node({ pr_url: null, eval_round: 0 });
    expect(out.ci_status).toBe('fail');
    expect(pollFn).not.toHaveBeenCalled();
  });
});

// 图结构：节点名 + 边
describe('buildHarnessGraph v2 结构', () => {
  it('HARNESS_NODE_NAMES 含 ci_gate', () => {
    expect(HARNESS_NODE_NAMES).toContain('ci_gate');
  });

  it('compileHarnessApp 不抛错', () => {
    const app = compileHarnessApp();
    expect(app).toBeDefined();
  });

  it('端到端流：generator → ci_gate(PASS) → evaluator(PASS) → report', async () => {
    const trace = [];
    const app = compileHarnessApp({
      overrides: {
        planner: async () => { trace.push('planner'); return { trace: 'planner' }; },
        proposer: async () => { trace.push('proposer'); return { trace: 'proposer' }; },
        reviewer: async () => { trace.push('reviewer'); return { review_verdict: 'APPROVED', trace: 'reviewer' }; },
        generator: async () => { trace.push('generator'); return { pr_url: 'https://github.com/o/r/pull/1', trace: 'generator' }; },
        ci_gate: async () => { trace.push('ci_gate'); return { ci_status: 'pass', trace: 'ci_gate' }; },
        evaluator: async () => { trace.push('evaluator'); return { evaluator_verdict: 'PASS', trace: 'evaluator' }; },
        report: async () => { trace.push('report'); return { trace: 'report' }; },
      },
    });
    await app.invoke({ task_id: 't1' }, { configurable: { thread_id: 't1' } });
    expect(trace).toEqual(['planner', 'proposer', 'reviewer', 'generator', 'ci_gate', 'evaluator', 'report']);
  });

  it('CI FAIL 路径：generator → ci_gate(FAIL) → generator', async () => {
    const trace = [];
    let genCalls = 0;
    const app = compileHarnessApp({
      overrides: {
        planner: async () => ({ trace: 'planner' }),
        proposer: async () => ({ trace: 'proposer' }),
        reviewer: async () => ({ review_verdict: 'APPROVED', trace: 'reviewer' }),
        generator: async () => {
          genCalls++;
          trace.push(`generator#${genCalls}`);
          return { pr_url: 'https://github.com/o/r/pull/1', trace: `gen${genCalls}` };
        },
        ci_gate: async (state) => {
          // 第一轮 fail，第二轮 pass
          const status = (state.eval_round || 0) >= 1 ? 'pass' : 'fail';
          const update = { ci_status: status, trace: `ci_gate(${status})` };
          if (status === 'fail') update.eval_round = (state.eval_round || 0) + 1;
          trace.push(`ci_gate(${status})`);
          return update;
        },
        evaluator: async () => ({ evaluator_verdict: 'PASS', trace: 'evaluator' }),
        report: async () => ({ trace: 'report' }),
      },
    });
    await app.invoke({ task_id: 't1' }, { configurable: { thread_id: 't1' }, recursionLimit: 25 });
    // generator 应被调 2 次（第一次 CI fail，第二次 PASS）
    expect(genCalls).toBe(2);
  });
});
```

- [ ] **Step 2: 跑测试**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-graph-v2-flow.test.js`
Expected: 全部 PASS

- [ ] **Step 3: Commit**

```bash
git add packages/brain/src/__tests__/harness-graph-v2-flow.test.js
git commit -m "test(brain): harness-graph-v2-flow — Generator 两模式 + ci_gate 路由 (M4)"
```

---

## Task 7: 同步 SKILL.md 4 处（harness-generator 两模式）

**Files:**
- Modify: `~/.claude-account1/skills/harness-generator/SKILL.md`（并同步到 account2/account3/~/.claude）

- [ ] **Step 1: 改写 harness-generator SKILL.md**

核心变化（version bump 到 5.0.0）：
- 清楚分"新建 PR 模式（eval_round==0）"和"Fix 模式（eval_round>0）"
- 新建 PR 模式：checkout 新分支 → push → gh pr create → 输出 `pr_url`
- Fix 模式：`gh pr checkout` 或 `git checkout <pr_branch>` → 修代码 → commit → push（同分支）→ 输出 `commit_sha`（PR 号不变）
- 删掉 v4.3 的 Workstream 专属引导（contract-dod-ws{N}.md / WORKSTREAM_INDEX）— 改为单 Task 视角
- 硬约束段：“永远不要在 Fix 模式开新 PR；同分支累积 commit”

- [ ] **Step 2: cp 到另 3 处**

```bash
cp ~/.claude-account1/skills/harness-generator/SKILL.md ~/.claude-account2/skills/harness-generator/SKILL.md
cp ~/.claude-account1/skills/harness-generator/SKILL.md ~/.claude-account3/skills/harness-generator/SKILL.md
cp ~/.claude-account1/skills/harness-generator/SKILL.md ~/.claude/skills/harness-generator/SKILL.md
```

- [ ] **Step 3: diff 校验 4 处一致**

Run:
```bash
diff ~/.claude-account1/skills/harness-generator/SKILL.md ~/.claude-account2/skills/harness-generator/SKILL.md
diff ~/.claude-account1/skills/harness-generator/SKILL.md ~/.claude-account3/skills/harness-generator/SKILL.md
diff ~/.claude-account1/skills/harness-generator/SKILL.md ~/.claude/skills/harness-generator/SKILL.md
```
Expected: 无输出

SKILL.md 在用户 home 下，不在仓库里，commit 时不会 track。但为了记录变更，额外在仓库里存一份 snapshot（只存 account1 的，对应到 packages/workflows/skills 下）：

- [ ] **Step 4: 仓库 snapshot**

若 `packages/workflows/skills/harness-generator/SKILL.md` 存在则同步更新，不存在则新建。

---

## Task 8: 同步 SKILL.md 4 处（harness-evaluator 去 E2E）

**Files:**
- Modify: `~/.claude-account1/skills/harness-evaluator/SKILL.md`（并同步）

- [ ] **Step 1: 改写 harness-evaluator SKILL.md**

核心变化（version bump 到 6.0.0 — 破坏性）：
- **删除** Step 1（启动临时 Brain 5222）
- **删除** Step 2 API 验证（对 5222 curl）
- **删除** Step 3 前端验证（打开页面）
- **删除** Step 5 清理临时 Brain
- **删除** Step 7 MANDATORY curl PATCH 5221 回写（改为顶层输出 JSON 即可；M5 再考虑）
- **改为** Task 级对抗 QA：
  * Step 1: checkout PR 分支，跑该 Task 范围内的 unit test / integration test
  * Step 2: mock deps 的 integration test 清单
  * Step 3: 深度对抗 — 空输入/null/undefined/超长字符/emoji/不存在ID/已删除ID/权限不符ID/并发Promise.all/错误路径/race
  * Step 4: 写 `${SPRINT_DIR}/eval-task-${TASK_ID}-round-${N}.md` 记录测过的对抗 case
  * Step 5: 输出 verdict JSON
- 停止条件段明确："无上限 / 无软上限 / 不因连续 N 轮无新 FAIL 终止。PASS 唯一条件 = 所有验收标准通过 + 每条对抗 case 明确测过"

- [ ] **Step 2: cp 到另 3 处 + diff 校验** （同 Task 7）

- [ ] **Step 3: 仓库 snapshot**

若 `packages/workflows/skills/harness-evaluator/SKILL.md` 存在则同步更新。

---

## Task 9: 加 Learning + 写 DoD.md

**Files:**
- Create: `docs/learnings/cp-04200010-harness-v2-m4-task-loop.md`
- Create: `DoD.md`

- [ ] **Step 1: 写 Learning**

```markdown
# cp-04200010-harness-v2-m4-task-loop Learning

### 根本原因

Harness v2 M4 需要把阶段 B 的 Task 级循环落地：Generator 两模式、CI Gate 非 LLM 节点、Evaluator 去 E2E。核心风险是改坏了 harness-graph 的既有 GAN 循环或 Docker executor。通过把 ci_gate 做成纯 async 函数节点（不走 Docker）、Generator 单次执行（不再 WS 循环）、SKILL.md 同步 4 处保证 Docker 容器里读到新版本，避开这些风险。

Evaluator 去 E2E 的关键决策：不保留"起 Brain 5222"指令，彻底改为 Task 级对抗 QA，避免 E2E 职责在阶段 B 和 C 之间重叠。M5 的 Final E2E Runner 会承担真实 E2E。

### 下次预防

- [ ] SKILL.md 变更必须同步 4 处（account1/2/3/~/.claude），commit 前跑 diff 校验
- [ ] harness-graph.js 的节点新增/删除必须同步更新 HARNESS_NODE_NAMES 数组
- [ ] 非 LLM 节点（如 ci_gate）不要跑 Docker；Docker 节点不要跑纯 JS 函数
- [ ] State schema 字段的删除必须检查 harness-graph-runner.js / routes 是否还读
```

- [ ] **Step 2: 写 DoD.md**

包含强 test 的 BEHAVIOR 条目 + ARTIFACT 条目。

- [ ] **Step 3: Commit**

```bash
git add DoD.md docs/learnings/cp-04200010-harness-v2-m4-task-loop.md
git commit -m "docs(harness): M4 Learning + DoD"
```

---

## Task 10: Push + PR + auto-merge

- [ ] **Step 1: 跑完整 vitest suite**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-ci-gate.test.js src/__tests__/harness-graph-v2-flow.test.js`
Expected: 全部 PASS

- [ ] **Step 2: Push + PR**

```bash
git push -u origin HEAD
gh pr create --title "feat(brain): Harness v2 M4 — Task 级循环 + Generator Fix 模式 + CI Gate + Evaluator 去 E2E" --body "..."
gh pr merge --auto --squash <PR_URL>
```

- [ ] **Step 3: 等 CI 并合并**

```bash
until [[ $(gh pr checks <PR_URL> | grep -cE 'pending|queued') == 0 ]]; do sleep 30; done
```

---

## Self-Review Checklist

- [x] Spec 的 Generator 两模式 → Task 4 / Task 7
- [x] CI Gate 模块 → Task 1 / Task 5
- [x] Evaluator 去 E2E → Task 5（prompt） / Task 8（SKILL.md）
- [x] 撤销 WS 循环 → Task 3（State） / Task 4（Generator） / Task 5（Evaluator）
- [x] 测试金字塔 → Task 2 / Task 6
- [x] SKILL.md 4 处同步 → Task 7 / Task 8
- [x] Learning + DoD → Task 9
- [x] auto-merge → Task 10

Type consistency: `ci_status` 在 Task 3/4/5/6 使用一致（'pass'|'fail'|'timeout'|'pending'）。`pollPRChecks` 返回 `status` 大写（PASS/FAIL/TIMEOUT），ci_gate 节点转小写写入 state。
