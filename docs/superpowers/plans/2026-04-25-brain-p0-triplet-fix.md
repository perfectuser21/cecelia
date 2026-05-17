# Brain P0 三联修 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 三联修 Brain 启动 + 状态机 + watcher：startup-recovery UUID 类型；shepherd ci_passed 推进 completed；quarantine.hasActivePr 白名单补 ci_passed；harness-task-dispatch 队列入口锁定。

**Architecture:** 5 处文件修改 + 3 个测试新增。修改面纯局部；测试用 vi.mock 注入 pool/execSync，不依赖真 DB / GH。一次 PR 全包。

**Tech Stack:** Node.js (ESM), pg, vitest, gh CLI

---

## File Structure

修改：
- `packages/brain/src/startup-recovery.js`（修 1，第 276 行）
- `packages/brain/src/shepherd.js`（修 3A 第 166-186 行 + 修 3B 第 127 行）
- `packages/brain/src/quarantine.js`（修 3C 第 1078 行）

新建测试：
- `packages/brain/src/__tests__/startup-recovery-uuid.test.js`（修 1 锁定）
- `packages/brain/src/__tests__/shepherd-ci-passed.test.js`（修 3A + 3B）
- `packages/brain/src/__tests__/quarantine-ci-passed.test.js`（修 3C）

注意：harness-task-dispatch.js 当前已正确含 `'queued'`，无需修改；本计划不为它建独立测试（PRD 列出但实际验证通过现状）。

---

### Task 1: startup-recovery UUID 类型修正 + 测试

**Files:**
- Modify: `packages/brain/src/startup-recovery.js:276`
- Create: `packages/brain/src/__tests__/startup-recovery-uuid.test.js`

- [ ] **Step 1: 写失败测试**

`packages/brain/src/__tests__/startup-recovery-uuid.test.js`：

```js
/**
 * cleanupStaleClaims UUID 类型修正测试
 * 验证 UPDATE 用 uuid[]，不是 int[]，避免 Brain 启动时 cleanupStaleClaims
 * 抛出 "operator does not exist: uuid = integer"。
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('child_process', () => ({ execSync: vi.fn().mockReturnValue('') }));
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readdirSync: vi.fn().mockReturnValue([]),
  rmSync: vi.fn(),
  readFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

let cleanupStaleClaims;

beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../startup-recovery.js');
  cleanupStaleClaims = mod.cleanupStaleClaims;
});

describe('cleanupStaleClaims uuid[] 类型修正', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('UPDATE 使用 uuid[] 而非 int[]', async () => {
    const queryMock = vi.fn()
      .mockResolvedValueOnce({
        rows: [
          { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', claimed_by: 'brain-tick-1', claimed_at: null },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 1 });

    const pool = { query: queryMock };
    const stats = await cleanupStaleClaims(pool, { staleMinutes: 60 });

    expect(stats.errors).toEqual([]);
    expect(stats.cleaned).toBe(1);

    // 第二次 query（UPDATE）SQL 应为 uuid[]，不是 int[]
    const updateCall = queryMock.mock.calls[1];
    const sql = updateCall[0];
    expect(sql).toContain('uuid[]');
    expect(sql).not.toContain('int[]');
  });

  it('pool 缺失时返回错误而不抛异常', async () => {
    const stats = await cleanupStaleClaims(null);
    expect(stats.errors).toContain('pool not provided');
    expect(stats.cleaned).toBe(0);
  });

  it('无 stale claim 时不调用 UPDATE', async () => {
    const queryMock = vi.fn().mockResolvedValueOnce({ rows: [] });
    const pool = { query: queryMock };
    const stats = await cleanupStaleClaims(pool);
    expect(queryMock).toHaveBeenCalledTimes(1); // 只 SELECT
    expect(stats.cleaned).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/brain && npx vitest run src/__tests__/startup-recovery-uuid.test.js`
Expected: 第一个用例 FAIL（`expect(sql).toContain('uuid[]')` 失败，当前 SQL 含 `int[]`）

- [ ] **Step 3: 修改 startup-recovery.js**

`packages/brain/src/startup-recovery.js:276` 把 `int[]` 改为 `uuid[]`：

```diff
-        WHERE id = ANY($1::int[])
+        WHERE id = ANY($1::uuid[])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/brain && npx vitest run src/__tests__/startup-recovery-uuid.test.js`
Expected: PASS（3 个用例全过）

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/startup-recovery.js packages/brain/src/__tests__/startup-recovery-uuid.test.js
git commit -m "fix(brain): cleanupStaleClaims 用 uuid[] 替代 int[]"
```

---

### Task 2: shepherd.js ci_passed 状态机修复 + 测试

**Files:**
- Modify: `packages/brain/src/shepherd.js:127`（主 SELECT WHERE）
- Modify: `packages/brain/src/shepherd.js:166-186`（ci_passed + MERGEABLE 分支）
- Create: `packages/brain/src/__tests__/shepherd-ci-passed.test.js`

- [ ] **Step 1: 写失败测试**

`packages/brain/src/__tests__/shepherd-ci-passed.test.js`：

```js
/**
 * shepherd.js ci_passed 状态机修复测试
 *
 * 覆盖：
 *  A) shepherdOpenPRs 主 SELECT WHERE 包含 'ci_passed'
 *  B) ci_passed + MERGEABLE 分支：executeMerge 后 reload PR state，
 *     state==='MERGED' 时同时 UPDATE status='completed' + completed_at + pr_status='merged'
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('../quarantine.js', () => ({
  quarantineTask: vi.fn().mockResolvedValue({ success: true }),
}));

import { execSync } from 'child_process';
import { shepherdOpenPRs } from '../shepherd.js';

describe('shepherdOpenPRs 主 SELECT WHERE', () => {
  beforeEach(() => {
    vi.mocked(execSync).mockReset();
  });

  it('SELECT WHERE 包含 ci_passed', async () => {
    const queryMock = vi.fn().mockResolvedValueOnce({ rows: [] });
    const pool = { query: queryMock };
    await shepherdOpenPRs(pool);
    const sql = queryMock.mock.calls[0][0];
    expect(sql).toContain("'ci_passed'");
    expect(sql).toContain("'open'");
    expect(sql).toContain("'ci_pending'");
  });
});

describe('ci_passed + MERGEABLE 分支：merge 后推进 status=completed', () => {
  beforeEach(() => {
    vi.mocked(execSync).mockReset();
  });

  it('executeMerge 后 reload state=MERGED → UPDATE status=completed + pr_status=merged', async () => {
    // 第一次 checkPrStatus（gh pr view）：CI 通过 + MERGEABLE
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify({
      state: 'OPEN',
      mergeable: 'MERGEABLE',
      statusCheckRollup: [{ name: 'brain-ci', conclusion: 'SUCCESS', status: 'COMPLETED' }],
    }));
    // executeMerge（gh pr merge --squash）：成功（无 stdout 解析）
    vi.mocked(execSync).mockReturnValueOnce('');
    // 第二次 checkPrStatus（reload）：state=MERGED
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify({
      state: 'MERGED',
      mergeable: 'MERGEABLE',
      statusCheckRollup: [{ name: 'brain-ci', conclusion: 'SUCCESS', status: 'COMPLETED' }],
    }));

    const updates = [];
    const queryMock = vi.fn(async (sql, params) => {
      if (/^\s*SELECT/i.test(sql)) {
        return {
          rows: [{
            id: 'task-1',
            title: 'test',
            pr_url: 'https://github.com/x/y/pull/1',
            pr_status: 'open',
            retry_count: 0,
            payload: {},
          }],
        };
      }
      updates.push({ sql, params });
      return { rowCount: 1 };
    });

    const pool = { query: queryMock };
    const result = await shepherdOpenPRs(pool);

    expect(result.merged).toBeGreaterThanOrEqual(1);
    // 应当出现一条 UPDATE 同时含 status='completed' + pr_status='merged'
    const completedUpdate = updates.find(u =>
      /UPDATE\s+tasks/i.test(u.sql) &&
      /status\s*=\s*'completed'/i.test(u.sql) &&
      /pr_status\s*=\s*'merged'/i.test(u.sql)
    );
    expect(completedUpdate).toBeDefined();
  });

  it('executeMerge 后 reload 仍 OPEN → 仅 UPDATE pr_status=ci_passed', async () => {
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify({
      state: 'OPEN',
      mergeable: 'MERGEABLE',
      statusCheckRollup: [{ name: 'brain-ci', conclusion: 'SUCCESS', status: 'COMPLETED' }],
    }));
    vi.mocked(execSync).mockReturnValueOnce(''); // executeMerge OK
    vi.mocked(execSync).mockReturnValueOnce(JSON.stringify({
      state: 'OPEN', // 还没 merged（async sync 中）
      mergeable: 'MERGEABLE',
      statusCheckRollup: [{ name: 'brain-ci', conclusion: 'SUCCESS', status: 'COMPLETED' }],
    }));

    const updates = [];
    const queryMock = vi.fn(async (sql, params) => {
      if (/^\s*SELECT/i.test(sql)) {
        return {
          rows: [{
            id: 'task-2',
            title: 'test',
            pr_url: 'https://github.com/x/y/pull/2',
            pr_status: 'open',
            retry_count: 0,
            payload: {},
          }],
        };
      }
      updates.push({ sql, params });
      return { rowCount: 1 };
    });

    await shepherdOpenPRs({ query: queryMock });

    const ciPassedUpdate = updates.find(u =>
      /UPDATE\s+tasks/i.test(u.sql) &&
      /pr_status\s*=\s*'ci_passed'/i.test(u.sql)
    );
    expect(ciPassedUpdate).toBeDefined();
    // 不应有 status='completed' 的 UPDATE
    const completedUpdate = updates.find(u => /status\s*=\s*'completed'/i.test(u.sql));
    expect(completedUpdate).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/brain && npx vitest run src/__tests__/shepherd-ci-passed.test.js`
Expected: 第一组（主 SELECT WHERE）FAIL；第二组（merge reload）FAIL

- [ ] **Step 3: 修改 shepherd.js — 主 SELECT WHERE + ci_passed 分支**

修 3B：`packages/brain/src/shepherd.js:127`：

```diff
-        AND pr_status IN ('open', 'ci_pending')
+        AND pr_status IN ('open', 'ci_pending', 'ci_passed')
```

修 3A：`packages/brain/src/shepherd.js` ci_passed + MERGEABLE 分支替换为：

```js
      } else if (prInfo.ciStatus === 'ci_passed' && prInfo.mergeable === 'MERGEABLE') {
        // CI 全通过且可合并 → 执行 auto-merge，再 reload PR state 推进 status
        try {
          executeMerge(task.pr_url);
          // 重读 PR 最新 state；若已 MERGED 则推进 status=completed
          let merged = false;
          try {
            const after = checkPrStatus(task.pr_url);
            merged = after.state === 'MERGED' || after.ciStatus === 'merged';
          } catch (reloadErr) {
            console.warn(`[shepherd] reload PR state 失败 (non-fatal): ${reloadErr.message}`);
          }
          if (merged) {
            await pool.query(
              `UPDATE tasks
                 SET pr_status = 'merged',
                     pr_merged_at = COALESCE(pr_merged_at, NOW()),
                     status = 'completed',
                     completed_at = COALESCE(completed_at, NOW())
               WHERE id = $1`,
              [task.id]
            );
            console.log(`[shepherd] auto-merge 成功并推进 completed: ${task.title}`);
          } else {
            await pool.query(
              `UPDATE tasks SET pr_status = 'ci_passed' WHERE id = $1`,
              [task.id]
            );
            console.log(`[shepherd] auto-merge 已触发但 PR 还未 MERGED: ${task.title}`);
          }
          result.merged++;
        } catch (mergeErr) {
          // merge 失败不阻断，保持 ci_passed，下次 tick 重试
          console.error(`[shepherd] auto-merge 失败 (non-fatal): ${mergeErr.message}`);
          await pool.query(
            `UPDATE tasks SET pr_status = 'ci_passed',
              payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb
             WHERE id = $1`,
            [task.id, JSON.stringify({ shepherd_merge_error: mergeErr.message })]
          );
          result.errors++;
        }

      } else if (prInfo.ciStatus === 'ci_failed') {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/brain && npx vitest run src/__tests__/shepherd-ci-passed.test.js`
Expected: PASS（3 个用例全过）

- [ ] **Step 5: 跑 shepherd 既有回归**

Run: `cd packages/brain && npx vitest run src/__tests__/shepherd.test.js`
Expected: PASS（既有 shepherd.test.js 不受影响）

- [ ] **Step 6: Commit**

```bash
git add packages/brain/src/shepherd.js packages/brain/src/__tests__/shepherd-ci-passed.test.js
git commit -m "fix(brain): shepherd ci_passed 后 reload PR state 推进 completed + WHERE 含 ci_passed"
```

---

### Task 3: quarantine.hasActivePr 加 'ci_passed' + 测试

**Files:**
- Modify: `packages/brain/src/quarantine.js:1078`
- Create: `packages/brain/src/__tests__/quarantine-ci-passed.test.js`

- [ ] **Step 1: 写失败测试**

`packages/brain/src/__tests__/quarantine-ci-passed.test.js`：

```js
/**
 * quarantine.hasActivePr — pr_status='ci_passed' 也算活跃信号
 *
 * 背景：shepherd 写入 pr_status='ci_passed' 后等 reload PR state；
 * handleTaskFailure 第 3 道守卫如果不识别 'ci_passed'，failure_count 累积
 * 可能误判 quarantine → quarantined→queued 死循环（PR 已开但被拉黑）。
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

let hasActivePr;
let pool;

beforeAll(async () => {
  const mod = await import('../quarantine.js');
  hasActivePr = mod.hasActivePr;
  pool = (await import('../db.js')).default;
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hasActivePr 白名单含 ci_passed', () => {
  it('返回 true：pr_url 存在且 pr_status=ci_passed', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ pr_url: 'https://github.com/x/y/pull/1', pr_status: 'ci_passed' }],
    });
    expect(await hasActivePr('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBe(true);
  });

  it('返回 true：pr_status=open 仍兼容', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ pr_url: 'https://github.com/x/y/pull/2', pr_status: 'open' }],
    });
    expect(await hasActivePr('aaaa')).toBe(true);
  });

  it('返回 true：pr_status=ci_pending 仍兼容', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ pr_url: 'https://github.com/x/y/pull/3', pr_status: 'ci_pending' }],
    });
    expect(await hasActivePr('aaaa')).toBe(true);
  });

  it('返回 true：pr_status=merged 仍兼容', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ pr_url: 'https://github.com/x/y/pull/4', pr_status: 'merged' }],
    });
    expect(await hasActivePr('aaaa')).toBe(true);
  });

  it('返回 false：pr_status=closed', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ pr_url: 'https://github.com/x/y/pull/5', pr_status: 'closed' }],
    });
    expect(await hasActivePr('aaaa')).toBe(false);
  });

  it('返回 false：pr_status=ci_failed', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ pr_url: 'https://github.com/x/y/pull/6', pr_status: 'ci_failed' }],
    });
    expect(await hasActivePr('aaaa')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/brain && npx vitest run src/__tests__/quarantine-ci-passed.test.js`
Expected: 第一个用例 FAIL（`'ci_passed'` 不在白名单 → 返回 false）

- [ ] **Step 3: 修改 quarantine.js**

`packages/brain/src/quarantine.js:1078`：

```diff
-    return r.pr_url != null && ['open', 'ci_pending', 'merged'].includes(r.pr_status);
+    return r.pr_url != null && ['open', 'ci_pending', 'ci_passed', 'merged'].includes(r.pr_status);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/brain && npx vitest run src/__tests__/quarantine-ci-passed.test.js`
Expected: PASS（6 个用例全过）

- [ ] **Step 5: 跑 quarantine 既有回归（确保不破坏既有 hasActivePr 测试）**

Run: `cd packages/brain && npx vitest run src/__tests__/quarantine-skip-active-pr.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/brain/src/quarantine.js packages/brain/src/__tests__/quarantine-ci-passed.test.js
git commit -m "fix(brain): quarantine.hasActivePr 白名单加 ci_passed 防误判隔离"
```

---

### Task 4: Learning + DoD 文档收尾

**Files:**
- Create: `docs/learnings/cp-0425182134-brain-p0-triplet-fix.md`
- Create: `dod-cp-0425182134-brain-p0-triplet-fix.md`（worktree 根目录，含 [BEHAVIOR] 全 [x]）

- [ ] **Step 1: 写 Learning 文件**

`docs/learnings/cp-0425182134-brain-p0-triplet-fix.md`：

```markdown
# Brain P0 三联修 Learning

## 根本原因

1. cleanupStaleClaims SQL 用 `int[]` 强转 UUID 数组 → 启动时 100% 抛 `operator does not exist: uuid = integer`，孤儿任务永不释放，每次重启累积。
2. shepherd 在 ci_passed + MERGEABLE 分支只 UPDATE pr_status，不读 PR 最新 state，且主 SELECT WHERE 不含 'ci_passed' → ci_passed 写入后任务永远停留在 in_progress，KR 进度链断。
3. quarantine.hasActivePr 白名单漏 'ci_passed' → ci_passed 状态下 failure_count 累计可被误判隔离，shepherd `status NOT IN ('quarantined')` 永远跳过 → quarantined→queued 死循环。

## 下次预防

- [ ] DB schema 改 UUID 后，所有 `::int[]` cast 全局 grep + 单元测试断言 SQL 文本含 `uuid[]`
- [ ] 状态机字段改动同步审计：shepherd 写入的 pr_status 必须出现在 shepherd 主 SELECT WHERE + quarantine.hasActivePr 白名单（一处加，全链路加）
- [ ] auto-merge 后必须 reload PR state，单纯 UPDATE pr_status='ci_passed' 不能算闭环
- [ ] CI 加 SQL 类型 lint：`grep -n "id = ANY.*int\[\]" packages/brain/src/*.js` 应为 0
- [ ] Brain 启动 log 含 "operator does not exist" 视为 P0 告警
```

- [ ] **Step 2: 写 DoD 文件（worktree 根目录）**

`dod-cp-0425182134-brain-p0-triplet-fix.md`：

```markdown
# DoD — Brain P0 三联修

## 成功标准

- [x] [ARTIFACT] startup-recovery.js 用 `uuid[]` 而非 `int[]`
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/startup-recovery.js','utf8');if(!c.includes('uuid[]')||c.includes('int[]'))process.exit(1)"
- [x] [ARTIFACT] shepherd.js 主 SELECT WHERE 含 'ci_passed'
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/shepherd.js','utf8');if(!/pr_status\s+IN\s*\([^)]*'ci_passed'/.test(c))process.exit(1)"
- [x] [ARTIFACT] shepherd.js executeMerge 后 reload 决定 status='completed'
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/shepherd.js','utf8');if(!c.includes(\"status = 'completed'\")||!c.includes('checkPrStatus'))process.exit(1)"
- [x] [ARTIFACT] quarantine.js hasActivePr 含 'ci_passed'
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/quarantine.js','utf8');const m=c.match(/\['open',\s*'ci_pending',\s*'ci_passed',\s*'merged'\]/);if(!m)process.exit(1)"
- [x] [BEHAVIOR] startup-recovery-uuid 测试全绿
  Test: tests/__tests__/startup-recovery-uuid.test.js
- [x] [BEHAVIOR] shepherd-ci-passed 测试全绿
  Test: tests/__tests__/shepherd-ci-passed.test.js
- [x] [BEHAVIOR] quarantine-ci-passed 测试全绿
  Test: tests/__tests__/quarantine-ci-passed.test.js
```

- [ ] **Step 3: Commit Learning + DoD**

```bash
git add docs/learnings/cp-0425182134-brain-p0-triplet-fix.md dod-cp-0425182134-brain-p0-triplet-fix.md docs/superpowers/specs/2026-04-25-brain-p0-triplet-fix-design.md docs/superpowers/plans/2026-04-25-brain-p0-triplet-fix.md
git commit -m "docs(brain): P0 三联修 spec/plan/learning/dod"
```

---

### Task 5: 全量测试 + 推送 PR

- [ ] **Step 1: 跑全量 brain 单测验回归不破**

Run: `cd packages/brain && npx vitest run src/__tests__/startup-recovery-uuid.test.js src/__tests__/shepherd-ci-passed.test.js src/__tests__/quarantine-ci-passed.test.js src/__tests__/shepherd.test.js src/__tests__/quarantine-skip-active-pr.test.js src/__tests__/startup-recovery.test.js`
Expected: 全 PASS

- [ ] **Step 2: 推送分支 + 开 PR**

由 finishing skill 处理（push origin + gh pr create）。

PR 标题：`fix(brain): P0 三联修 — 启动 UUID + shepherd ci_passed 状态机 + quarantine 白名单`

- [ ] **Step 3: foreground 阻塞等 CI**

```bash
PR_URL=$(gh pr view --json url -q .url)
until [[ $(gh pr checks "$PR_URL" 2>&1 | grep -cE "pending|queued|in_progress") == 0 ]]; do sleep 30; done
gh pr checks "$PR_URL"
```
Expected: 全 PASS（无 pending）后退出循环

- [ ] **Step 4: 合并**

由 Stop Hook（手动 /dev 模式）接管 squash merge。
