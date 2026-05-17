# B14 — Harness Pipeline 4 Fix（让 P1 真过得去）

## 问题

W19-W36 全部跑挂，根因不在基础设施（B1-B13 已修齐），在 4 个工艺/协议 hole：

1. **(硬阻塞) evaluator 看错代码** — `harness-task.graph.js:455-468` evaluateContractNode spawn evaluator container 时 env 没传 PR_BRANCH。Evaluator container 起在 initiative 主 worktree（base=main），跑 server 看不到 generator 在 PR 分支写的代码 → 永远 verdict=FAIL。
2. **(硬阻塞) evaluator skill 没指令切分支** — `harness-evaluator/SKILL.md` 1.3.0 Step 0 只判断 mode，从没要求 `git fetch` / `git checkout` PR 分支。LLM evaluator 拿到 PR_URL 也不会自动切。
3. **(工艺) proposer 不切 ws** — `harness-contract-proposer/SKILL.md` 7.6.0 写了 size 阈值 S/M/L 但**没硬规则**强制切。W36 实证 proposer 把 335 行三文件塞 ws1 一个 sub-task。
4. **(工艺) planner 写过厚 PRD** — `harness-planner/SKILL.md` 没 thin slice 字数上限。W36 实证 planner 把"加一个 /decrement endpoint"写成 254 行 PRD + 32 DoD 条目，触发 proposer 切不动。

## 设计

### 改动 1：harness-task.graph.js — env 传 PR_BRANCH

evaluateContractNode 内 spawnFn 前增加 PR_BRANCH 解析：

```javascript
let prBranchEnv = state.pr_branch || '';
if (!prBranchEnv && state.pr_url) {
  try {
    const { stdout } = await execFile('gh', ['pr', 'view', state.pr_url, '--json', 'headRefName', '-q', '.headRefName'], { timeout: 10_000 });
    prBranchEnv = stdout.trim();
  } catch (err) {
    console.warn(`[evaluate_contract] gh pr view fallback failed: ${err.message}`);
  }
}

env: {
  ...accountEnv,
  CECELIA_TASK_TYPE: 'harness_evaluate',
  HARNESS_NODE: 'evaluate_contract',
  // ...其他不变
  PR_URL: state.pr_url || '',
  PR_BRANCH: prBranchEnv,  // ← 新增
  // ...其他不变
}
```

### 改动 2：harness-evaluator/SKILL.md — 新增 Step 0：切 PR 分支

在 Step 0 「模式判断」 之前增加 Step 0a：

```markdown
## Step 0a：切到 PR 分支（pre-merge gate 前置）

evaluator 必须先切到 PR 分支才能跑 server 验真行为。Step A 模式（contract-dod 验）跑 generator 写的代码，所在分支由 `$PR_BRANCH` env 提供。

```bash
if [ -n "$PR_BRANCH" ]; then
  git fetch origin "$PR_BRANCH:$PR_BRANCH" 2>/dev/null || git fetch origin "$PR_BRANCH"
  git checkout "$PR_BRANCH" || { echo "FATAL: checkout $PR_BRANCH failed"; exit 1; }
  git reset --hard "origin/$PR_BRANCH" 2>/dev/null || true
fi
```

模式 B（IS_FINAL_E2E=true，final_evaluate）跑 main，不切。

**反例**：跳过 Step 0a 直接跑 main 上的 server → generator 改动看不见 → 永远 FAIL（W19-W36 9 次实证）。
```

### 改动 3：harness-contract-proposer/SKILL.md — 单 ws 硬阈值

在 `## Workstreams` 段加硬规则：

```markdown
## Workstreams 切分硬规则（v7.7 新增）

**死规则**：
1. **单 workstream ≤ 200 行净增 + ≤ 3 文件** — 超就强制再切。
2. **整 contract 净增 < 200 行**时才允许 workstream_count=1。
3. **proposer 自查 checklist 加第 6 条**：算每 ws 预期 LoC，超 200 强制切。

**反例**（W36 实证）：planner 写"加 /decrement endpoint" PRD 254 行，proposer 没切，ws1 塞 server.js + tests + README 三文件 335 行 → generator 一次写不对 → fix loop 3 round → FAIL。

**正例**：W36 应切 3 ws：(1) ws1 server.js 路由 ~50 行 S；(2) ws2 tests 套件 ~150 行 M；(3) ws3 README ~70 行 S；ws2 依赖 ws1。
```

### 改动 4：harness-planner/SKILL.md — thin slice 字数上限

在 thin slice 段加：

```markdown
## Thin Slice 字数硬上限（v8.X 新增）

为防止 planner 把 thin slice 写成 medium thick spec（W36 实证 254 行 PRD），加硬上限：

- **thin slice PRD ≤ 50 行**（不含 OKR 对齐段和"为什么选这个 feature"叙事）
- **thin slice DoD ≤ 8 条**（不分 BEHAVIOR/ARTIFACT 总数 ≤ 8）
- 超过 → planner 自审 reject + 强制砍范围 / 拆 multi-sprint

**反例**：W36 planner 写 254 行 PRD + 32 DoD 条目，引用 W19-W26 全部历史 + B1-B13 全部 fix 上下文 → 不是 thin slice 是 medium thick。
**正例**：W37 thin slice 应是"playground 加 GET /ping 返 {pong:true,ts:<unix>}"，PRD < 30 行 + DoD ≤ 5 条。
```

### 改动 5：单测 — 验 evaluator spawn env 含 PR_BRANCH

新文件 `packages/brain/src/workflows/__tests__/harness-task-evaluator-pr-branch.test.js`：

```javascript
import { describe, it, expect, vi } from 'vitest';
import { evaluateContractNode } from '../harness-task.graph.js';

describe('B14: evaluator spawn env 含 PR_BRANCH', () => {
  it('当 state.pr_branch 有值时，spawn env.PR_BRANCH = state.pr_branch', async () => {
    const spawnDetached = vi.fn().mockResolvedValue();
    const resolveToken = vi.fn().mockResolvedValue('fake-token');
    const poolOverride = {
      query: vi.fn().mockResolvedValue({}),
    };

    await evaluateContractNode(
      {
        task: { id: 'test-task-uuid', task_type: 'harness_evaluate', payload: { sprint_dir: 'sprints/x' } },
        initiativeId: 'test-init',
        pr_url: 'https://github.com/x/y/pull/123',
        pr_branch: 'cp-test-pr-branch',
        contractBranch: 'cp-proposer-branch',
        worktreePath: '/tmp/x',
        githubToken: 'fake-token',
        fix_round: 0,
      },
      { spawnDetached, resolveToken, poolOverride }
    );

    expect(spawnDetached).toHaveBeenCalledOnce();
    const env = spawnDetached.mock.calls[0][0].env;
    expect(env.PR_BRANCH).toBe('cp-test-pr-branch');
    expect(env.PR_URL).toBe('https://github.com/x/y/pull/123');
  });
});
```

## 测试策略

按 Cecelia 测试金字塔，本变更属 **unit test** 档（mock spawnFn 验 spawn opts.env）+ **manual:node grep** 验 4 个 skill 文件改动。

W37 真任务派发是 follow-up 验证（不在本 PR 范围）。

## DoD

- [BEHAVIOR] harness-task.graph.js evaluate_contract spawn env 含 PR_BRANCH 字段
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');if(!c.match(/PR_BRANCH\s*:\s*prBranchEnv/))process.exit(1)"`
- [BEHAVIOR] harness-evaluator/SKILL.md 含 git checkout PR_BRANCH 指令
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-evaluator/SKILL.md','utf8');if(!c.match(/git checkout.*PR_BRANCH/))process.exit(1)"`
- [BEHAVIOR] harness-contract-proposer/SKILL.md 含 200 行硬阈值
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-proposer/SKILL.md','utf8');if(!c.match(/200.行/))process.exit(1)"`
- [BEHAVIOR] harness-planner/SKILL.md 含 thin slice 50 行上限
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!c.match(/PRD.*≤.*50|thin.*50.行/))process.exit(1)"`
- [BEHAVIOR] 单测 evaluator-pr-branch.test.js PASS
  Test: `tests/workflows/__tests__/harness-task-evaluator-pr-branch.test.js`
