# Kernel attempt 成本回写 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** attempt 经 callback 首次达到终态时向 `initiative_runs.cost_usd` 累加固定记账单价，复活 GAN budget cap。

**Architecture:** 单点修改 `recordCallbackTerminal` 的首次终态事务（run 行已 FOR UPDATE 锁定），块末尾 COMMIT 前追加一条 UPDATE；单价常量入 `constants.js`。这是"每 attempt 固定记账"安全网（callback schema strip 未知键 + provider 不上报用量，真实成本物理不可达——设计文档已定死，不写死代码分支）。

**Tech Stack:** Node.js ESM / pg 事务 / vitest（手搓 client.query mock 队列模式）

## Global Constraints

- 语言：所有代码注释、commit message 简体中文（commit 格式 Conventional Commits）
- TDD：commit-1 = failing test，commit-2 = 实现（禁止无失败测试先写生产代码）
- 单价常量 `ATTEMPT_COST_ACCRUAL_USD = 0.25`（判定点 1391f0c6，不得改值）
- 累加 SQL 必须 `COALESCE(cost_usd, 0) + $2`（防 NULL 静默失效）
- 只在 `!isTerminal` 分支累加（exact-retry 不得重复记账）
- 禁止在本 PR 混入 schema 迁移、fleet-worker 改动、其他 while-I'm-here 修改
- 子代理只 commit，禁止 push / 开 PR / merge / 删 worktree（由主 session 走 engine-ship）

---

### Task 1: 累加逻辑 TDD（核心修复）

**Files:**
- Modify: `packages/brain/src/orchestrator/constants.js`（文件末尾附近新增常量）
- Modify: `packages/brain/src/orchestrator/attempt-store.js`（import 区 + `recordCallbackTerminal` 的 `!isTerminal` 块末尾，插入点在 `if (pullRequest) {...}` 闭括号之后、该块闭括号 `}` 与 `await client.query('COMMIT')` 之前，当前行号 722-725 之间）
- Test: `packages/brain/src/orchestrator/__tests__/attempt-store.test.js`

**Interfaces:**
- Consumes: `createAttemptStore(pool).recordCallbackTerminal({ attemptId, runId, leaseOwner, leaseGeneration, result })`（已存在）
- Produces: `ATTEMPT_COST_ACCRUAL_USD`（number，`constants.js` 导出，Task 2 的 DevGate/CI 不直接消费但 deriveGan 的 `caps.budgetExceeded` 语义依赖累加生效）

- [ ] **Step 1: 写 failing test**

在 `packages/brain/src/orchestrator/__tests__/attempt-store.test.js` 顶部 import 区加：

```js
import { ATTEMPT_COST_ACCRUAL_USD } from '../constants.js';
```

在 `describe('attempt store', () => {` 内（首个 it 之前或之后均可）新增：

```js
  it('首次终态 callback 在同事务内向 run 累加固定记账单价', async () => {
    const callbackResult = {
      status: 'completed',
      summary: 'ok',
      artifacts: [],
      provider_metadata: { provider: 'codex' },
    };
    const running = {
      id: input.id,
      run_id: input.runId,
      hop: input.hop,
      phase: 'gan',
      role: 'reviewer',
      status: 'running',
      lease_owner: 'brain-1',
      lease_generation: 3,
      result: null,
    };
    const completed = { ...running, status: 'completed', result: callbackResult };
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({})                                  // BEGIN
        .mockResolvedValueOnce({ rows: [running] })                 // 锁 + 加载
        .mockResolvedValueOnce({ rows: [completed], rowCount: 1 })  // attempt 终态 UPDATE
        .mockResolvedValueOnce({ rows: [{ hop: 4 }], rowCount: 1 }) // 通用 decision log
        .mockResolvedValue({}),                                     // 其余（投影/累加/COMMIT）
      release: vi.fn(),
    };
    const pool = { query: vi.fn(), connect: vi.fn(async () => client) };

    await createAttemptStore(pool).recordCallbackTerminal({
      attemptId: input.id,
      runId: input.runId,
      leaseOwner: 'brain-1',
      leaseGeneration: 3,
      result: callbackResult,
    });

    const accrual = client.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && /cost_usd\s*=\s*COALESCE\(cost_usd,\s*0\)\s*\+/.test(sql),
    );
    expect(accrual).toBeDefined();
    expect(accrual[1]).toEqual([input.runId, ATTEMPT_COST_ACCRUAL_USD]);
    expect(client.query.mock.calls.at(-1)[0]).toBe('COMMIT');
  });
```

- [ ] **Step 2: 跑新测试确认红**

Run: `npx vitest run packages/brain/src/orchestrator/__tests__/attempt-store.test.js -t "固定记账单价"`
Expected: FAIL——先在 import 处报 `ATTEMPT_COST_ACCRUAL_USD` 不存在；若 constants 已有该常量则 `accrual toBeDefined` 失败。两者都算红。
（注意：import 报错会让整个文件红——这是预期的 commit-1 状态，全量修复在 commit-2。）

- [ ] **Step 3: commit-1（仅测试）**

```bash
git add packages/brain/src/orchestrator/__tests__/attempt-store.test.js
git commit -m "test(kernel): 首次终态 callback 必须累加 attempt 记账单价（failing）" --no-verify
```

- [ ] **Step 4: 实现**

`packages/brain/src/orchestrator/constants.js` 末尾（action 枚举注释块之后）新增：

```js
// 每 attempt 固定记账单价（安全网代理值，非真实成本）：
// callback schema（execution-contract.js harnessResultSchema）顶层 strip 未知键、
// 三家 provider 均不上报用量 → 真实成本当前物理不可达（判定点 1391f0c6）。
// BUDGET_CAP_USD(10) ÷ 0.25 = 40 个 attempt 触发 cap——定位是"明显异常才触发"的
// 兜底，正常收敛由案卷机制 + 趋势观测负责（决策 ba33fc68）。
export const ATTEMPT_COST_ACCRUAL_USD = 0.25;
```

`packages/brain/src/orchestrator/attempt-store.js`：

import 区（line 10 附近）加：

```js
import { ATTEMPT_COST_ACCRUAL_USD } from './constants.js';
```

`recordCallbackTerminal` 内，`if (pullRequest) { ... }` 的闭括号之后、`!isTerminal` 块闭括号之前（当前 722 行 `}` 与 723 行 `}` 之间）插入：

```js
          // GAN budget cap 的唯一记账来源（决策 fbb0bc9d）：首次终态即累加固定单价。
          // run 行在事务开头已 FOR UPDATE，无竞态；exact-retry 走 isTerminal 早退不重复记账。
          await client.query(
            `UPDATE initiative_runs
                SET cost_usd = COALESCE(cost_usd, 0) + $2,
                    updated_at = NOW()
              WHERE id = $1`,
            [runId, ATTEMPT_COST_ACCRUAL_USD],
          );
```

- [ ] **Step 5: 跑全文件确认绿 + 连坐排查**

Run: `npx vitest run packages/brain/src/orchestrator/__tests__/attempt-store.test.js`
Expected: 全绿。若有既有用例红：只允许调整该用例的 mock 队列（`mockResolvedValueOnce` 数量）或调用下标（新累加语句使 COMMIT 后移一格），**禁止削弱任何断言**。特别核对 exact-retry 用例（`some(sql => /UPDATE initiative_runs/)` 为 false 的那条）必须保持原样通过——它就是"不重复记账"的负向守卫。

- [ ] **Step 6: 跑相邻单元 + PG 集成回归**

```bash
npx vitest run packages/brain/src/orchestrator/__tests__/
npx vitest run packages/brain/src/__tests__/integration/kernel-wiring.pg.integration.test.js
```

Expected: 全绿（集成测试按其文件头部的 db-config SSOT 环境要求跑；环境不可用则记录原因，交由 CI 兜底，不得静默跳过不报）。

- [ ] **Step 7: commit-2（实现）**

```bash
git add packages/brain/src/orchestrator/constants.js packages/brain/src/orchestrator/attempt-store.js packages/brain/src/orchestrator/__tests__/attempt-store.test.js
git commit -m "fix(kernel): attempt 首次终态累加固定记账单价，复活 GAN budget cap" --no-verify
```

---

### Task 2: DevGate + 版本 bump

**Files:**
- Modify: `packages/brain/package.json`（version patch bump）+ `bash scripts/check-version-sync.sh` 报出的其余同步位置
- 不新增文件

**Interfaces:**
- Consumes: Task 1 已提交的实现
- Produces: DevGate 三关全绿的可 push 分支

- [ ] **Step 1: DevGate 三关**

```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/quality/scripts/devgate/check-dod-mapping.cjs
```

Expected: 三条全部 exit 0。任何一条红 → 按其输出修复后重跑，红着禁止继续。

- [ ] **Step 2: brain 版本 patch bump**

将 `packages/brain/package.json` 的 `version` patch +1；重跑 `bash scripts/check-version-sync.sh`，把它报出的所有失配位置改到一致，直至 exit 0。

- [ ] **Step 3: commit**

```bash
git add -A
git commit -m "chore(brain): version bump for kernel cost accrual" --no-verify
```

---

## Self-Review 记录

- Spec 覆盖：设计文档"修改点 1/2"→ Task 1；"验收 DevGate/版本"→ Task 2；"显式不做"三项均未出现在任何 Task ✅
- 占位符扫描：无 TBD/TODO/"适当处理" ✅
- 类型/命名一致：`ATTEMPT_COST_ACCRUAL_USD` 在 constants/实现/测试三处一致 ✅
