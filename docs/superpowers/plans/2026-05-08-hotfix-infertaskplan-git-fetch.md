# Hotfix inferTaskPlanNode git fetch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 inferTaskPlanNode 的 `git show origin/X` 之前加 `git fetch origin X`，让 brain 容器能拿到 task container 刚 push 的分支。

**Architecture:** 单点 5 行 hotfix。fetch 失败 graceful warn 不阻塞，让原 git show catch 报具体错。不重构、不抽 helper（留给长治 sprint）。

**Tech Stack:** Node.js (Brain) + Vitest (unit) + Bash + git

---

## File Structure

| 文件 | 操作 | 责任 |
|---|---|---|
| `packages/brain/src/workflows/__tests__/infer-task-plan-fetch.test.js` | **新建** | 3 个 unit test：fetch 在 show 前 call、fetch 失败 graceful、call 顺序 |
| `packages/brain/scripts/smoke/infer-task-plan-fetch-smoke.sh` | **新建** | 真 git push + brain fetch 跨 worktree E2E |
| `packages/brain/src/workflows/harness-initiative.graph.js` | **改** | inferTaskPlanNode line 826-848 加 fetch |
| `packages/brain/package.json` + `package-lock.json` | **改** | 1.228.4 → 1.228.5 |
| `docs/learnings/cp-0508110728-hotfix-infertaskplan-git-fetch.md` | **新建** | Learning |

---

## Task 1: TDD Red — unit test + smoke.sh 骨架

**Files:**
- Create: `packages/brain/src/workflows/__tests__/infer-task-plan-fetch.test.js`
- Create: `packages/brain/scripts/smoke/infer-task-plan-fetch-smoke.sh`

- [ ] **Step 1.1: 写 failing unit test 文件**

```javascript
// packages/brain/src/workflows/__tests__/infer-task-plan-fetch.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const execSyncCalls = [];
let execSyncImpl;
vi.mock('child_process', () => ({
  execSync: (cmd, opts) => {
    execSyncCalls.push({ cmd, cwd: opts?.cwd });
    if (execSyncImpl) return execSyncImpl(cmd, opts);
    throw new Error('execSyncImpl not set');
  },
}));

import { inferTaskPlanNode } from '../harness-initiative.graph.js';

const baseState = {
  worktreePath: '/tmp/fake-worktree',
  initiativeId: 'init-aaaa',
  task: { payload: { sprint_dir: 'sprints/test' } },
  ganResult: { propose_branch: 'cp-harness-propose-r1-deadbeef' },
};

const validTaskPlan = JSON.stringify({
  initiative_id: 'init-aaaa',
  journey_type: 'autonomous',
  journey_type_reason: 'test',
  tasks: [{ task_id: 'ws1', title: 't', scope: 's', dod: ['[BEHAVIOR] x'], files: ['a.js'], depends_on: [], complexity: 'S', estimated_minutes: 30 }],
});

describe('inferTaskPlanNode git fetch [BEHAVIOR]', () => {
  beforeEach(() => {
    execSyncCalls.length = 0;
    execSyncImpl = null;
  });

  it('git fetch origin <branch> 必须在 git show 之前 call', async () => {
    execSyncImpl = (cmd) => {
      if (cmd.startsWith('git fetch')) return '';
      if (cmd.startsWith('git show')) return validTaskPlan;
      throw new Error('unexpected: ' + cmd);
    };
    const result = await inferTaskPlanNode(baseState);
    expect(execSyncCalls.length).toBeGreaterThanOrEqual(2);
    expect(execSyncCalls[0].cmd).toBe('git fetch origin cp-harness-propose-r1-deadbeef');
    expect(execSyncCalls[1].cmd).toContain('git show origin/cp-harness-propose-r1-deadbeef');
    expect(result.taskPlan).toBeDefined();
    expect(result.taskPlan.tasks.length).toBe(1);
  });

  it('fetch 失败 graceful warn 不阻塞，继续走 git show', async () => {
    execSyncImpl = (cmd) => {
      if (cmd.startsWith('git fetch')) throw new Error('fatal: could not read from remote');
      if (cmd.startsWith('git show')) return validTaskPlan;
      throw new Error('unexpected: ' + cmd);
    };
    const result = await inferTaskPlanNode(baseState);
    // fetch fail 后 show 仍然 call
    expect(execSyncCalls.length).toBe(2);
    expect(execSyncCalls[1].cmd).toContain('git show');
    // 最终 show 成功 → taskPlan 应该有
    expect(result.taskPlan).toBeDefined();
  });

  it('fetch 在正确的 worktreePath cwd 跑', async () => {
    execSyncImpl = (cmd) => {
      if (cmd.startsWith('git fetch')) return '';
      if (cmd.startsWith('git show')) return validTaskPlan;
      throw new Error('unexpected: ' + cmd);
    };
    await inferTaskPlanNode(baseState);
    expect(execSyncCalls[0].cwd).toBe('/tmp/fake-worktree');
  });
});
```

- [ ] **Step 1.2: 写 smoke.sh 真 E2E 跨 worktree 模拟**

```bash
#!/usr/bin/env bash
# infer-task-plan-fetch-smoke.sh
# 真环境验证：模拟 task container push origin → brain 端 inferTaskPlan 调用 → 能 git show 到 task-plan.json
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRAIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

WORK=$(mktemp -d -t infer-fetch-smoke-XXXXXX)
trap "rm -rf '$WORK'" EXIT

# Setup: 模拟 origin (bare repo) + 两个 worktree (proposer-side + brain-side)
git init --bare "$WORK/origin.git" >/dev/null 2>&1
git clone "$WORK/origin.git" "$WORK/proposer" >/dev/null 2>&1
git clone "$WORK/origin.git" "$WORK/brain" >/dev/null 2>&1

# proposer-side: 写 task-plan.json，commit，push 一个新分支
cd "$WORK/proposer"
git config user.email "test@test"
git config user.name "Test"
mkdir -p sprints/test-sprint
cat > sprints/test-sprint/task-plan.json <<'EOF'
{"initiative_id":"smoke-test","journey_type":"autonomous","journey_type_reason":"smoke","tasks":[{"task_id":"ws1","title":"t","scope":"s","dod":["[BEHAVIOR] x"],"files":["a.js"],"depends_on":[],"complexity":"S","estimated_minutes":30}]}
EOF
git checkout -b cp-harness-propose-r1-smokeABC >/dev/null 2>&1
git add . && git commit -m "test" --quiet
git push origin cp-harness-propose-r1-smokeABC --quiet 2>&1

# brain-side: 起步 main 分支，没 fetch 过 cp-harness-propose-r1-smokeABC
cd "$WORK/brain"
git config user.email "test@test"
git config user.name "Test"

# 验证：brain-side 此时 git show 应该 fail（没 fetch）
if git show "origin/cp-harness-propose-r1-smokeABC:sprints/test-sprint/task-plan.json" 2>&1 | grep -q invalid; then
  echo "✓ brain-side 起始状态：未 fetch → git show fail（符合预期）"
else
  echo "FAIL: brain-side 起始状态意外能 git show，smoke 假设错"
  exit 1
fi

# 通过 inferTaskPlanNode（指向 brain-side 这个 worktree）调用，看是否能拿到 task-plan
RESULT=$(node --input-type=module -e "
  process.chdir('$WORK/brain');
  const m = await import('$BRAIN_ROOT/src/workflows/harness-initiative.graph.js');
  const result = await m.inferTaskPlanNode({
    worktreePath: '$WORK/brain',
    initiativeId: 'smoke-test',
    task: { payload: { sprint_dir: 'sprints/test-sprint' } },
    ganResult: { propose_branch: 'cp-harness-propose-r1-smokeABC' },
  });
  if (result.error) { console.error('NODE_ERROR:' + result.error); process.exit(1); }
  if (!result.taskPlan?.tasks?.length) { console.error('NO_TASKS'); process.exit(2); }
  console.log('OK:tasks=' + result.taskPlan.tasks.length);
" 2>&1)

if [[ "$RESULT" == *"OK:tasks=1"* ]]; then
  echo "✅ infer-task-plan-fetch smoke PASS — brain 自动 fetch 后能 git show"
  exit 0
else
  echo "❌ smoke FAIL: $RESULT"
  exit 1
fi
```

- [ ] **Step 1.3: chmod +x smoke.sh**

```bash
chmod +x packages/brain/scripts/smoke/infer-task-plan-fetch-smoke.sh
```

- [ ] **Step 1.4: 跑 unit test 验证 fail（Red 证据）**

```bash
cd /Users/administrator/worktrees/cecelia/hotfix-infertaskplan-git-fetch
cd packages/brain && npx vitest run src/workflows/__tests__/infer-task-plan-fetch.test.js --reporter=verbose 2>&1 | tail -30
```

期望：3 个 test 至少 2 个 FAIL（"git fetch origin X 必须在 git show 之前" + "fetch 在正确 cwd"）；现有实现没 fetch，第一个 execSync call 是 git show。

- [ ] **Step 1.5: 跑 smoke.sh 验证 fail（Red）**

```bash
cd /Users/administrator/worktrees/cecelia/hotfix-infertaskplan-git-fetch
bash packages/brain/scripts/smoke/infer-task-plan-fetch-smoke.sh
echo "exit=$?"
```

期望：exit ≠ 0，因为 brain-side 没 fetch → inferTaskPlan git show 直接 fail。

- [ ] **Step 1.6: Commit (TDD Red)**

```bash
cd /Users/administrator/worktrees/cecelia/hotfix-infertaskplan-git-fetch
git add packages/brain/src/workflows/__tests__/infer-task-plan-fetch.test.js \
        packages/brain/scripts/smoke/infer-task-plan-fetch-smoke.sh
git commit -m "test(brain): TDD Red — inferTaskPlanNode 加 git fetch unit + smoke 骨架"
```

---

## Task 2: TDD Green — 改 inferTaskPlanNode 加 git fetch

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js` (line 826-848 inferTaskPlanNode)

- [ ] **Step 2.1: 用 Read 工具确认 line 范围**

读 `packages/brain/src/workflows/harness-initiative.graph.js` line 798-849，确认 inferTaskPlanNode 的实际位置。

- [ ] **Step 2.2: 在 git show 之前加 git fetch（用 Edit 工具）**

老代码：
```javascript
  try {
    const { execSync } = await import('child_process');
    const json = execSync(
      `git show origin/${proposeBranch}:${sprintDir}/task-plan.json`,
      { cwd: state.worktreePath, encoding: 'utf8' }
    );
```

新代码：
```javascript
  try {
    const { execSync } = await import('child_process');
    // 防御：proposer 在 task container 内 git push 后，brain 容器本地 origin tracking 不会自动更新
    // 主动 fetch 该分支再 show；fetch 失败 graceful warn，让下面 show 的 catch 报具体错（show 错最直观）
    try {
      execSync(`git fetch origin ${proposeBranch}`, {
        cwd: state.worktreePath,
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (fetchErr) {
      console.warn(`[infer_task_plan] git fetch origin ${proposeBranch} failed: ${(fetchErr.message || '').slice(0, 200)}, continuing to git show`);
    }
    const json = execSync(
      `git show origin/${proposeBranch}:${sprintDir}/task-plan.json`,
      { cwd: state.worktreePath, encoding: 'utf8' }
    );
```

- [ ] **Step 2.3: 跑 unit test 验证 3/3 PASS**

```bash
cd /Users/administrator/worktrees/cecelia/hotfix-infertaskplan-git-fetch
cd packages/brain && npx vitest run src/workflows/__tests__/infer-task-plan-fetch.test.js --reporter=verbose 2>&1 | tail -15
```

期望：3/3 PASS。

- [ ] **Step 2.4: 跑 smoke.sh 验证 PASS**

```bash
cd /Users/administrator/worktrees/cecelia/hotfix-infertaskplan-git-fetch
bash packages/brain/scripts/smoke/infer-task-plan-fetch-smoke.sh
echo "exit=$?"
```

期望：`✅ infer-task-plan-fetch smoke PASS` + exit 0。

- [ ] **Step 2.5: Commit (TDD Green)**

```bash
cd /Users/administrator/worktrees/cecelia/hotfix-infertaskplan-git-fetch
git add packages/brain/src/workflows/harness-initiative.graph.js
git commit -m "$(cat <<'EOF'
fix(brain): inferTaskPlanNode 在 git show origin/X 前主动 git fetch origin X

W8 v4 task 5eb2718b fail at inferTaskPlan：origin 上有
cp-harness-propose-r3-XXX 分支但 brain 容器 git show 找不到
（fatal: invalid object name）。

根因：proposer 在另一个 docker 容器（task container）内 git push
后，brain 容器自己的本地 git 库 origin tracking 不会自动更新。
inferTaskPlanNode 直接 git show origin/X 拿不到刚 push 的分支。

修复：git show 之前主动 git fetch origin <branch>。fetch 失败
graceful warn 不阻塞，让下面 git show 的 catch 报具体错（show 错最
直观）。

PR #2837 修了 fallback 名格式，本 PR 修了 brain 端 fetch — 二者
配合 W8/Sprint 2.1a 应能推过 inferTaskPlan 进入 fanout。

Cecelia Harness Pipeline Journey 长治 sprint 会做架构层 helper
封装；本 PR 只修 inferTaskPlanNode 单点。
EOF
)"
```

---

## Task 3: brain version bump

**Files:**
- Modify: `packages/brain/package.json` (1.228.4 → 1.228.5)
- Modify: `packages/brain/package-lock.json` (sync)

- [ ] **Step 3.1: bump version**

```bash
cd /Users/administrator/worktrees/cecelia/hotfix-infertaskplan-git-fetch
node -e "
const fs = require('fs');
const path = 'packages/brain/package.json';
const p = JSON.parse(fs.readFileSync(path, 'utf8'));
p.version = '1.228.5';
fs.writeFileSync(path, JSON.stringify(p, null, 2) + '\n');
console.log('package.json:', p.version);
"
node -e "
const fs = require('fs');
const path = 'packages/brain/package-lock.json';
const lock = JSON.parse(fs.readFileSync(path, 'utf8'));
lock.version = '1.228.5';
if (lock.packages && lock.packages['']) lock.packages[''].version = '1.228.5';
fs.writeFileSync(path, JSON.stringify(lock, null, 2) + '\n');
console.log('lock:', lock.version);
"
```

- [ ] **Step 3.2: verify**

```bash
grep '"version"' packages/brain/package.json | head -1
head -10 packages/brain/package-lock.json | grep version
```

期望：都是 `"version": "1.228.5"`。

- [ ] **Step 3.3: commit**

```bash
git add packages/brain/package.json packages/brain/package-lock.json
git commit -m "chore(brain): bump 1.228.4 → 1.228.5 — inferTaskPlan 加 git fetch hotfix"
```

---

## Task 4: Learning + push + PR

**Files:**
- Create: `docs/learnings/cp-0508110728-hotfix-infertaskplan-git-fetch.md`

- [ ] **Step 4.1: 写 Learning 文件**

```markdown
# cp-0508110728 — Hotfix inferTaskPlanNode 加 git fetch

**日期**: 2026-05-08
**Branch**: cp-0508110728-hotfix-infertaskplan-git-fetch
**触发**: W8 v4 task 5eb2718b fail at inferTaskPlan，origin 上有 cp-harness-propose-r3-XXX 但 brain git show 找不到

## 现象

PR #2837 已修 fallback 名 cp-harness-propose-r{N}-{taskIdSlice} 跟 SKILL push 同格式。W8 v4 实证 fallback 名 r3 完全匹配 origin 实际分支。但 brain 容器 git show 仍然 invalid object name。

## 根本原因

proposer 在 task container（cecelia/runner image）内 git push origin <branch>。这个 push 直接到 GitHub origin。但 brain 容器（cecelia/brain image）自己的本地 git 库 origin tracking **不会自动更新** — 必须显式 `git fetch origin <branch>` 才能在 brain 容器内 `git show origin/<branch>` 拿到。

inferTaskPlanNode 直接 git show 没 fetch → 拿不到刚 push 的分支。

## 下次预防

- [ ] **brain 跨进程读 git 状态前必须 fetch** — proposer/generator 等节点都跑在 task container，brain 节点要读它们 push 的内容前必须 fetch
- [ ] **git 操作 helper 封装** — 长治 sprint Cecelia Harness Pipeline 应该做 `gitShowOriginBranch(worktreePath, branch, file)` helper 强制 fetch+show
- [ ] **跨进程行为必须 smoke E2E** — 单元测试 mock execSync 看不出真实 git 跨进程行为，必须真 git push + 真 fetch 跑 smoke
- [ ] **每个节点改 fetch 时同样自检** — generator / fanout / dbUpsert 等节点可能也读 origin/X 路径，本 PR 不修但要登记

## 修复

- inferTaskPlanNode line 826-848 在 git show 之前加 git fetch
- fetch 失败 graceful warn 不阻塞，让原 show catch 报具体错
- unit test 3 个 + smoke.sh 真跨 worktree E2E
- brain version 1.228.4 → 1.228.5

## 长治依赖

[Cecelia Harness Pipeline Journey](https://www.notion.so/Cecelia-Harness-Pipeline-35ac40c2ba6381dba6fbf0c3cb4f1ad4) 6 个 thin feature 实现，从根本避免一个一个节点修。
```

写入 `docs/learnings/cp-0508110728-hotfix-infertaskplan-git-fetch.md`。

- [ ] **Step 4.2: 跑全部测试 + smoke 一次终验**

```bash
cd /Users/administrator/worktrees/cecelia/hotfix-infertaskplan-git-fetch
cd packages/brain && npx vitest run src/workflows/__tests__/infer-task-plan-fetch.test.js --reporter=verbose 2>&1 | tail -8
echo "---"
cd /Users/administrator/worktrees/cecelia/hotfix-infertaskplan-git-fetch
bash packages/brain/scripts/smoke/infer-task-plan-fetch-smoke.sh
echo "smoke exit=$?"
echo "---"
git log --oneline main..HEAD
```

期望：3/3 PASS + smoke exit 0 + 4 commits（spec, test red, fix green, version, learning）。

- [ ] **Step 4.3: commit Learning**

```bash
cd /Users/administrator/worktrees/cecelia/hotfix-infertaskplan-git-fetch
git add docs/learnings/cp-0508110728-hotfix-infertaskplan-git-fetch.md
git commit -m "docs(harness): learning — inferTaskPlan git fetch hotfix"
```

- [ ] **Step 4.4: push 到 origin**

```bash
git push -u origin cp-0508110728-hotfix-infertaskplan-git-fetch
```

- [ ] **Step 4.5: 开 PR — finishing skill 接管**

由 finishing skill 接管。

---

## Self-Review

✅ **Spec coverage**: 5 个改动清单全有对应 task（test、smoke、graph 改动、version、learning）
✅ **Placeholder scan**: 无 TBD/TODO；所有代码块完整
✅ **Type consistency**: `inferTaskPlanNode(state)` 签名不变；只在内部加 fetch；test 用相同 state 形状
✅ **TDD 顺序**: Task 1 (Red) → Task 2 (Green)，subagent-driven 时 controller verify
✅ **CI 兼容**: smoke.sh 用 `bash` + `node` + `git`（git 在 lint-no-fake-test 不算白名单——但 git 在 brain 容器原生有，smoke job 跑 bash 调 git 是允许的）

---

## Execution Handoff

按 dev SKILL Tier 1 默认: **Subagent-Driven**。下一步 invoke `superpowers:subagent-driven-development`。
