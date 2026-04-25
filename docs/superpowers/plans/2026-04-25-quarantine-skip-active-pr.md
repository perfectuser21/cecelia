# quarantine hasActivePr 第三个 guard 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `packages/brain/src/quarantine.js::handleTaskFailure` 增加第三个活跃信号守卫 `hasActivePr`，task 已有 in-flight PR (open/ci_pending/merged) 时跳过 quarantine。

**Architecture:** 加法式补丁 — 新增 `hasActivePr(taskId)` 函数（查 `tasks.pr_url` + `pr_status`）+ 在 `handleTaskFailure` 中 active_container 守卫之后插入第三段 short-circuit return。守卫顺序：checkpoint → container → pr。新增独立 vitest 测试文件覆盖真值表 + 集成路径。

**Tech Stack:** Node.js ESM, vitest, PostgreSQL (pg pool), 现有 `pool.query` mock pattern。

---

## File Structure

- 修改 `packages/brain/src/quarantine.js`
  - 新增导出 async function `hasActivePr(taskId)`
  - 在 `handleTaskFailure` 中（active_container 守卫之后）调用 `hasActivePr` 并在命中时 short-circuit return
  - exports 块加入 `hasActivePr`
- 新建 `packages/brain/src/__tests__/quarantine-skip-active-pr.test.js`
  - 仿 `quarantine-skip-active-container.test.js` 的 mock + import 模式
  - 真值表 + 集成路径

---

### Task 1: 新增 hasActivePr 函数

**Files:**
- Modify: `packages/brain/src/quarantine.js`（紧跟 `hasActiveContainer` 之后插入新函数）
- Test: `packages/brain/src/__tests__/quarantine-skip-active-pr.test.js`（新建）

- [ ] **Step 1: 写失败测试 — hasActivePr 真值表**

新建 `packages/brain/src/__tests__/quarantine-skip-active-pr.test.js`：

```js
/**
 * Tests for ACTIVE-PR guard in handleTaskFailure / hasActivePr.
 *
 * 背景：task 已产出 PR（pr_url 填充 + pr_status='ci_pending'/'open'/'merged'）
 * 但 Brain tick 仍把它当 queued 重派 → quarantine 看到 failure_count>=3 → 拉黑
 * → shepherd 过滤 status NOT IN ('quarantined') 永远跳过 → PR 永远不 merge → 死循环。
 *
 * 修复：handleTaskFailure 在 checkpoint/container 守卫之后再加 PR 守卫。
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// Mock db.js：测试不依赖 PostgreSQL
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
  },
}));

// Mock child_process.execFile：测试不依赖真实 docker
vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

let handleTaskFailure;
let hasActivePr;
let pool;
let execFileMock;

beforeAll(async () => {
  const mod = await import('../quarantine.js');
  handleTaskFailure = mod.handleTaskFailure;
  hasActivePr = mod.hasActivePr;
  pool = (await import('../db.js')).default;
  execFileMock = (await import('child_process')).execFile;
});

beforeEach(() => {
  vi.clearAllMocks();
});

// docker ps 桩：promisified execFile callback 形式
function mockDockerPs(stdout, shouldReject = false) {
  execFileMock.mockImplementationOnce((cmd, args, opts, cb) => {
    const callback = cb || opts;
    if (shouldReject) callback(new Error('docker not found'));
    else callback(null, { stdout, stderr: '' });
  });
}

describe('hasActivePr', () => {
  it('返回 true：pr_url 存在且 pr_status=open', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ pr_url: 'https://github.com/x/y/pull/1', pr_status: 'open' }],
    });
    expect(await hasActivePr('aaaa')).toBe(true);
  });

  it('返回 true：pr_url 存在且 pr_status=ci_pending', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ pr_url: 'https://github.com/x/y/pull/1', pr_status: 'ci_pending' }],
    });
    expect(await hasActivePr('aaaa')).toBe(true);
  });

  it('返回 true：pr_url 存在且 pr_status=merged', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ pr_url: 'https://github.com/x/y/pull/1', pr_status: 'merged' }],
    });
    expect(await hasActivePr('aaaa')).toBe(true);
  });

  it('返回 false：pr_url=NULL（任务还没建 PR）', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ pr_url: null, pr_status: null }],
    });
    expect(await hasActivePr('aaaa')).toBe(false);
  });

  it('返回 false：pr_status=closed（应允许 shepherd 重派）', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ pr_url: 'https://github.com/x/y/pull/1', pr_status: 'closed' }],
    });
    expect(await hasActivePr('aaaa')).toBe(false);
  });

  it('返回 false：任务不存在', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    expect(await hasActivePr('aaaa')).toBe(false);
  });

  it('返回 false：DB 报错时安全 fallback', async () => {
    pool.query.mockRejectedValueOnce(new Error('connection refused'));
    expect(await hasActivePr('aaaa')).toBe(false);
  });
});

describe('handleTaskFailure — active PR 守卫', () => {
  it('活跃 PR (ci_pending) 命中 → 不隔离不累加，reason=active_pr', async () => {
    const taskId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    // 1. checkpoint 查询 → 无行
    pool.query.mockResolvedValueOnce({ rows: [] });
    // 2. docker ps → 无命中
    mockDockerPs('some-other\n');
    // 3. hasActivePr 查询 → ci_pending
    pool.query.mockResolvedValueOnce({
      rows: [{ pr_url: 'https://github.com/x/y/pull/1', pr_status: 'ci_pending' }],
    });

    const result = await handleTaskFailure(taskId);

    expect(result.quarantined).toBe(false);
    expect(result.skipped_active).toBe(true);
    expect(result.reason).toBe('active_pr');
    expect(result.failure_count).toBe(0);

    // checkpoint + hasActivePr = 2 次 pool.query；docker ps = 1 次 execFile
    // 不应该再有 SELECT tasks / UPDATE failure_count
    expect(pool.query.mock.calls.length).toBe(2);
    const updates = pool.query.mock.calls.filter(c => String(c[0]).includes('UPDATE'));
    expect(updates.length).toBe(0);
  });

  it('无 PR (pr_url=NULL) → 走原 failure 逻辑，failure_count 累加', async () => {
    const taskId = 'aaaaaaaa-bbbb-cccc-dddd-ffffffffffff';
    // 1. checkpoint → 无
    pool.query.mockResolvedValueOnce({ rows: [] });
    // 2. docker ps → 无
    mockDockerPs('some-other\n');
    // 3. hasActivePr → NULL
    pool.query.mockResolvedValueOnce({
      rows: [{ pr_url: null, pr_status: null }],
    });
    // 4. SELECT tasks（handleTaskFailure 主路径）
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: taskId,
        status: 'failed',
        payload: { failure_count: 0 },
      }],
    });
    // 5. UPDATE tasks（累加 failure_count）
    pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await handleTaskFailure(taskId);

    expect(result.quarantined).toBe(false);
    expect(result.skipped_active).toBeUndefined();
    expect(result.failure_count).toBe(1);
    expect(result.reason).toBeUndefined();

    const updates = pool.query.mock.calls.filter(c => String(c[0]).includes('UPDATE'));
    expect(updates.length).toBeGreaterThanOrEqual(1);
  });

  it('checkpoint 守卫优先时不查 PR', async () => {
    const taskId = 'aaaaaaaa-bbbb-cccc-dddd-000000000000';
    // checkpoint 命中
    pool.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

    const result = await handleTaskFailure(taskId);

    expect(result.skipped_active).toBe(true);
    expect(result.reason).toBe('active_checkpoint');
    // 只有 1 次 query（checkpoint），没有第 2 次 hasActivePr 查询
    expect(pool.query.mock.calls.length).toBe(1);
    expect(execFileMock.mock.calls.length).toBe(0);
  });

  it('container 守卫优先时不查 PR', async () => {
    const taskId = '33b37ea3-4b3c-4a9a-bb40-aaaaaaaaaaaa';
    pool.query.mockResolvedValueOnce({ rows: [] }); // checkpoint 无
    mockDockerPs('cecelia-task-33b37ea34b3c\n');     // container 命中

    const result = await handleTaskFailure(taskId);

    expect(result.skipped_active).toBe(true);
    expect(result.reason).toBe('active_container');
    // 只 1 次 query（checkpoint），没有 hasActivePr 查询
    expect(pool.query.mock.calls.length).toBe(1);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd /Users/administrator/worktrees/cecelia/quarantine-skip-active-pr/packages/brain
npx vitest run src/__tests__/quarantine-skip-active-pr.test.js
```

期望：FAIL — `hasActivePr` undefined（quarantine.js 还没导出）。

- [ ] **Step 3: 在 quarantine.js 紧跟 hasActiveContainer 之后插入 hasActivePr 实现**

定位 `quarantine.js` 中 `hasActiveContainer` 函数尾部 `}` 之后（约 1052 行）、`/**` `处理任务失败` 注释之前（约 1054 行），插入：

```js
/**
 * 检查任务是否已产出活跃 PR
 *
 * 背景：tasks.pr_url 一旦填充且 pr_status ∈ ('open','ci_pending','merged')
 * 即说明本任务实质 deliverable 已存在（PR 等 CI/合并），不应再因 failure_count
 * 累积被 quarantine。否则 shepherd 过滤 status NOT IN ('quarantined') 会永远
 * 跳过该 task → PR 永远不 merge → 死循环。
 *
 * 与 hasActiveCheckpoint / hasActiveContainer 并列，作为 handleTaskFailure
 * 的第三道活跃信号守卫。
 *
 * @param {string} taskId - 任务 ID（UUID 字符串）
 * @returns {Promise<boolean>} - true 表示已有 in-flight PR
 */
async function hasActivePr(taskId) {
  try {
    const result = await pool.query(
      `SELECT pr_url, pr_status FROM tasks WHERE id = $1`,
      [taskId]
    );
    const r = result.rows[0];
    if (!r) return false;
    return r.pr_url != null && ['open', 'ci_pending', 'merged'].includes(r.pr_status);
  } catch (err) {
    console.warn(`[quarantine] hasActivePr query failed for ${taskId}: ${err.message}`);
    return false;
  }
}
```

- [ ] **Step 4: 在 handleTaskFailure 中、container 守卫之后插入 PR 守卫**

定位 `handleTaskFailure` 内 container 守卫块（`if (hasContainer) { ... return { ..., reason: 'active_container' }; }`）之后、`// skipCount 模式` 注释之前，插入：

```js
  // 活跃信号守卫 (3/3)：task 表已有 PR 且处于 in-flight 状态
  // (open/ci_pending/merged) → 说明 deliverable 已产出，不应再拉黑导致
  // shepherd 永远跳过本 task。
  const hasPr = await hasActivePr(taskId);
  if (hasPr) {
    console.log(`[quarantine] Task ${taskId} has active PR, skipping failure/quarantine`);
    return {
      quarantined: false,
      failure_count: 0,
      skipped_active: true,
      reason: 'active_pr',
    };
  }
```

- [ ] **Step 5: 在 exports 块加入 hasActivePr**

`quarantine.js` 末尾 `export { ... }` 块中，在 `hasActiveContainer,` 这一行之后加入：

```js
  hasActivePr,
```

- [ ] **Step 6: 运行测试确认通过**

```bash
cd /Users/administrator/worktrees/cecelia/quarantine-skip-active-pr/packages/brain
npx vitest run src/__tests__/quarantine-skip-active-pr.test.js
```

期望：PASS — 11 个测试全绿（hasActivePr 7 个 + handleTaskFailure 4 个）。

- [ ] **Step 7: 跑完整 quarantine 相关回归确保没破坏**

```bash
cd /Users/administrator/worktrees/cecelia/quarantine-skip-active-pr/packages/brain
npx vitest run src/__tests__/quarantine
```

期望：所有 quarantine* 测试 PASS。

- [ ] **Step 8: 写 Learning 文件**

新建 `docs/learnings/cp-0425111013-quarantine-skip-active-pr.md`：

```markdown
# Learning — quarantine 第三个守卫 hasActivePr

## 现象
Harness v6 闭环验证：task 已产出 PR（pr_url + pr_status='ci_pending'）但 Brain tick 仍重派为 queued → failure_count 累积 → quarantine 拉黑 → shepherd 过滤 status NOT IN ('quarantined') 永远跳过 → PR 永远不 merge → 死循环。

### 根本原因
`handleTaskFailure` 已有 `hasActiveCheckpoint` (LangGraph) + `hasActiveContainer` (docker) 两个活跃守卫，但缺第三个判 in-flight PR 的守卫。Generator 类任务产出 PR 后，容器可能已退出（不在 docker ps），LangGraph 不参与（无 checkpoint），唯一的活跃证据是 `tasks.pr_url + pr_status`，没人查它。

### 下次预防
- [ ] 新增 quarantine 类逻辑前先回顾"活跃信号是否齐全"：checkpoint / container / pr / 其他外部 deliverable
- [ ] tasks 表新增 deliverable 字段时同步加守卫，禁止只依赖 failure_count 单一信号
- [ ] 守卫并列原则：每个守卫独立短路 return + 独立测试文件

## 修复
- 新增 `quarantine.js::hasActivePr(taskId)`：查 tasks.pr_url + pr_status，命中 ('open','ci_pending','merged') 之一返回 true
- `handleTaskFailure` 在 container 守卫之后插入第三段守卫，命中即 `{quarantined:false, skipped_active:true, reason:'active_pr', failure_count:0}`
- 测试文件 `quarantine-skip-active-pr.test.js` 覆盖真值表 + 集成路径 + 守卫优先级
```

- [ ] **Step 9: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/quarantine-skip-active-pr
git add packages/brain/src/quarantine.js \
        packages/brain/src/__tests__/quarantine-skip-active-pr.test.js \
        docs/learnings/cp-0425111013-quarantine-skip-active-pr.md \
        docs/superpowers/specs/2026-04-25-quarantine-skip-active-pr-design.md \
        docs/superpowers/plans/2026-04-25-quarantine-skip-active-pr.md
git commit -m "$(cat <<'EOF'
fix(brain): quarantine 识别有 PR 的 task 跳过拉黑（与 active_checkpoint/active_container 并列）

handleTaskFailure 增第三个活跃信号守卫 hasActivePr。tasks.pr_url 已填且
pr_status ∈ ('open','ci_pending','merged') → 跳过 quarantine、不累加 failure_count。

修死循环：task 出 PR 后仍被 shepherd 重派 → failure_count 累积 → 拉黑 →
shepherd 过滤 quarantined 永远跳过 → PR 不 merge。

测试覆盖：hasActivePr 真值表 7 例 + handleTaskFailure 集成 4 例。
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- [ARTIFACT] hasActivePr 函数 — Step 3 ✓
- [ARTIFACT] handleTaskFailure 调用并 early return reason='active_pr' — Step 4 ✓
- [BEHAVIOR] 单元测试 mock pr_url + pr_status='ci_pending' → skipped_active:true — Step 1 测试 1 + 8 ✓
- [BEHAVIOR] regression 防护 pr_url=NULL 走原路径 — Step 1 测试 9 ✓
- [BEHAVIOR] `npm test --run quarantine-skip-active-pr` 全绿 — Step 6 ✓

**Placeholder scan:** 无 TBD/TODO/略写。所有代码块完整。

**Type/命名一致性:** `hasActivePr` 在测试 import / quarantine.js 实现 / handleTaskFailure 调用 / exports 四处一致。`reason: 'active_pr'` 字符串值在测试与实现一致。

**Scope check:** 单一文件改动 + 一个新测试，不需要拆分。
