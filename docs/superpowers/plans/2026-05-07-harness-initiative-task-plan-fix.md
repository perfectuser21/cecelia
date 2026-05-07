# harness_initiative task-plan.json 修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 harness_initiative pipeline 自 v8 切换以来 task-plan.json 永不生成的 bug (#2819)，让 inferTaskPlan 能从 propose 分支读到任务 DAG。

**Architecture:** 三处定点修复：(1) Proposer SKILL Step 3 改为每轮都写 task-plan.json；(2) GAN 图 proposer node 加文件 access 校验（warn 不抛错）；(3) inferTaskPlan catch 块改返 `{ error }` 让 graph 走 error → END，不再静默"软坏"。

**Tech Stack:** Node.js / Bash / LangGraph / Vitest / 真实 git fixture（无 LLM 依赖）

**Spec:** `docs/superpowers/specs/2026-05-07-harness-initiative-task-plan-fix-design.md`

---

## File Structure

| 文件 | 操作 | 责任 |
|---|---|---|
| `packages/brain/scripts/smoke/harness-task-plan-smoke.sh` | Create | E2E：构造 git fixture，端到端验 inferTaskPlan 正/反路径 |
| `packages/brain/src/workflows/__tests__/harness-initiative-infer-task-plan.test.js` | Create | Unit：inferTaskPlanNode catch 行为 |
| `packages/brain/src/workflows/__tests__/harness-gan-proposer-validation.test.js` | Create | Unit：proposer node access 校验行为 |
| `packages/brain/src/workflows/harness-initiative.graph.js` | Modify L844-847 | inferTaskPlan catch 块 return `{ error }` |
| `packages/brain/src/workflows/harness-gan.graph.js` | Modify proposer() L298-333 | 加 access(taskPlanPath) 校验 |
| `packages/workflows/skills/harness-contract-proposer/SKILL.md` | Modify L7,L11,L245-247,L307,L337 | 删 APPROVED 门槛，bump version |

---

### Task 1: Smoke fixture + 失败 E2E 骨架（v18.7.0 强规则）

**Files:**
- Create: `packages/brain/scripts/smoke/harness-task-plan-smoke.sh`

- [ ] **Step 1: 写空骨架 smoke 脚本**（commit-1，必须 exit ≠ 0）

```bash
#!/usr/bin/env bash
# harness-task-plan-smoke.sh — 验证 harness_initiative pipeline task-plan.json 链路
# 端到端：构造 git fixture（裸仓 + worktree） → mock proposer push task-plan.json
#        → 调 inferTaskPlanNode → 验 tasks.length >= 1
#        → 反向：删文件 → 验返回 { error: ... }
# 不依赖 LLM，纯 JS 函数调用 + git fixture

set -euo pipefail

echo "❌ smoke 骨架：还未实现"
exit 1
```

- [ ] **Step 2: 加可执行权限**

Run: `chmod +x packages/brain/scripts/smoke/harness-task-plan-smoke.sh`

- [ ] **Step 3: 验证当前 fail**

Run: `bash packages/brain/scripts/smoke/harness-task-plan-smoke.sh; echo exit=$?`
Expected: 输出 `❌ smoke 骨架：还未实现` 然后 `exit=1`

- [ ] **Step 4: Commit-1（TDD Red）**

```bash
cd /Users/administrator/worktrees/cecelia/2819-task-plan-fix
git add packages/brain/scripts/smoke/harness-task-plan-smoke.sh
git commit -m "test(brain): smoke 骨架 — harness task-plan E2E (red)

E2E 脚本构造 git fixture + mock proposer push + 调 inferTaskPlanNode
验正反路径。骨架先 exit 1 占位（v18.7.0 TDD 红 commit）。"
```

---

### Task 2: inferTaskPlan unit test (TDD Red)

**Files:**
- Create: `packages/brain/src/workflows/__tests__/harness-initiative-infer-task-plan.test.js`

- [ ] **Step 1: 写失败 unit test**

```javascript
import { describe, it, expect, vi } from 'vitest';

// 直接 import 待测函数
import { inferTaskPlanNode } from '../harness-initiative.graph.js';

describe('inferTaskPlanNode catch 行为 [BEHAVIOR]', () => {
  it('git show 失败时应返回 { error: ... } 让 graph 走 error → END', async () => {
    // 构造 state：propose_branch 不存在 origin → git show 必失败
    const state = {
      taskPlan: null,
      ganResult: { propose_branch: 'cp-harness-propose-r1-DOESNOTEXIST00000' },
      worktreePath: '/Users/administrator/perfect21/cecelia',
      initiativeId: 'test-init',
    };
    const delta = await inferTaskPlanNode(state);
    // 修复后：catch 块返 { error: msg }
    expect(delta).toHaveProperty('error');
    expect(String(delta.error)).toMatch(/git show origin/i);
  });

  it('已有非空 taskPlan.tasks 时应 passthrough（幂等）', async () => {
    const state = {
      taskPlan: { tasks: [{ task_id: 'ws1' }] },
      ganResult: { propose_branch: 'whatever' },
      worktreePath: '/tmp',
    };
    const delta = await inferTaskPlanNode(state);
    expect(delta).toEqual({});
  });
});
```

- [ ] **Step 2: 运行测试，确认 fail**

Run: `cd /Users/administrator/worktrees/cecelia/2819-task-plan-fix && npx vitest run packages/brain/src/workflows/__tests__/harness-initiative-infer-task-plan.test.js --reporter=verbose 2>&1 | tail -30`
Expected: 第一个测试 FAIL（当前 catch 返 `{}`，没有 `error` 属性）；第二个 PASS

- [ ] **Step 3: Commit-1**

```bash
cd /Users/administrator/worktrees/cecelia/2819-task-plan-fix
git add packages/brain/src/workflows/__tests__/harness-initiative-infer-task-plan.test.js
git commit -m "test(brain): inferTaskPlanNode catch 应抛错 (red)

Red commit: 当前 catch console.warn + return {} → 修复后改 return { error }。
含幂等 passthrough 的 sanity test。"
```

---

### Task 3: inferTaskPlan 修复 (TDD Green)

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js` 行 844-847

- [ ] **Step 1: 改 catch 块**

定位：`packages/brain/src/workflows/harness-initiative.graph.js:844-847`

当前代码：
```javascript
} catch (err) {
  console.warn(`[infer_task_plan] git show origin/${proposeBranch}:... failed: ${err.message}`);
  return {};
}
```

改为：
```javascript
} catch (err) {
  const msg = `[infer_task_plan] git show origin/${proposeBranch}:${sprintDir}/task-plan.json failed: ${err.message}`;
  console.error(msg);
  return { error: msg };  // 走 stateHasError → error → END，触发 alert（不再静默"软坏"）
}
```

- [ ] **Step 2: 运行 unit test，确认 PASS**

Run: `cd /Users/administrator/worktrees/cecelia/2819-task-plan-fix && npx vitest run packages/brain/src/workflows/__tests__/harness-initiative-infer-task-plan.test.js --reporter=verbose 2>&1 | tail -20`
Expected: 两个测试都 PASS

- [ ] **Step 3: 跑一下整文件测试，确保没回归**

Run: `cd /Users/administrator/worktrees/cecelia/2819-task-plan-fix && npx vitest run packages/brain/src/workflows/__tests__/ --reporter=verbose 2>&1 | tail -40`
Expected: 全 PASS（如果原仓有其他 graph 测试，保证没破）

- [ ] **Step 4: Commit-2（TDD Green）**

```bash
cd /Users/administrator/worktrees/cecelia/2819-task-plan-fix
git add packages/brain/src/workflows/harness-initiative.graph.js
git commit -m "fix(brain): inferTaskPlan catch 改返 { error } 让 graph 硬 fail (#2819)

当前 git show 失败被静默成 console.warn + return {}，导致 taskPlan
留 null → pick_sub_task 跳 final_evaluate → 软 FAIL 无 alert。

改返 { error: msg } 让 stateHasError 路由把图引向 error → END，立即
触发 P1 alert，避免类似 'pipeline 静默坏几个月没人察觉' 的事故。

Green commit (Task 2 red test 配套)。"
```

---

### Task 4: harness-gan proposer access 校验 unit test (TDD Red)

**Files:**
- Create: `packages/brain/src/workflows/__tests__/harness-gan-proposer-validation.test.js`

- [ ] **Step 1: 写失败 unit test（mock executor 模拟 proposer SKILL 跑完）**

```javascript
import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';

import { createGanContractNodes } from '../harness-gan.graph.js';

describe('GAN proposer node task-plan.json access 校验 [BEHAVIOR]', () => {
  it('proposer 跑完缺 sprints/task-plan.json 时应打 console.warn 不抛错', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'gan-proposer-test-'));
    try {
      // 不创建 sprints/ 目录 → access 必失败
      const fakeExecutor = vi.fn().mockResolvedValue({
        exit_code: 0,
        stdout: '{"verdict":"PROPOSED","propose_branch":"cp-test-r1-abc","workstream_count":1}',
        cost_usd: 0.01,
      });
      const fakeReadContract = vi.fn().mockResolvedValue('# fake contract');

      const { proposer } = createGanContractNodes(fakeExecutor, {
        taskId: 'test-task', initiativeId: 'test-init', sprintDir: 'sprints',
        worktreePath: tmp, githubToken: 'fake', readContractFile: fakeReadContract,
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = await proposer({ round: 0, prdContent: 'x', feedback: null, costUsd: 0 });

      expect(result).toMatchObject({ proposeBranch: 'cp-test-r1-abc', round: 1 });
      // 修复后：缺 task-plan.json 必触发 warn
      const warnMsg = warnSpy.mock.calls.flat().join(' ');
      expect(warnMsg).toMatch(/missing.*task-plan\.json/i);
      warnSpy.mockRestore();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('proposer 跑完 sprints/task-plan.json 存在时不应 warn', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'gan-proposer-test-'));
    try {
      await mkdir(path.join(tmp, 'sprints'), { recursive: true });
      await writeFile(path.join(tmp, 'sprints', 'task-plan.json'), '{"tasks":[]}');

      const fakeExecutor = vi.fn().mockResolvedValue({
        exit_code: 0,
        stdout: '{"propose_branch":"cp-test-r1-abc"}',
        cost_usd: 0.01,
      });
      const fakeReadContract = vi.fn().mockResolvedValue('# fake');

      const { proposer } = createGanContractNodes(fakeExecutor, {
        taskId: 'test-task', initiativeId: 'test-init', sprintDir: 'sprints',
        worktreePath: tmp, githubToken: 'fake', readContractFile: fakeReadContract,
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await proposer({ round: 0, prdContent: 'x', feedback: null, costUsd: 0 });

      const warnMsg = warnSpy.mock.calls.flat().join(' ');
      expect(warnMsg).not.toMatch(/missing.*task-plan\.json/i);
      warnSpy.mockRestore();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: 运行测试，确认 fail（第一个测试 fail，第二个 pass）**

Run: `cd /Users/administrator/worktrees/cecelia/2819-task-plan-fix && npx vitest run packages/brain/src/workflows/__tests__/harness-gan-proposer-validation.test.js --reporter=verbose 2>&1 | tail -30`
Expected: 第一个 FAIL（当前 proposer 没做 access 校验），第二个 PASS

- [ ] **Step 3: Commit-1（TDD Red）**

```bash
cd /Users/administrator/worktrees/cecelia/2819-task-plan-fix
git add packages/brain/src/workflows/__tests__/harness-gan-proposer-validation.test.js
git commit -m "test(brain): GAN proposer 缺 task-plan.json 应 warn (red)

Red commit: 当前 proposer node 不校验文件存在，修复后加 access 检查。"
```

---

### Task 5: harness-gan proposer 加 access 校验 (TDD Green)

**Files:**
- Modify: `packages/brain/src/workflows/harness-gan.graph.js` proposer 函数

- [ ] **Step 1: import access**

定位：`packages/brain/src/workflows/harness-gan.graph.js:22`

当前：
```javascript
import { readFile } from 'node:fs/promises';
```

改为：
```javascript
import { readFile, access } from 'node:fs/promises';
```

- [ ] **Step 2: proposer() 加校验段**

定位：proposer 函数 L298-333，在 `const proposeBranch = ...` 之后、`return {...}` 之前。

当前：
```javascript
const proposeBranch = extractProposeBranch(result.stdout) || fallbackProposeBranch(taskId);
return {
  round: nextRound,
  costUsd: (state.costUsd || 0) + Number(result.cost_usd || 0),
  contractContent,
  proposeBranch,
};
```

改为：
```javascript
const proposeBranch = extractProposeBranch(result.stdout) || fallbackProposeBranch(taskId);

// 防御：proposer SKILL 应每轮写 sprints/task-plan.json（v7.1.0+），缺失打 warn 给下游兜底
const taskPlanPath = path.join(worktreePath, sprintDir, 'task-plan.json');
try {
  await access(taskPlanPath);
} catch {
  console.warn(`[harness-gan] proposer round=${nextRound} missing ${sprintDir}/task-plan.json — inferTaskPlan 拿不到 DAG 时会 hard fail`);
}

return {
  round: nextRound,
  costUsd: (state.costUsd || 0) + Number(result.cost_usd || 0),
  contractContent,
  proposeBranch,
};
```

- [ ] **Step 3: 运行 unit test，确认两个都 PASS**

Run: `cd /Users/administrator/worktrees/cecelia/2819-task-plan-fix && npx vitest run packages/brain/src/workflows/__tests__/harness-gan-proposer-validation.test.js --reporter=verbose 2>&1 | tail -20`
Expected: 两个测试都 PASS

- [ ] **Step 4: 跑全 workflows 测试确保无回归**

Run: `cd /Users/administrator/worktrees/cecelia/2819-task-plan-fix && npx vitest run packages/brain/src/workflows/__tests__/ --reporter=verbose 2>&1 | tail -30`
Expected: 全 PASS

- [ ] **Step 5: Commit-2（TDD Green）**

```bash
cd /Users/administrator/worktrees/cecelia/2819-task-plan-fix
git add packages/brain/src/workflows/harness-gan.graph.js
git commit -m "fix(brain): GAN proposer node 加 task-plan.json access 校验 (#2819)

防御层 — SKILL v7.1.0+ 期望每轮写 sprints/task-plan.json，但 LLM
偶发漏写时不阻断本轮 GAN（warn 让人/告警系统看见即可，下游
inferTaskPlan 会硬 fail 兜底）。

Green commit (Task 4 red test 配套)。"
```

---

### Task 6: SKILL.md 修复（核心 fix，单 commit 无 test）

**Files:**
- Modify: `packages/workflows/skills/harness-contract-proposer/SKILL.md`

- [ ] **Step 1: bump version**

定位：L7

当前：
```
version: 7.0.0
```

改为：
```
version: 7.1.0
```

- [ ] **Step 2: 加 changelog 7.1.0 条目**

定位：L10 changelog 列表头

当前：
```
changelog:
  - 7.0.0: Golden Path 合同 — ...
```

改为：
```
changelog:
  - 7.1.0: 修复 task-plan.json 永不生成 (#2819) — Step 3 改成每轮都生成（删 "仅 APPROVED 时执行" 门槛）；APPROVED 分支即最后一轮 proposer 的分支，inferTaskPlan 从此读取
  - 7.0.0: Golden Path 合同 — ...
```

- [ ] **Step 3: 删 Step 3 起首的 APPROVED 门槛说明**

定位：L246-247

当前：
```
**仅在 Reviewer 输出 APPROVED 时执行**（每轮 REVISION 跳过此步，继续对抗）：
```

改为：
```
**每轮都生成**（REVISION 轮的 task-plan 在被打回的分支上无害；APPROVED 即最后一轮 proposer 的分支，inferTaskPlan 从此读取）：
```

- [ ] **Step 4: 改 git add 注释**

定位：L307

当前：
```bash
        "${SPRINT_DIR}/task-plan.json" 2>/dev/null  # 仅 GAN APPROVED 后才有此文件，REVISION 轮跳过
```

改为：
```bash
        "${SPRINT_DIR}/task-plan.json" 2>/dev/null  # 每轮生成；2>/dev/null 防御 LLM 偶发漏写（下游 inferTaskPlan 兜底报错）
```

- [ ] **Step 5: 删禁止事项 #4**

定位：L337

当前：
```
4. **GAN 未 APPROVED 就输出 task-plan.json** → 任务拆分必须在合同确认后
5. **禁止在 main 分支操作**
```

改为：
```
4. **禁止在 main 分支操作**
```

（条目编号自然下移）

- [ ] **Step 6: 验 SKILL.md 改对了**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/2819-task-plan-fix
SKILL=packages/workflows/skills/harness-contract-proposer/SKILL.md
grep -q "version: 7.1.0" $SKILL && echo "✅ version OK" || echo "❌ version FAIL"
grep -q "7.1.0:" $SKILL && echo "✅ changelog OK" || echo "❌ changelog FAIL"
grep -q "仅在 Reviewer 输出 APPROVED 时执行" $SKILL && echo "❌ 残留旧门槛" || echo "✅ 旧门槛已删"
grep -q "GAN 未 APPROVED 就输出 task-plan.json" $SKILL && echo "❌ 残留旧禁条" || echo "✅ 旧禁条已删"
```

Expected: 4 个 ✅

- [ ] **Step 7: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/2819-task-plan-fix
git add packages/workflows/skills/harness-contract-proposer/SKILL.md
git commit -m "fix(workflows): proposer SKILL 每轮都写 task-plan.json (#2819)

核心 bug 修复 — Harness v8 把 task-plan 拆出权交 proposer，但
Step 3 门槛是 '仅 APPROVED 时执行'，proposer 看不到 reviewer 判决，
永远不写 → inferTaskPlan 永远拿不到 DAG → pipeline 软 FAIL。

改成每轮都写：REVISION 轮的 task-plan 在被打回分支上无害；APPROVED
即最后一轮 proposer 分支，inferTaskPlan 从此读取（GAN reducer 取
最新 propose_branch，符合预期）。

bump 7.0.0 → 7.1.0，删禁止事项 #4，改 git add 注释。"
```

---

### Task 7: smoke.sh 端到端实现（让 v18.7.0 smoke 强规则过关）

**Files:**
- Modify: `packages/brain/scripts/smoke/harness-task-plan-smoke.sh`

- [ ] **Step 1: 把 smoke 写完整**

```bash
#!/usr/bin/env bash
# harness-task-plan-smoke.sh — 验证 harness_initiative pipeline task-plan.json 链路
# 端到端：构造 git fixture（裸仓 + worktree） → mock proposer push task-plan.json
#        → 调 inferTaskPlanNode → 验 tasks.length >= 1
#        → 反向：删文件 → 验返回 { error: ... }
# 不依赖 LLM，纯 JS 函数调用 + git fixture

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
TMP=$(mktemp -d -t harness-smoke-XXXXXX)
trap 'rm -rf "$TMP"' EXIT

cd "$TMP"

# 1. 起裸仓 + 工作仓
git init --bare origin.git >/dev/null
git clone -q origin.git work
cd work
git config user.email smoke@cecelia
git config user.name smoke
echo "init" > README.md
git add README.md
git commit -qm init
git push -q origin master 2>/dev/null || git push -q origin main

# 2. mock proposer：在新分支 cp-harness-propose-r1-smoke 写 sprints/task-plan.json + push
PROPOSE_BRANCH=cp-harness-propose-r1-smoke
git checkout -qb "$PROPOSE_BRANCH"
mkdir -p sprints
cat > sprints/task-plan.json <<EOF
{
  "initiative_id": "smoke-init",
  "journey_type": "dev_pipeline",
  "tasks": [
    { "task_id": "ws1", "title": "smoke fixture task", "scope": "noop",
      "dod": ["[BEHAVIOR] smoke 验证"], "files": ["README.md"],
      "depends_on": [], "complexity": "S", "estimated_minutes": 30 }
  ]
}
EOF
git add sprints/task-plan.json
git commit -qm "test: mock proposer push task-plan.json"
git push -q origin "$PROPOSE_BRANCH"

# 3. 正路径：调 inferTaskPlanNode，验 tasks.length >= 1
cd "$REPO_ROOT"
POSITIVE_RESULT=$(node -e "
import('$REPO_ROOT/packages/brain/src/workflows/harness-initiative.graph.js').then(async m => {
  const delta = await m.inferTaskPlanNode({
    taskPlan: null,
    ganResult: { propose_branch: '$PROPOSE_BRANCH' },
    worktreePath: '$TMP/work',
    initiativeId: 'smoke-init',
  });
  if (!delta.taskPlan || !Array.isArray(delta.taskPlan.tasks) || delta.taskPlan.tasks.length < 1) {
    console.error('FAIL positive: ' + JSON.stringify(delta));
    process.exit(1);
  }
  console.log('OK positive tasks=' + delta.taskPlan.tasks.length);
}).catch(e => { console.error('FAIL positive err: ' + e.message); process.exit(1); });
")
echo "$POSITIVE_RESULT"

# 4. 反路径：删文件 + push --force-with-lease，验返回 { error: ... }
cd "$TMP/work"
git rm sprints/task-plan.json
git commit -qm "test: remove task-plan.json"
git push -q --force-with-lease origin "$PROPOSE_BRANCH"

cd "$REPO_ROOT"
NEGATIVE_RESULT=$(node -e "
import('$REPO_ROOT/packages/brain/src/workflows/harness-initiative.graph.js').then(async m => {
  const delta = await m.inferTaskPlanNode({
    taskPlan: null,
    ganResult: { propose_branch: '$PROPOSE_BRANCH' },
    worktreePath: '$TMP/work',
    initiativeId: 'smoke-init',
  });
  if (!delta.error) {
    console.error('FAIL negative: 期望 error 字段，实际 ' + JSON.stringify(delta));
    process.exit(1);
  }
  console.log('OK negative error=' + String(delta.error).slice(0, 60));
}).catch(e => { console.error('FAIL negative err: ' + e.message); process.exit(1); });
")
echo "$NEGATIVE_RESULT"

echo "✅ smoke 通过：正路径 tasks ≥ 1，反路径返 error"
exit 0
```

- [ ] **Step 2: 跑 smoke**

Run: `cd /Users/administrator/worktrees/cecelia/2819-task-plan-fix && bash packages/brain/scripts/smoke/harness-task-plan-smoke.sh 2>&1 | tail -10`
Expected: 输出 `OK positive tasks=1` + `OK negative error=...` + `✅ smoke 通过` + exit 0

- [ ] **Step 3: Commit-2（smoke 完成）**

```bash
cd /Users/administrator/worktrees/cecelia/2819-task-plan-fix
git add packages/brain/scripts/smoke/harness-task-plan-smoke.sh
git commit -m "test(brain): smoke 完整实现 — harness task-plan E2E (green)

构造 git fixture（裸仓+工作仓）+ mock proposer push task-plan.json，
直接 require inferTaskPlanNode 跑正反路径：
  - 正：tasks.length >= 1
  - 反：删文件后 delta.error 必有

无 LLM 依赖，本机 + CI real-env-smoke job 均可跑。"
```

---

### Task 8: Learning 文档 + 跑全测一次

**Files:**
- Create: `docs/learnings/cp-0507110424-2819-task-plan-fix.md`

- [ ] **Step 1: 写 learning（per CLAUDE.md "Learning 文件 必须在第一次 push 前写好"）**

```markdown
# Learning: harness_initiative task-plan.json 永不生成 (#2819)

**日期**: 2026-05-07  
**Branch**: cp-0507110424-2819-task-plan-fix  
**PR**: TBD（push 后填）

## 现象

ab1c3887 等 harness_initiative 任务跑 3+ attempt 全栽。诊断时误判为
"proposer 不 push branch"，4 路并行探员之一（D 域）实证 origin
**实际有** propose 分支，dry-run push 报 "Everything up-to-date"。

## 根本原因

Harness v8 把 task-plan 拆出权从 planner 转给 proposer，但 SKILL Step 3
设计了一个**逻辑上无法满足**的门槛：

> "仅在 Reviewer 输出 APPROVED 时执行"

而 GAN graph 流程是 reviewer APPROVED → END，proposer 永远没机会再跑。
proposer 自己也看不到 reviewer 判决，无法做条件门 → task-plan.json
永远不被写。所有 propose 分支（含历史成功 case）实证零文件。

下游 inferTaskPlan 静默 catch（console.warn + return {}）让失败不报错，
graph 跳过 sub_task 直奔 final_evaluate FAIL，整条 pipeline 软坏数月无人察觉。

## 下次预防

- [ ] Skill 设计任何"仅在某条件下执行"门槛时，必须先确认门槛信号能流到 SKILL（proposer 看不到 reviewer，门槛从一开始就坏）
- [ ] LangGraph 节点 catch 块禁止 console.warn + return {} 静默吞错；要 hard fail 触发 alert，要么 retry，二选一
- [ ] 任何 v 大版本切换（v7→v8 这种）必须有 smoke E2E 验关键文件链路（这次有就立刻发现）
- [ ] 4 路并行诊断模式：先并行收证据再综合定位，比一路顺查省 5x 时间

## 修复

3 处定点：
1. SKILL.md Step 3：删 APPROVED 门槛，每轮都写 task-plan.json
2. harness-gan.graph.js proposer node：access 校验（warn 不抛错）
3. harness-initiative.graph.js inferTaskPlan：catch 改 return { error } 走 stateHasError
```

- [ ] **Step 2: 跑全 packages/brain workflows 测试一次最终验证**

Run: `cd /Users/administrator/worktrees/cecelia/2819-task-plan-fix && npx vitest run packages/brain/src/workflows/__tests__/ --reporter=verbose 2>&1 | tail -30`
Expected: 全 PASS

- [ ] **Step 3: 跑 smoke 一次最终验证**

Run: `cd /Users/administrator/worktrees/cecelia/2819-task-plan-fix && bash packages/brain/scripts/smoke/harness-task-plan-smoke.sh 2>&1 | tail -5`
Expected: ✅ smoke 通过 + exit 0

- [ ] **Step 4: Commit Learning**

```bash
cd /Users/administrator/worktrees/cecelia/2819-task-plan-fix
git add docs/learnings/cp-0507110424-2819-task-plan-fix.md
git commit -m "docs(learnings): #2819 task-plan.json 永不生成根因 + 预防 (TODO PR#)"
```

---

## 完成后交接

Plan 全部 task 完成后，下一步：
1. Skill `superpowers:finishing-a-development-branch` → push + 创 PR
2. Skill `engine-ship` 收尾（Brain 任务回写 + cleanup）

---

## Self-Review

**Spec coverage**:
- ✅ SKILL 改 → Task 6
- ✅ inferTaskPlan 硬 fail → Task 2-3
- ✅ proposer access 校验 → Task 4-5
- ✅ smoke E2E → Task 1+7
- ✅ 测试策略 → 4 档分类已落到具体 task（unit + smoke）
- ✅ 风险登记 → spec 含 3 条，learning 文档化

**Placeholder scan**: 无 TBD/TODO 留在执行步骤里（PR# 在 push 后才有，已注 TODO）

**Type consistency**: inferTaskPlanNode 函数名、createGanContractNodes、proposer/reviewer 节点等命名跨 task 一致
