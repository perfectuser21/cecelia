# Evaluator Pre-merge Gate Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Harness Pipeline evaluator pre-merge gate 被 post-pr-create.sh hook 的 --auto 绕过问题，并新增 review_required 字段让 Planner 控制 PR 是否需要人工审核。

**Architecture:** `post-pr-create.sh` 检测 HARNESS_NODE 环境变量跳过 auto-merge；Planner SKILL.md 输出 `review_required` 字段；initiative graph 解析并透传到子任务 payload；harness-task graph 的 mergePrNode 据此决定自动 merge 或 interrupt() 等人工确认。

**Tech Stack:** Node.js ESM, LangGraph (@langchain/langgraph), Vitest, bash

---

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `/Users/administrator/perfect21/zenithjoy-skills/hooks/post-pr-create.sh` | Modify | 加 HARNESS_NODE 检测，跳过 --auto |
| `packages/workflows/skills/harness-planner/SKILL.md` | Modify | 加 review_required 字段说明 |
| `packages/brain/src/workflows/harness-initiative.graph.js` | Modify | InitiativeState 加 review_required；parsePrdNode 提取；dbUpsertNode 写入子任务 |
| `packages/brain/src/workflows/harness-task.graph.js` | Modify | TaskState 加 review_required；mergePrNode 加 interrupt() 人工门 |
| `packages/brain/src/workflows/__tests__/harness-task.graph.test.js` | Modify | 新增 review_required 相关测试 |
| `packages/brain/src/workflows/__tests__/harness-initiative-review-required.test.js` | Create | parsePrdNode 提取 + dbUpsertNode 写入测试 |
| `packages/brain/scripts/smoke/b22-review-required-smoke.sh` | Create | 源码 smoke 检查 |
| `packages/brain/package.json` | Modify | version bump 1.231.8 → 1.232.0 |

---

## Task 1: post-pr-create.sh — HARNESS_NODE 检测

**Files:**
- Modify: `/Users/administrator/perfect21/zenithjoy-skills/hooks/post-pr-create.sh`

- [ ] **Step 1: 读当前文件内容确认位置**

```bash
cat /Users/administrator/perfect21/zenithjoy-skills/hooks/post-pr-create.sh
```

预期：看到 `gh pr merge "$PR_NUMBER" --repo "$REPO" --auto --squash` 这行。

- [ ] **Step 2: 在 auto-merge 调用前加 HARNESS_NODE 检测**

找到文件里 `# 立刻 enable auto-merge` 注释行，在它**之前**插入：

```bash
# Harness 容器（generator/evaluator/planner）不启用 auto-merge
# Brain 的 evaluator pre-merge gate 负责验证后才 merge（HARNESS_NODE 由 harness-task.graph.js 注入）
if [[ -n "${HARNESS_NODE:-}" ]]; then
  echo "[post-pr-create] HARNESS_NODE=${HARNESS_NODE}: 跳过 auto-merge，evaluator PASS 后 Brain 执行 merge" >&2
  echo "PR #${PR_NUMBER} (${REPO}) 已创建，等待 Brain harness 处理。" >&2
  exit 0
fi
```

修改后该文件对应区域应如下（仅展示变化段）：

```bash
if [ -z "$PR_NUMBER" ]; then
  exit 0
fi

# Harness 容器（generator/evaluator/planner）不启用 auto-merge
# Brain 的 evaluator pre-merge gate 负责验证后才 merge（HARNESS_NODE 由 harness-task.graph.js 注入）
if [[ -n "${HARNESS_NODE:-}" ]]; then
  echo "[post-pr-create] HARNESS_NODE=${HARNESS_NODE}: 跳过 auto-merge，evaluator PASS 后 Brain 执行 merge" >&2
  echo "PR #${PR_NUMBER} (${REPO}) 已创建，等待 Brain harness 处理。" >&2
  exit 0
fi

# 立刻 enable auto-merge
gh pr merge "$PR_NUMBER" --repo "$REPO" --auto --squash 2>/dev/null || true
```

- [ ] **Step 3: 验证逻辑正确**

```bash
HARNESS_NODE=generator PR_NUMBER=999 REPO=test/repo bash -c '
  source /Users/administrator/perfect21/zenithjoy-skills/hooks/post-pr-create.sh
' 2>&1; echo "exit: $?"
```

预期：输出含 "跳过 auto-merge"，exit code = 0，**不调用** `gh pr merge`。

- [ ] **Step 4: 验证非 harness 场景不受影响**

```bash
# 不设 HARNESS_NODE → 应继续走到 gh pr merge（会因没有真实 PR 而失败，但逻辑走对了）
HARNESS_NODE="" PR_NUMBER="" REPO="" bash -c '
  set +e
  source /Users/administrator/perfect21/zenithjoy-skills/hooks/post-pr-create.sh 2>&1
' 2>&1 | head -3
echo "exit: $?"
```

预期：不含 "跳过 auto-merge" 字样（因为 HARNESS_NODE 为空，不进入我们的 if 块）。

- [ ] **Step 5: 在 zenithjoy-skills repo commit（注意这是独立 repo）**

```bash
cd /Users/administrator/perfect21/zenithjoy-skills
git add hooks/post-pr-create.sh
git status
git commit -m "fix(hooks): post-pr-create 检测 HARNESS_NODE 跳过 auto-merge

harness generator PR 不应立即启用 auto-merge，
evaluator pre-merge gate 需要在 CI 通过后才触发 merge。
HARNESS_NODE 由 harness-task.graph.js:330 注入（generator/evaluator/planner）。"
```

---

## Task 2: harness-planner SKILL.md — review_required 字段

**Files:**
- Modify: `packages/workflows/skills/harness-planner/SKILL.md`

- [ ] **Step 1: 找到当前输出 JSON 格式行**

```bash
grep -n "verdict.*DONE\|sprint_dir\|planner_branch" /Users/administrator/worktrees/cecelia/evaluator-pre-merge-gate-fix/packages/workflows/skills/harness-planner/SKILL.md | tail -5
```

预期：找到类似 `{"verdict": "DONE", "branch": "cp-...", "sprint_dir": "sprints/run-...", "planner_branch": "cp-..."}` 的行。

- [ ] **Step 2: 在输出 JSON 加 review_required 字段**

将 SKILL.md 里现有的输出格式行：
```
{"verdict": "DONE", "branch": "cp-...", "sprint_dir": "sprints/run-...", "planner_branch": "cp-..."}
```

改为：
```
{"verdict": "DONE", "branch": "cp-...", "sprint_dir": "sprints/run-...", "planner_branch": "cp-...", "review_required": false}
```

并在该行**之后**（或在 `说明` 注释段）加规则说明：

```markdown
**`review_required` 判断规则**：
- `true` — 新功能、UI 变化、行为变更（需要人工确认后 merge）
- `false` — bug fix、重构、配置调整、文档更新（evaluator PASS 后自动 merge）
- **默认**: false（不确定时选 false，让 CI 自动通过）
```

- [ ] **Step 3: 确认修改正确**

```bash
grep -A5 "review_required" /Users/administrator/worktrees/cecelia/evaluator-pre-merge-gate-fix/packages/workflows/skills/harness-planner/SKILL.md | head -10
```

预期：看到 `review_required` 字段和判断规则。

- [ ] **Step 4: commit**

```bash
cd /Users/administrator/worktrees/cecelia/evaluator-pre-merge-gate-fix
git add packages/workflows/skills/harness-planner/SKILL.md
git commit -m "feat(harness-planner): 输出 JSON 加 review_required 字段

true=新功能/UI变化（等人工确认），false=bug fix/重构（自动merge）。
Brain parsePrdNode 从 plannerOutput 提取此字段并透传到子任务 payload。"
```

---

## Task 3: harness-initiative.graph.js — review_required 传播

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js:106-122` (InitiativeState)
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js:390-477` (parsePrdNode)
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js:548-647` (dbUpsertNode)

- [ ] **Step 1: 在 InitiativeState 加 review_required annotation**

找到 `packages/brain/src/workflows/harness-initiative.graph.js` 里 `InitiativeState` 定义段（约 line 106），在最后一个 annotation 后加：

```js
  review_required: Annotation({ reducer: (_o, n) => n, default: () => false }),
```

完整 InitiativeState 末尾应如下：
```js
  planner_container_id: Annotation({ reducer: (_o, n) => n, default: () => null }),
  review_required:      Annotation({ reducer: (_o, n) => n, default: () => false }),
});
```

- [ ] **Step 2: 在 parsePrdNode 末尾提取 review_required**

找到 `parsePrdNode` 函数（约 line 390），在 `return { taskPlan, prdContent, sprintDir };` 之前加：

```js
  // 从 planner verdict JSON 提取 review_required（harness-planner v8.x+ 输出）
  // fail-open：字段不存在 → false（老版本 planner 兼容）
  const rvMatch = (state.plannerOutput || '').match(/"review_required"\s*:\s*(true|false)/);
  const reviewRequired = rvMatch ? rvMatch[1] === 'true' : false;
```

并把 return 改为：
```js
  return { taskPlan, prdContent, sprintDir, review_required: reviewRequired };
```

- [ ] **Step 3: 在 dbUpsertNode 写入子任务 payload**

找到 `dbUpsertNode` 里现有的 sprint_dir UPDATE（约 line 571-578）：

```js
    if (insertedTaskIds?.length > 0 && effectiveSprintDir !== 'sprints') {
      await client.query(
        `UPDATE tasks
         SET payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb
         WHERE id = ANY($1::uuid[])`,
        [insertedTaskIds, JSON.stringify({ sprint_dir: effectiveSprintDir })]
      );
    }
```

在这段**之后**（同一 try 块内），加：

```js
    // 透传 review_required 到子任务 payload（merge_pr node 读取）
    if (insertedTaskIds?.length > 0 && state.review_required) {
      await client.query(
        `UPDATE tasks
         SET payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb
         WHERE id = ANY($1::uuid[])`,
        [insertedTaskIds, JSON.stringify({ review_required: state.review_required })]
      );
    }
```

- [ ] **Step 4: syntax check**

```bash
node --check /Users/administrator/worktrees/cecelia/evaluator-pre-merge-gate-fix/packages/brain/src/workflows/harness-initiative.graph.js
```

预期：无输出（syntax OK）。

- [ ] **Step 5: commit**

```bash
cd /Users/administrator/worktrees/cecelia/evaluator-pre-merge-gate-fix
git add packages/brain/src/workflows/harness-initiative.graph.js
git commit -m "feat(brain): initiative graph 传播 review_required 到子任务 payload

InitiativeState 加 review_required annotation；
parsePrdNode 从 plannerOutput 提取；
dbUpsertNode 写入子任务 payload 供 merge_pr 节点读取。"
```

---

## Task 4: harness-task.graph.js — TaskState + mergePrNode 人工门

**Files:**
- Modify: `packages/brain/src/workflows/harness-task.graph.js:135-174` (TaskState)
- Modify: `packages/brain/src/workflows/harness-task.graph.js:745-825` (mergePrNode)

- [ ] **Step 1: 在 TaskState 加 review_required annotation**

找到 `TaskState` 定义（约 line 135），在 `prdContent` annotation 后加：

```js
  review_required: Annotation({ reducer: (_o, n) => n, default: () => false }),
```

完整末尾应如下：
```js
  prdContent:       Annotation({ reducer: (_o, n) => n, default: () => null }),
  review_required:  Annotation({ reducer: (_o, n) => n, default: () => false }),
});
```

- [ ] **Step 2: 在 mergePrNode 加 review_required 检测（在 execFn 调用前）**

找到 `mergePrNode` 函数（约 line 745）。在 `try {` 块**开始处**（即 `const { stdout } = await execFn(...)` 之前）插入：

```js
  // review_required 人工门：evaluator PASS 后，新功能/UI 变化需要人工确认才 merge。
  // interrupt() 暂停 graph，等 Brain resume endpoint 收到 { approved: true } 才继续。
  // fail-open：task.payload 读取失败 → false（不阻塞合并）。
  const needsReview = state.task?.payload?.review_required === true;
  if (needsReview) {
    console.log(`[merge_pr] review_required=true，interrupt 等待人工确认 pr=${prUrl}`);
    const reviewPayload = interrupt({
      type: 'await_human_review',
      pr_url: prUrl,
      message: `evaluator PASS — PR ${prUrl} 需要人工确认后 merge`,
    });
    if (!reviewPayload || reviewPayload.approved !== true) {
      console.warn(`[merge_pr] 人工 review 未批准（payload=${JSON.stringify(reviewPayload)}）→ 终止`);
      return { status: 'failed', error: { node: 'merge_pr', message: 'human review not approved' } };
    }
    console.log(`[merge_pr] 人工 review 批准 → 继续 merge pr=${prUrl}`);
  }
```

修改后 `mergePrNode` 函数结构（仅展示关键部分）：

```js
export async function mergePrNode(state, opts = {}) {
  if (state.status === 'merged') return { status: 'merged' };
  const execFn = opts.execFile || execFileDefault;
  const prUrl = state?.pr_url;

  if (!prUrl) {
    return { status: 'failed', error: { node: 'merge_pr', message: 'no pr_url available' } };
  }

  // review_required 人工门
  const needsReview = state.task?.payload?.review_required === true;
  if (needsReview) {
    console.log(`[merge_pr] review_required=true，interrupt 等待人工确认 pr=${prUrl}`);
    const reviewPayload = interrupt({
      type: 'await_human_review',
      pr_url: prUrl,
      message: `evaluator PASS — PR ${prUrl} 需要人工确认后 merge`,
    });
    if (!reviewPayload || reviewPayload.approved !== true) {
      console.warn(`[merge_pr] 人工 review 未批准（payload=${JSON.stringify(reviewPayload)}）→ 终止`);
      return { status: 'failed', error: { node: 'merge_pr', message: 'human review not approved' } };
    }
    console.log(`[merge_pr] 人工 review 批准 → 继续 merge pr=${prUrl}`);
  }

  try {
    const { stdout } = await execFn(
      'gh',
      ['pr', 'merge', prUrl, '--squash', '--delete-branch'],
      { timeout: 30_000 }
    );
    // ... rest of existing logic unchanged
```

- [ ] **Step 3: syntax check**

```bash
node --check /Users/administrator/worktrees/cecelia/evaluator-pre-merge-gate-fix/packages/brain/src/workflows/harness-task.graph.js
```

预期：无输出（syntax OK）。

- [ ] **Step 4: commit**

```bash
cd /Users/administrator/worktrees/cecelia/evaluator-pre-merge-gate-fix
git add packages/brain/src/workflows/harness-task.graph.js
git commit -m "feat(brain): mergePrNode 加 review_required 人工 interrupt 门

review_required=true（新功能/UI变化）→ interrupt() 等人工 approve 后才 merge；
review_required=false（默认，bug fix/重构）→ evaluator PASS 后自动 merge。"
```

---

## Task 5: 测试 — mergePrNode review_required

**Files:**
- Modify: `packages/brain/src/workflows/__tests__/harness-task.graph.test.js`

- [ ] **Step 1: 找到 mergePrNode describe 块末尾**

```bash
grep -n "describe('mergePrNode'\|^});" /Users/administrator/worktrees/cecelia/evaluator-pre-merge-gate-fix/packages/brain/src/workflows/__tests__/harness-task.graph.test.js | head -10
```

预期：找到 `describe('mergePrNode'` 及其结束行号。

- [ ] **Step 2: 在 mergePrNode describe 块末尾加两个测试**

在 `describe('mergePrNode', () => {` 块的**最后一个** `});` 之前，插入：

```js
  it('review_required=true → interrupt 被调用，approved=true → 继续 merge', async () => {
    // interrupt 在 LangGraph 运行时抛异常；单元测试用 opts.interrupt 注入 mock
    const execFile = vi.fn().mockResolvedValue({ stdout: '✓ merged', stderr: '' });
    const mockInterrupt = vi.fn().mockReturnValue({ approved: true });
    const delta = await mergePrNode(
      { pr_url: 'https://x/pull/42', task: { payload: { review_required: true } } },
      { execFile, interrupt: mockInterrupt }
    );
    expect(mockInterrupt).toHaveBeenCalledOnce();
    expect(mockInterrupt).toHaveBeenCalledWith(expect.objectContaining({ type: 'await_human_review' }));
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(delta.status).toBe('merged');
  });

  it('review_required=true → interrupt 返回 approved=false → status=failed，不 merge', async () => {
    const execFile = vi.fn();
    const mockInterrupt = vi.fn().mockReturnValue({ approved: false });
    const delta = await mergePrNode(
      { pr_url: 'https://x/pull/42', task: { payload: { review_required: true } } },
      { execFile, interrupt: mockInterrupt }
    );
    expect(mockInterrupt).toHaveBeenCalledOnce();
    expect(execFile).not.toHaveBeenCalled();
    expect(delta.status).toBe('failed');
    expect(delta.error.node).toBe('merge_pr');
    expect(delta.error.message).toMatch(/not approved/);
  });

  it('review_required=false（默认）→ interrupt 不调用，直接 merge', async () => {
    const execFile = vi.fn().mockResolvedValue({ stdout: '✓ merged', stderr: '' });
    const mockInterrupt = vi.fn();
    const delta = await mergePrNode(
      { pr_url: 'https://x/pull/42', task: { payload: { review_required: false } } },
      { execFile, interrupt: mockInterrupt }
    );
    expect(mockInterrupt).not.toHaveBeenCalled();
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(delta.status).toBe('merged');
  });
```

**重要**: 这些测试通过 `opts.interrupt` 注入 mock。需要在 `mergePrNode` 函数里让 `interrupt` 可注入：

在 Task 4 Step 2 的代码里，把 `interrupt(...)` 改为：
```js
    const interruptFn = opts.interrupt || interrupt;
    const reviewPayload = interruptFn({
      type: 'await_human_review',
      pr_url: prUrl,
      message: `evaluator PASS — PR ${prUrl} 需要人工确认后 merge`,
    });
```

（同步更新 Task 4 Step 2 里 mergePrNode 的代码）

- [ ] **Step 3: 运行新增测试确认通过**

```bash
cd /Users/administrator/worktrees/cecelia/evaluator-pre-merge-gate-fix
npx vitest run packages/brain/src/workflows/__tests__/harness-task.graph.test.js --reporter=verbose 2>&1 | grep -E "PASS|FAIL|review_required|interrupt"
```

预期：3 个新测试 PASS，已有测试无回归。

- [ ] **Step 4: commit**

```bash
cd /Users/administrator/worktrees/cecelia/evaluator-pre-merge-gate-fix
git add packages/brain/src/workflows/__tests__/harness-task.graph.test.js
git commit -m "test(brain): mergePrNode review_required interrupt 门 unit tests"
```

---

## Task 6: 测试 — parsePrdNode review_required 提取

**Files:**
- Create: `packages/brain/src/workflows/__tests__/harness-initiative-review-required.test.js`

- [ ] **Step 1: 创建测试文件**

```js
// packages/brain/src/workflows/__tests__/harness-initiative-review-required.test.js
import { describe, it, expect, vi } from 'vitest';
import { parsePrdNode } from '../harness-initiative.graph.js';

describe('parsePrdNode — review_required 提取', () => {
  it('plannerOutput 含 review_required:true → state.review_required=true', async () => {
    const plannerOutput = `
些 PRD 内容...
{"verdict": "DONE", "branch": "cp-test", "sprint_dir": "sprints/run-01", "planner_branch": "cp-test", "review_required": true}
`;
    const state = {
      plannerOutput,
      taskPlan: null,
      prdContent: null,
      sprintDir: null,
      worktreePath: null,
      task: { payload: {} },
    };
    const result = await parsePrdNode(state);
    expect(result.review_required).toBe(true);
  });

  it('plannerOutput 含 review_required:false → state.review_required=false', async () => {
    const plannerOutput = `{"verdict": "DONE", "sprint_dir": "sprints/run-01", "planner_branch": "cp-x", "review_required": false}`;
    const state = {
      plannerOutput,
      taskPlan: null,
      prdContent: null,
      sprintDir: null,
      worktreePath: null,
      task: { payload: {} },
    };
    const result = await parsePrdNode(state);
    expect(result.review_required).toBe(false);
  });

  it('plannerOutput 无 review_required 字段 → 默认 false（老版本 planner 兼容）', async () => {
    const plannerOutput = `{"verdict": "DONE", "sprint_dir": "sprints/run-01", "planner_branch": "cp-x"}`;
    const state = {
      plannerOutput,
      taskPlan: null,
      prdContent: null,
      sprintDir: null,
      worktreePath: null,
      task: { payload: {} },
    };
    const result = await parsePrdNode(state);
    expect(result.review_required).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
cd /Users/administrator/worktrees/cecelia/evaluator-pre-merge-gate-fix
npx vitest run packages/brain/src/workflows/__tests__/harness-initiative-review-required.test.js --reporter=verbose 2>&1 | grep -E "PASS|FAIL|review_required"
```

预期：3 个测试全 PASS。

- [ ] **Step 3: commit**

```bash
cd /Users/administrator/worktrees/cecelia/evaluator-pre-merge-gate-fix
git add packages/brain/src/workflows/__tests__/harness-initiative-review-required.test.js
git commit -m "test(brain): parsePrdNode review_required 提取 unit tests"
```

---

## Task 7: Smoke 测试 + Version Bump

**Files:**
- Create: `packages/brain/scripts/smoke/b22-review-required-smoke.sh`
- Modify: `packages/brain/package.json`

- [ ] **Step 1: 创建 b22 smoke 测试**

```bash
cat > /Users/administrator/worktrees/cecelia/evaluator-pre-merge-gate-fix/packages/brain/scripts/smoke/b22-review-required-smoke.sh << 'SMOKE'
#!/usr/bin/env node
// B22 smoke — review_required 门: mergePrNode 含 interrupt 检测 + HARNESS_NODE 检测在 post-pr-create.sh
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const taskGraphSrc = readFileSync(resolve(__dirname, '../../src/workflows/harness-task.graph.js'), 'utf8');
const initiativeGraphSrc = readFileSync(resolve(__dirname, '../../src/workflows/harness-initiative.graph.js'), 'utf8');
const postPrCreateSrc = readFileSync(
  resolve(__dirname, '../../../../../zenithjoy-skills/hooks/post-pr-create.sh'), 'utf8'
);

const checks = [
  { name: 'mergePrNode 含 review_required 检测', regex: /review_required.*===.*true|task\?\.payload\?\.review_required/s, src: taskGraphSrc },
  { name: 'mergePrNode 含 interrupt 人工门', regex: /await_human_review/, src: taskGraphSrc },
  { name: 'mergePrNode interrupt 可注入（opts.interrupt）', regex: /opts\.interrupt\s*\|\|/, src: taskGraphSrc },
  { name: 'InitiativeState 含 review_required annotation', regex: /review_required.*Annotation/, src: initiativeGraphSrc },
  { name: 'parsePrdNode 提取 review_required', regex: /review_required.*true\|false|rvMatch/, src: initiativeGraphSrc },
  { name: 'dbUpsertNode 写入 review_required 到子任务', regex: /review_required.*insertedTaskIds|insertedTaskIds.*review_required/s, src: initiativeGraphSrc },
  { name: 'post-pr-create.sh 含 HARNESS_NODE 检测', regex: /HARNESS_NODE/, src: postPrCreateSrc },
  { name: 'post-pr-create.sh HARNESS_NODE=非空时 exit 0', regex: /HARNESS_NODE.*exit 0|exit 0.*HARNESS_NODE/s, src: postPrCreateSrc },
];

let failed = false;
for (const { name, regex, src } of checks) {
  if (!regex.test(src)) {
    console.error(`FAIL: ${name}`);
    failed = true;
  } else {
    console.log(`  ✅ ${name}`);
  }
}
if (failed) process.exit(1);
console.log('B22 smoke PASS');
SMOKE
chmod +x /Users/administrator/worktrees/cecelia/evaluator-pre-merge-gate-fix/packages/brain/scripts/smoke/b22-review-required-smoke.sh
```

- [ ] **Step 2: 运行 smoke 测试**

```bash
node /Users/administrator/worktrees/cecelia/evaluator-pre-merge-gate-fix/packages/brain/scripts/smoke/b22-review-required-smoke.sh
```

预期：所有 ✅，最后输出 `B22 smoke PASS`。

- [ ] **Step 3: version bump**

```bash
cd /Users/administrator/worktrees/cecelia/evaluator-pre-merge-gate-fix
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('packages/brain/package.json', 'utf8'));
const [major, minor, patch] = pkg.version.split('.').map(Number);
pkg.version = \`\${major}.\${minor + 1}.0\`;
fs.writeFileSync('packages/brain/package.json', JSON.stringify(pkg, null, 2) + '\n');
console.log('version bumped to:', pkg.version);
"
```

预期：输出 `version bumped to: 1.232.0`。

- [ ] **Step 4: syntax check 两个主要文件**

```bash
node --check /Users/administrator/worktrees/cecelia/evaluator-pre-merge-gate-fix/packages/brain/src/workflows/harness-task.graph.js && \
node --check /Users/administrator/worktrees/cecelia/evaluator-pre-merge-gate-fix/packages/brain/src/workflows/harness-initiative.graph.js && \
echo "✅ syntax OK"
```

预期：`✅ syntax OK`。

- [ ] **Step 5: 运行全部 brain tests 确认无回归**

```bash
cd /Users/administrator/worktrees/cecelia/evaluator-pre-merge-gate-fix
npx vitest run packages/brain/src/workflows/__tests__/ --reporter=verbose 2>&1 | tail -20
```

预期：全 PASS，无 FAIL。

- [ ] **Step 6: commit**

```bash
cd /Users/administrator/worktrees/cecelia/evaluator-pre-merge-gate-fix
git add packages/brain/scripts/smoke/b22-review-required-smoke.sh packages/brain/package.json
git commit -m "chore(brain): b22 smoke + version bump 1.232.0 [Brain 1.232.0]"
```

---

## Task 8: PR + 推送

- [ ] **Step 1: 推送分支**

```bash
cd /Users/administrator/worktrees/cecelia/evaluator-pre-merge-gate-fix
git push origin cp-0628131921-evaluator-pre-merge-gate-fix
```

- [ ] **Step 2: 开 PR**

```bash
cd /Users/administrator/worktrees/cecelia/evaluator-pre-merge-gate-fix
gh pr create \
  --title "fix(brain): evaluator pre-merge gate — 修复 auto-merge 绕过 + review_required 人工门 [Brain 1.232.0]" \
  --body "$(cat <<'BODY'
## 问题

\`post-pr-create.sh\` hook 对所有 PR 无条件启用 \`--auto\` merge，导致 harness generator PR 在 evaluator 运行前就已 merge。evaluator 看到已 merge 的 PR → merged-short-circuit PASS → 人工 gate 和 E2E 验证全被绕过。

## 修复

### 1. post-pr-create.sh — HARNESS_NODE 检测（根治）

检测 \`HARNESS_NODE\` env var（由 harness-task.graph.js:330 注入），harness 容器跳过 \`--auto\`。

### 2. harness-planner SKILL.md — review_required 字段

Planner 输出 JSON 加 \`review_required: true/false\` 字段：
- \`true\` = 新功能/UI 变化 → 人工确认后 merge
- \`false\` = bug fix/重构 → evaluator PASS 后自动 merge

### 3. harness-initiative.graph.js — review_required 传播

parsePrdNode 从 plannerOutput 提取，dbUpsertNode 写入子任务 payload。

### 4. harness-task.graph.js — mergePrNode 人工门

review_required=true → \`interrupt()\` 暂停等人工 approve；false → 自动 merge（行为不变）。

## 不改的地方

- evaluateContractNode merged-short-circuit **保留**（防止 evaluator 运行期间 PR 被外部 merge 的竞态）
- routeAfterPoll merged→merge 路由**保留**（外部 merge 幂等出口）

## 测试

- mergePrNode review_required unit tests × 3
- parsePrdNode review_required 提取 unit tests × 3
- B22 smoke test (源码结构验证)
- Brain `node --check` syntax 验证

🤖 Generated with Claude Code
BODY
)"
```

---

## 自检

**Spec coverage**:
- ✅ post-pr-create.sh HARNESS_NODE 检测 → Task 1
- ✅ review_required Planner 输出 → Task 2
- ✅ review_required 传播（InitiativeState + parsePrdNode + dbUpsertNode）→ Task 3
- ✅ mergePrNode interrupt() 门 → Task 4
- ✅ mergePrNode 测试 → Task 5
- ✅ parsePrdNode 测试 → Task 6
- ✅ Smoke + version bump → Task 7

**不在 scope 内（已确认）**:
- evaluateContractNode merged-short-circuit 不改（Research Subagent 确认保留）
- Brain resume endpoint（interrupt 的反面）不在本 PR，是后续工作
