# Phase A — attempt-loop 真循环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `spawn()` 从纯 wrapper 改成真 `for (attempt in 0..MAX_ATTEMPTS)` 循环，失败后调 `classifyFailure` + `shouldRetry` 判决，激活 P2 建未接线的 retry-circuit middleware。

**Architecture:** spawn.js 外层加 for 循环，executeInDocker 内部不动（内层 cap-marking + account-rotation 自愈换号；spawn 层不主动改 opts.env）。spawn.test.js 从 3 cases 扩到 7 cases，Mock `executeInDocker` 返回值序列覆盖 success / transient / permanent / MAX 边界。

**Tech Stack:** Node.js ESM + vitest + 现有 `retry-circuit.js` 导出（classifyFailure/shouldRetry）。

---

## File Structure

- **Modify**: `packages/brain/src/spawn/spawn.js`（31 → ~75 行）
- **Modify**: `packages/brain/src/spawn/__tests__/spawn.test.js`（36 → ~220 行）
- **No new files**（不引入 flag / 不抽 helper / 不改 caller）

---

## Task 1: 扩 spawn.test.js 到 7 cases（Red 阶段）

**Files:**
- Modify: `packages/brain/src/spawn/__tests__/spawn.test.js`

**Rationale:** 先把全部 7 cases 写好并 fail，再实现 spawn.js for 循环让它们全 pass。

- [ ] **Step 1.1: 覆盖写 spawn.test.js**

替换整个文件为：

```javascript
/**
 * spawn() attempt-loop 测试。
 * 覆盖：
 *   1. success first try
 *   2. transient → success
 *   3. transient × MAX → give up
 *   4. permanent → 不重试
 *   5. 429 transient → spawn 不删 env（换号责任留内层）
 *   6. shouldRetry 返回 false → 提前退
 *   7. MAX_ATTEMPTS 边界（恰好 3 次）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecuteInDocker = vi.fn();
vi.mock('../../docker-executor.js', () => ({
  executeInDocker: (...args) => mockExecuteInDocker(...args),
}));

const mockShouldRetry = vi.fn();
vi.mock('../middleware/retry-circuit.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    shouldRetry: (...args) => mockShouldRetry(...args),
  };
});

// Helpers
function successResult() {
  return { exit_code: 0, stdout: 'ok', stderr: '', duration_ms: 100, timed_out: false };
}
function transientTimeout() {
  return { exit_code: 124, stdout: '', stderr: 'timeout', duration_ms: 30000, timed_out: true };
}
function permanentOOM() {
  return { exit_code: 137, stdout: '', stderr: 'killed', duration_ms: 500, timed_out: false };
}
function transient429() {
  return { exit_code: 1, stdout: '', stderr: 'api_error_status: 429', duration_ms: 200, timed_out: false };
}

describe('spawn() attempt-loop', () => {
  beforeEach(() => {
    mockExecuteInDocker.mockReset();
    mockShouldRetry.mockReset();
    // 默认 shouldRetry 用真实实现（除 case 6 会覆盖）
    mockShouldRetry.mockImplementation((cls, idx, max = 3) => {
      if (!cls) return false;
      if (cls.class !== 'transient') return false;
      return idx + 1 < max;
    });
  });

  it('exports spawn as async function', async () => {
    const { spawn } = await import('../spawn.js');
    expect(typeof spawn).toBe('function');
  });

  it('case 1: success first try — 调 1 次，返回该 result', async () => {
    const { spawn } = await import('../spawn.js');
    mockExecuteInDocker.mockResolvedValueOnce(successResult());
    const result = await spawn({ task: { id: 't1' }, prompt: 'hi' });
    expect(mockExecuteInDocker).toHaveBeenCalledTimes(1);
    expect(result.exit_code).toBe(0);
  });

  it('case 2: transient → success — attempt 0 超时，attempt 1 成功', async () => {
    const { spawn } = await import('../spawn.js');
    mockExecuteInDocker
      .mockResolvedValueOnce(transientTimeout())
      .mockResolvedValueOnce(successResult());
    const result = await spawn({ task: { id: 't2' }, prompt: 'x' });
    expect(mockExecuteInDocker).toHaveBeenCalledTimes(2);
    expect(result.exit_code).toBe(0);
  });

  it('case 3: transient × 3 → give up，返回最后失败 result', async () => {
    const { spawn } = await import('../spawn.js');
    mockExecuteInDocker
      .mockResolvedValueOnce(transientTimeout())
      .mockResolvedValueOnce(transientTimeout())
      .mockResolvedValueOnce(transientTimeout());
    const result = await spawn({ task: { id: 't3' }, prompt: 'x' });
    expect(mockExecuteInDocker).toHaveBeenCalledTimes(3);
    expect(result.timed_out).toBe(true);
    expect(result.exit_code).toBe(124);
  });

  it('case 4: permanent 不重试 — exit_code 137 立即返回', async () => {
    const { spawn } = await import('../spawn.js');
    mockExecuteInDocker.mockResolvedValueOnce(permanentOOM());
    const result = await spawn({ task: { id: 't4' }, prompt: 'x' });
    expect(mockExecuteInDocker).toHaveBeenCalledTimes(1);
    expect(result.exit_code).toBe(137);
  });

  it('case 5: 429 transient — spawn 层不删 opts.env.CECELIA_CREDENTIALS', async () => {
    const { spawn } = await import('../spawn.js');
    mockExecuteInDocker
      .mockResolvedValueOnce(transient429())
      .mockResolvedValueOnce(successResult());
    const opts = {
      task: { id: 't5' },
      prompt: 'x',
      env: { CECELIA_CREDENTIALS: 'account1', OTHER: 'keep' },
    };
    const result = await spawn(opts);
    expect(mockExecuteInDocker).toHaveBeenCalledTimes(2);
    expect(result.exit_code).toBe(0);
    // 核心断言：spawn 层未主动 delete env — 换号责任留给内层 account-rotation
    expect(opts.env.CECELIA_CREDENTIALS).toBe('account1');
    expect(opts.env.OTHER).toBe('keep');
  });

  it('case 6: shouldRetry 返回 false → 提前退循环', async () => {
    const { spawn } = await import('../spawn.js');
    mockShouldRetry.mockReturnValueOnce(false);
    mockExecuteInDocker.mockResolvedValueOnce(transientTimeout());
    const result = await spawn({ task: { id: 't6' }, prompt: 'x' });
    expect(mockExecuteInDocker).toHaveBeenCalledTimes(1);
    expect(result.timed_out).toBe(true);
    expect(mockShouldRetry).toHaveBeenCalledTimes(1);
  });

  it('case 7: MAX_ATTEMPTS 边界 — 恰好调用 3 次', async () => {
    const { spawn } = await import('../spawn.js');
    for (let i = 0; i < 5; i++) {
      mockExecuteInDocker.mockResolvedValueOnce(transientTimeout());
    }
    await spawn({ task: { id: 't7' }, prompt: 'x' });
    expect(mockExecuteInDocker).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 1.2: 跑新测试验证 Red 阶段**

Run（在 worktree 根目录）:
```bash
cd /Users/administrator/worktrees/cecelia/76530023-phase-a-attempt-loop
npx vitest run packages/brain/src/spawn/__tests__/spawn.test.js --reporter=verbose 2>&1 | tail -50
```

Expected:
- case 1 + 4 + 6 会 pass（只调 1 次 executeInDocker，当前实现就是调 1 次）
- case 2 + 3 + 5 + 7 **FAIL**：当前 spawn 只调 1 次 executeInDocker，不重试

至少 3-4 个 case 红。这是正确的 TDD Red。

- [ ] **Step 1.3: 不 commit，留给 Task 2 一起 Green**

---

## Task 2: 实现 spawn.js attempt-loop（Green 阶段）

**Files:**
- Modify: `packages/brain/src/spawn/spawn.js`

- [ ] **Step 2.1: 覆盖写 spawn.js**

替换整个文件为：

```javascript
/**
 * spawn — Brain v2 三层架构 Layer 3（Executor）的唯一对外 API。
 *
 * 详见 docs/design/brain-orchestrator-v2.md §5 + ./README.md。
 *
 * Phase A（v2 P2.5 收尾）：启用真 attempt-loop。每次 iteration 跑 executeInDocker
 * （内部已接 resolveCascade / resolveAccount / runDocker / cap-marking / billing），
 * 失败后调 classifyFailure + shouldRetry 判定是否进入下一轮。
 *
 * 换号策略说明：transient 失败后**不主动删** opts.env.CECELIA_CREDENTIALS。
 * cap 场景由 cap-marking（内层 middleware）标记 → next attempt 的 resolveAccount
 * 读 isSpendingCapped → 自动换号；non-cap transient（网络/超时）保留同账号
 * 就地重试更合理。spawn 层只做循环控制，"用哪号"交 account-rotation 自判。
 *
 * MAX_ATTEMPTS=3 与 dispatch 层 failure_count 独立，最坏 3×3=9 次外层 retry。
 * 如需调整，统一改本常量。
 *
 * @param {object} opts
 * @param {object} opts.task        { id, task_type, ... }
 * @param {string} opts.skill       skill slash-command（如 '/harness-planner'）
 * @param {string} opts.prompt      agent 初始 prompt
 * @param {object} [opts.env]       显式 env
 * @param {number} [opts.timeoutMs]
 * @param {string} [opts.cascade]   模型降级链 override
 * @param {object} [opts.worktree]  { path, branch }
 *
 * @returns {Promise<{ exit_code, stdout, stderr, duration_ms, ... }>}
 */
import { executeInDocker } from '../docker-executor.js';
import { classifyFailure, shouldRetry } from './middleware/retry-circuit.js';

export const SPAWN_MAX_ATTEMPTS = 3;

export async function spawn(opts) {
  let lastResult = null;
  for (let attempt = 0; attempt < SPAWN_MAX_ATTEMPTS; attempt++) {
    const result = await executeInDocker(opts);
    lastResult = result;
    const cls = classifyFailure(result);
    if (cls.class === 'success') return result;
    if (cls.class === 'permanent') return result;
    if (!shouldRetry(cls, attempt, SPAWN_MAX_ATTEMPTS)) return result;
  }
  return lastResult;
}
```

- [ ] **Step 2.2: 跑 spawn 测试验证 Green**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/76530023-phase-a-attempt-loop
npx vitest run packages/brain/src/spawn/__tests__/spawn.test.js --reporter=verbose 2>&1 | tail -40
```

Expected: 8 tests pass（1 smoke + 7 cases），0 fail。

- [ ] **Step 2.3: 跑整个 spawn 子树测试验证现有 middleware 不退化**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/76530023-phase-a-attempt-loop
npx vitest run packages/brain/src/spawn/ --reporter=verbose 2>&1 | tail -50
```

Expected: 所有 middleware 测试（account-rotation / cascade / cap-marking / retry-circuit / docker-run / resource-tier / spawn-pre / logging / cost-cap / billing）全 pass。

- [ ] **Step 2.4: DoD manual 命令验证**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/76530023-phase-a-attempt-loop
node -e "const c=require('fs').readFileSync('packages/brain/src/spawn/spawn.js','utf8'); if(!c.includes('for (let attempt')) process.exit(1); console.log('OK: for loop present')"
wc -l packages/brain/src/spawn/spawn.js
```

Expected:
- 输出 `OK: for loop present`
- spawn.js 行数 ≤ 150（目标 ~60）

- [ ] **Step 2.5: 不 commit，等 Task 3 写 Learning + DoD 勾选一起 commit**

---

## Task 3: Learning 文件 + DoD 勾选 + PRD 落盘

**Files:**
- Create: `docs/learnings/cp-0423201624-76530023-phase-a-attempt-loop.md`
- Modify: `.dev-mode.cp-0423201624-76530023-phase-a-attempt-loop`（DoD checkbox 勾选）
- Create: `sprint-prd.md`（branch-protect hook 可能要求）

- [ ] **Step 3.1: 写 learning 文件**

```bash
cd /Users/administrator/worktrees/cecelia/76530023-phase-a-attempt-loop
cat > docs/learnings/cp-0423201624-76530023-phase-a-attempt-loop.md <<'EOF'
# Phase A — attempt-loop 真循环 Learning

## 做了什么
把 `packages/brain/src/spawn/spawn.js` 从纯 wrapper（31 行）改成真
`for (attempt in 0..SPAWN_MAX_ATTEMPTS)` 循环（~50 行），每次失败调
`classifyFailure` + `shouldRetry` 判三态。激活 P2 PR6 建未接线的 retry-circuit。
spawn.test.js 从 3 cases 扩到 7 cases 覆盖 success / transient×N / permanent /
429 不删 env / shouldRetry false / MAX 边界。

## 根本原因
P2 建了 9 个 middleware 但 spawn.js 仍是"一次 spawn = 一次 attempt"，
retry-circuit 的 classifyFailure/shouldRetry 写好没人调用 → 死代码。spec §5.2
要求真 for 循环，attempt-loop 整合 PR 被 P2 推到最后 Phase A。

## 下次预防
- [ ] middleware 建好未接线的模块，commit message 显式标 "(未接线)"，便于后续整合 PR grep
- [ ] spec §5.2 / roadmap §Phase A 落地前，brainstorming 阶段必查 middleware 的实际调用链（本次就是这样发现 cap-marking + account-rotation 自愈链条，纠正了原 PRD 的 "delete env 换号" 方案）
- [ ] spawn 层改动必测 caller（harness-initiative-runner）不退化，靠 middleware 子树测试覆盖

## 关键决策（偏离原 roadmap）
原 PRD: transient 后 `delete opts.env.CECELIA_CREDENTIALS` 强制换号。
调整为: 不删 env，cap 场景由 cap-marking → next resolveAccount 自动换号；
non-cap transient（ECONNREFUSED/超时）保留同账号重试。理由：单层职责更清晰，
spawn 不跨层修改 env；非 cap transient 换号无益。spec doc §4.1 记录。
EOF
cat docs/learnings/cp-0423201624-76530023-phase-a-attempt-loop.md | head -5
```

- [ ] **Step 3.2: 勾选 .dev-mode DoD checkbox**

查看当前 .dev-mode 内容：
```bash
cd /Users/administrator/worktrees/cecelia/76530023-phase-a-attempt-loop
cat .dev-mode.cp-0423201624-76530023-phase-a-attempt-loop
```

根据 hook 要求，如无 DoD checkbox 则此步可跳过。如有，手动 `[x]` 勾选 — PRD 里的 DoD 已在 `.raw-prd` 文件，不在 .dev-mode。

`.raw-prd-*.md` 的 DoD 勾选：

```bash
cd /Users/administrator/worktrees/cecelia/76530023-phase-a-attempt-loop
sed -i '' 's/^- \[ \] \[BEHAVIOR\] spawn.js 导出/- [x] [BEHAVIOR] spawn.js 导出/' .raw-prd-cp-0423201624-76530023-phase-a-attempt-loop.md
sed -i '' 's/^- \[ \] \[BEHAVIOR\] spawn.test.js/- [x] [BEHAVIOR] spawn.test.js/' .raw-prd-cp-0423201624-76530023-phase-a-attempt-loop.md
sed -i '' 's/^- \[ \] \[ARTIFACT\] spawn.js/- [x] [ARTIFACT] spawn.js/' .raw-prd-cp-0423201624-76530023-phase-a-attempt-loop.md
sed -i '' 's/^- \[ \] \[BEHAVIOR\] 现有其它测试/- [x] [BEHAVIOR] 现有其它测试/' .raw-prd-cp-0423201624-76530023-phase-a-attempt-loop.md
grep '^- \[' .raw-prd-cp-0423201624-76530023-phase-a-attempt-loop.md
```

Expected: 所有 DoD 行都是 `- [x]`。

- [ ] **Step 3.3: 写 sprint-prd.md（branch-protect hook 预期）**

```bash
cd /Users/administrator/worktrees/cecelia/76530023-phase-a-attempt-loop
cp .raw-prd-cp-0423201624-76530023-phase-a-attempt-loop.md sprint-prd.md
ls -la sprint-prd.md
```

- [ ] **Step 3.4: commit**

```bash
cd /Users/administrator/worktrees/cecelia/76530023-phase-a-attempt-loop
git add packages/brain/src/spawn/spawn.js \
        packages/brain/src/spawn/__tests__/spawn.test.js \
        docs/learnings/cp-0423201624-76530023-phase-a-attempt-loop.md \
        .raw-prd-cp-0423201624-76530023-phase-a-attempt-loop.md \
        sprint-prd.md
git status --short
git commit -m "feat(brain): v2 Phase A attempt-loop 真循环 — spawn.js for(attempt) + 7 cases

激活 P2 PR6 建未接线的 retry-circuit middleware。spawn.js 31→~55 行，
每次失败调 classifyFailure + shouldRetry 判三态（success/transient/permanent）。
transient 不主动删 opts.env.CECELIA_CREDENTIALS —— cap 场景由 cap-marking + 
account-rotation 自愈换号（单层职责），non-cap transient 保留同账号重试。

spawn.test.js 3→8 cases：success first try / transient→success / transient×3
give up / permanent 不重试 / 429 不删 env / shouldRetry false 提前退 / MAX 边界。

Task: 76530023-19bd-4879-a5f0-77161fe1162e
Roadmap: docs/design/brain-v2-roadmap-next.md §Phase A

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

Expected: commit 成功（pre-commit hook 可能 delay 几秒跑 facts-check）。

- [ ] **Step 3.5: 自检 commit hash**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/76530023-phase-a-attempt-loop
git log -1 --oneline
git diff HEAD~1 --stat
```

Expected:
- 最新 commit 含 `feat(brain): v2 Phase A attempt-loop`
- diff stat 覆盖 5 个文件（spawn.js + spawn.test.js + learning + raw-prd + sprint-prd）

---

## Task 4: Push + 创建 PR（由 finishing skill 接管）

**不手写 push**。Plan 完成后交 `superpowers:finishing-a-development-branch` skill 选 Option 2（push + PR）。

finishing 后由 `engine-ship` skill 接入 Brain learning fire + CI wait + merge + cleanup。

---

## Self-Review

### 1. Spec coverage

| Spec 要求 | Task |
|---|---|
| §3 架构：spawn.js 外层 for 循环 | Task 2 Step 2.1 |
| §4.1 不删 env | Task 1 case 5 断言 + Task 2 spawn.js 无 delete |
| §4.2 MAX_ATTEMPTS=3 常量化 + JSDoc | Task 2 Step 2.1 `SPAWN_MAX_ATTEMPTS` + JSDoc |
| §4.3 无 sleep | Task 2 Step 2.1 无 setTimeout |
| §4.4 caller 行为保持 | Task 2 Step 2.3 跑 spawn 子树测试 |
| §5.3 7 cases | Task 1 Step 1.1 全部列出 |
| §6 成功标准 1-6 | Task 2 Step 2.4 manual 命令校验 |
| §7 不做 | 无相关步骤（负向确认） |

无遗漏。

### 2. Placeholder scan

无 TBD/TODO/"similar to X"/模糊描述。每段代码都完整。

### 3. Type consistency

- `SPAWN_MAX_ATTEMPTS`（非 `MAX_ATTEMPTS`）全程一致
- `classifyFailure` / `shouldRetry` 签名与 retry-circuit.js:39/74 一致
- `successResult() / transientTimeout() / permanentOOM() / transient429()` 只在 test 定义，不跨任务
