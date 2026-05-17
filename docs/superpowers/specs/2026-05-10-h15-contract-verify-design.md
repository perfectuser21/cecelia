# H15 — contract-verify.js 治本第一步

**日期**: 2026-05-10
**状态**: design APPROVED
**Sprint**: langgraph-contract-enforcement / Stage 2 MVP
**Brain task**: 02469652-6934-477b-b573-3b4c92b6572d

---

## 1. 背景

接手 PRD 阶段 2 已规划：抽 `packages/brain/src/lib/contract-verify.js`，每个 LLM 节点末尾必校副作用真发生。这是治本第一步。

Audit 揭示：8 days 12+ critical bug 同一根因 — 把 docker `exit_code=0` 当节点 success，没主动验副作用。Anthropic 哲学说 evaluator 应**真跑应用看结果**；LangGraph 哲学说**节点输出 schema/副作用 validate 是用户责任**。我们 12h 修的 H7-H14 全是治标，治本是 contract-verify。

H10 的 fetchAndShowOriginFile + H13 的 git fetch checkout 都是 ad-hoc 验证，没统一，且重复。本 PR 抽 SSOT helper。

## 2. 修法

### 2.1 新文件 `packages/brain/src/lib/contract-verify.js`

```js
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { stat } from 'node:fs/promises';
import path from 'node:path';

const execFile = promisify(execFileCb);

/**
 * Contract violation = 节点产出与契约不符。LangGraph retryPolicy.retryOn 识别 → retry。
 */
export class ContractViolation extends Error {
  constructor(msg, details = {}) {
    super(msg);
    this.name = 'ContractViolation';
    this.details = details;
  }
}

/**
 * 验 proposer 节点真把 propose_branch + sprintDir/task-plan.json push 到 origin。
 *
 * @param {Object} opts
 * @param {string} opts.worktreePath - generator worktree（用来跑 git 命令）
 * @param {string} opts.branch - propose_branch 名，例 'cp-harness-propose-r3-abc'
 * @param {string} opts.sprintDir - 'sprints/w8-langgraph-vN'
 * @param {Function} [opts.execFn] - 测试注入
 * @throws {ContractViolation}
 */
export async function verifyProposerOutput(opts) {
  const { worktreePath, branch, sprintDir, execFn = execFile } = opts;
  // 用 git ls-remote 而不是 git fetch — 不修改 worktree state，纯检查 origin 上有没有
  // origin URL 不依赖 worktree 的 origin remote 配置（H15 暴露的 worktree origin 是本地路径不是 GitHub）。
  // 显式传 GitHub URL，从主仓库 origin 读出来。
  const baseRepo = opts.baseRepo || '/Users/administrator/perfect21/cecelia';
  let githubUrl;
  try {
    const { stdout } = await execFn('git', ['-C', baseRepo, 'remote', 'get-url', 'origin']);
    githubUrl = stdout.trim();
  } catch (err) {
    throw new ContractViolation(
      `verifyProposerOutput: cannot read GitHub URL from baseRepo origin: ${err.message}`,
      { stage: 'github_url' },
    );
  }

  // 1. ls-remote 验 branch 真在 origin
  try {
    const { stdout } = await execFn('git', ['ls-remote', githubUrl, branch]);
    if (!stdout.trim()) {
      throw new ContractViolation(
        `proposer_didnt_push: branch '${branch}' not found on origin (${githubUrl})`,
        { branch, githubUrl, stage: 'ls_remote' },
      );
    }
  } catch (err) {
    if (err instanceof ContractViolation) throw err;
    throw new ContractViolation(
      `verifyProposerOutput: ls-remote failed for ${branch}: ${err.message}`,
      { branch, stage: 'ls_remote_exec' },
    );
  }

  // 2. fetch 该 branch 然后 git show task-plan.json
  const taskPlanPath = `${sprintDir}/task-plan.json`;
  let content;
  try {
    await execFn('git', ['fetch', githubUrl, `${branch}:refs/remotes/origin/${branch}`], { cwd: worktreePath });
    const { stdout } = await execFn('git', ['show', `origin/${branch}:${taskPlanPath}`], { cwd: worktreePath });
    content = stdout;
  } catch (err) {
    throw new ContractViolation(
      `proposer_didnt_push: branch '${branch}' missing ${taskPlanPath}: ${err.message}`,
      { branch, taskPlanPath, stage: 'git_show' },
    );
  }

  // 3. parseable + tasks.length >= 1
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new ContractViolation(
      `proposer_invalid_task_plan: ${taskPlanPath} 不是 valid JSON: ${err.message}`,
      { taskPlanPath, stage: 'parse' },
    );
  }
  if (!Array.isArray(parsed.tasks) || parsed.tasks.length < 1) {
    throw new ContractViolation(
      `proposer_empty_task_plan: ${taskPlanPath} 缺 tasks array 或为空`,
      { taskPlanPath, parsed, stage: 'tasks_count' },
    );
  }
}

/**
 * 验 generator 节点真创了 PR。
 *
 * @param {Object} opts
 * @param {string} opts.pr_url - 'https://github.com/perfectuser21/cecelia/pull/N'
 * @param {Function} [opts.execFn]
 * @throws {ContractViolation}
 */
export async function verifyGeneratorOutput(opts) {
  const { pr_url, execFn = execFile } = opts;
  if (!pr_url || typeof pr_url !== 'string') {
    throw new ContractViolation(
      `generator_no_pr_url: pr_url is null/empty (容器 stdout 没解析到 PR URL)`,
      { pr_url, stage: 'pr_url_missing' },
    );
  }
  // gh pr view 验 PR 真存在
  try {
    await execFn('gh', ['pr', 'view', pr_url, '--json', 'number,state']);
  } catch (err) {
    throw new ContractViolation(
      `generator_pr_not_found: gh pr view ${pr_url} 失败: ${err.message}`,
      { pr_url, stage: 'gh_view' },
    );
  }
}

/**
 * 验 evaluator worktree 含必要 contract artifacts（generator 已 import）。
 *
 * @param {Object} opts
 * @param {string} opts.worktreePath - generator/evaluator 共享 worktree
 * @param {string[]} opts.expectedFiles - 相对 worktreePath 的 path list
 * @param {Function} [opts.statFn]
 * @throws {ContractViolation}
 */
export async function verifyEvaluatorWorktree(opts) {
  const { worktreePath, expectedFiles, statFn = (p) => stat(p).then(() => true).catch(() => false) } = opts;
  const missing = [];
  for (const rel of expectedFiles) {
    const full = path.join(worktreePath, rel);
    const exists = await statFn(full);
    if (!exists) missing.push(rel);
  }
  if (missing.length > 0) {
    throw new ContractViolation(
      `evaluator_worktree_missing: ${missing.length} file(s) not in ${worktreePath}: ${missing.join(', ')}`,
      { worktreePath, missing, stage: 'files_exist' },
    );
  }
}
```

### 2.2 接入 3 节点

**A. proposer 节点**（`harness-gan.graph.js`）— 替换 H10 现有手工 verify：

old：
```js
try {
  await fetchOriginFile(worktreePath, proposeBranch, `${sprintDir}/task-plan.json`);
} catch (err) {
  throw new Error(`proposer_didnt_push: ...`);
}
```

new：
```js
import { verifyProposerOutput, ContractViolation } from '../lib/contract-verify.js';

try {
  await verifyProposerOutput({ worktreePath, branch: proposeBranch, sprintDir });
} catch (err) {
  throw err; // ContractViolation propagate to retryPolicy
}
```

**B. generator 节点**（`harness-task.graph.js` awaitCallbackNode 或 ci_pass 后）— 在 callback 收到 generator_output 后验 pr_url：

```js
import { verifyGeneratorOutput, ContractViolation } from '../lib/contract-verify.js';

// awaitCallback 后 / parse callback 拿到 pr_url 时：
await verifyGeneratorOutput({ pr_url: state.pr_url });
// 失败 throw ContractViolation → graph 走 retry 路径或 fail 路径
```

**C. evaluator 节点**（`harness-initiative.graph.js` evaluateSubTaskNode）— spawn evaluator 前验 worktree 真有 contract：

```js
import { verifyEvaluatorWorktree, ContractViolation, harnessSubTaskWorktreePath } from ...;

const taskWorktreePath = harnessSubTaskWorktreePath(state.initiativeId, state.sub_task.id);
const expectedFiles = [
  `${sprintDir}/contract-dod-${state.sub_task.id}.md`,
];
await verifyEvaluatorWorktree({ worktreePath: taskWorktreePath, expectedFiles });
// ... 然后 spawn evaluator
```

### 2.3 LangGraph retryPolicy 接入

3 个节点的 addNode 配 retryPolicy 让 ContractViolation 自动 retry：

```js
import { LLM_RETRY } from './retry-policies.js';
// 现有 LLM_RETRY 已含 PERMANENT_ERROR_RE，不含 ContractViolation 名字 → 默认 retry。
// 不需要改 retry-policies.js。
```

## 3. 不动什么

- 不动 H7-H14 已合 PR（H10/H13 的 ad-hoc verify 用 contract-verify 重构，行为不变）
- 不动 evaluator 跑在 host brain 的根本架构（P2 范围）
- 不动 W8 题目（B 阶段才换）
- 不动 LangGraph LLM_RETRY 配置

## 4. 测试策略

按 Cecelia 测试金字塔：H15 是新 module + 接入 3 节点 — **integration 类**，但每个 unit 行为可 mock execFile spy 测。

### 测试

`tests/brain/h15-contract-verify.test.js`（vitest）：

**A. ContractViolation class**
- new ContractViolation('msg', {x:1}) → instanceof Error + name='ContractViolation' + details.x === 1

**B. verifyProposerOutput**
- happy: mock execFn 让 ls-remote 返 sha + git show 返 valid task-plan JSON → 不 throw
- branch missing: ls-remote 返 '' → throw ContractViolation 含 'proposer_didnt_push' + branch 名
- task-plan 不存在: git show throw → throw ContractViolation 含 taskPlanPath
- task-plan invalid JSON: parse throw → throw ContractViolation 含 'invalid_task_plan'
- task-plan empty tasks: parsed.tasks=[] → throw ContractViolation 含 'empty_task_plan'

**C. verifyGeneratorOutput**
- happy: pr_url 非空 + gh pr view 不 throw → 不 throw
- pr_url null/empty → throw ContractViolation 含 'no_pr_url'
- gh pr view throw → throw ContractViolation 含 'pr_not_found'

**D. verifyEvaluatorWorktree**
- happy: 所有 expectedFiles 都 stat true → 不 throw
- 1 个 missing → throw ContractViolation 含 missing 文件名
- 多个 missing → throw 含全部 missing 列表

不做 docker E2E；W8 v17 真跑兜 integration。

## 5. DoD

- [BEHAVIOR] verifyProposerOutput 5 个 case（happy / branch missing / task-plan missing / invalid JSON / empty tasks）
  Test: tests/brain/h15-contract-verify.test.js
- [BEHAVIOR] verifyGeneratorOutput 3 个 case（happy / pr_url null / pr_not_found）
  Test: tests/brain/h15-contract-verify.test.js
- [BEHAVIOR] verifyEvaluatorWorktree 3 个 case（happy / 1 missing / 多 missing）
  Test: tests/brain/h15-contract-verify.test.js
- [BEHAVIOR] ContractViolation extends Error + name + details
  Test: tests/brain/h15-contract-verify.test.js
- [ARTIFACT] contract-verify.js 文件 exist + 4 named export（ContractViolation / verifyProposerOutput / verifyGeneratorOutput / verifyEvaluatorWorktree）
  Test: manual:node -e check
- [ARTIFACT] proposer 节点（harness-gan.graph.js）import contract-verify + 调 verifyProposerOutput
  Test: manual:node -e check
- [ARTIFACT] evaluator 节点（harness-initiative.graph.js）import contract-verify + 调 verifyEvaluatorWorktree
  Test: manual:node -e check
- [ARTIFACT] 测试文件存在
  Test: manual:node -e accessSync

## 6. 合并后真实证（手动）

1. brain redeploy
2. 跑 W8 v17 — proposer push 失败时 verifyProposerOutput throw ContractViolation → retry 3 次 → 仍失败 graph fail（信号清晰，不再 silent 推到 inferTaskPlan）
3. evaluator worktree 缺合同时 verifyEvaluatorWorktree throw → 不再让 evaluator silent FAIL
4. brain log 含 'ContractViolation' 字符串

## 7. 不做（明确范围）

- ❌ 不替代 H7-H14（contract-verify 是兜底层，H7-H14 是具体 bug 修法，并存）
- ❌ 不动 evaluator 跑 host 进程问题（P2 大重构，独立 sprint）
- ❌ 不引入 generator 节点的具体 verify 接入（generator 节点 spawnNode 已有 H13 import，verifyGenerator 接入留 H16 做，本 PR 仅接入 proposer + evaluator）
- ❌ 不动 W8 题目（B 阶段）
- ❌ 不修 H15a/b/c 之前列的 critical bug（contract-verify 治本，让那些 bug fail-fast 暴露而不是 silent）
