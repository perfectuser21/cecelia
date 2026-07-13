# relay watchdog PR 发现护栏 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** watchdog 重点火前先从 GitHub 按分支名反查该任务已有 PR——MERGED 则收敛、OPEN 则回写 pr_url 并跳过重点火，杜绝同任务重复跑出多个 PR。

**Architecture:** 单文件修改 `packages/brain/src/harness-relay-watchdog.js`：新增两个可导出纯函数 `_parseBaseRepo` / `_discoverPrFromGithub`，并在 `resumeStalledRelayRuns` 的 headless 分支（既有 MERGED 护栏之后、attempt cap 之前）插入发现逻辑。所有外部调用（gh/docker/DB）经由已有的依赖注入（execFn/pool/spawnFn），测试全 mock。

**Tech Stack:** Node.js ESM + vitest（mock 注入，无真实 DB/gh）。

## Global Constraints

- 语言：代码注释与 commit message 全部简体中文
- TDD 两 commit 纪律：commit-1 = failing test（Red），commit-2 = 实现（Green）
- brain 版本 bump：1.243.1 → 1.243.2（package.json + package-lock + DEFINITION.md，`bash scripts/check-version-sync.sh` 必须绿）
- DevGate：`node scripts/facts-check.mjs` 必须绿
- 禁止改动 headed 分支（`_handleHeadedRun`）与既有 L113-143 MERGED 护栏的语义

---

### Task 1: Failing 回归测试（commit-1 Red）

**Files:**
- Create: `packages/brain/src/__tests__/harness-relay-watchdog-pr-discovery.test.js`

**Interfaces:**
- Consumes: `resumeStalledRelayRuns(deps)` 既有签名（deps={pool,execFn,spawnFn}）
- Produces: 对 Task 2 的约束——`_parseBaseRepo(baseRepo:string|null):string|null` 与 `_discoverPrFromGithub(task, short, execFn): {url,state}|null` 两个具名导出

- [ ] **Step 1: 写测试文件（完整内容如下）**

```js
/**
 * relay watchdog PR 发现护栏（Issue 198ba8db）：
 * relay session 不回写 pr_url → 既有 MERGED 护栏（读 DB 三处 pr_url）失明 →
 * 容器消失被误判死跑 → 重复点火 → 同任务重复产出多个 PR
 * （5d090237 实证：5 attempt / 4 个重复 open PR）。
 * 本文件锁定：容器消失且 DB 无 pr_url 时，先从 GitHub 按分支名含 task short 反查 PR。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPool } = vi.hoisted(() => ({ mockPool: { query: vi.fn() } }));
vi.mock('../db.js', () => ({ default: mockPool }));

import {
  resumeStalledRelayRuns,
  _parseBaseRepo,
  _discoverPrFromGithub,
} from '../harness-relay-watchdog.js';

const TASK_ID = 'aaaabbbb-cccc-dddd-eeee-ffff00001111';
const SHORT = 'aaaabbbb';
const BASE_REPO = 'https://github.com/org/repo.git';
const OPEN_PR = { headRefName: `cp-07081025-ws-${SHORT}`, url: 'https://github.com/org/repo/pull/7', state: 'OPEN' };
const MERGED_PR = { headRefName: `cp-07080901-${SHORT}`, url: 'https://github.com/org/repo/pull/6', state: 'MERGED' };

function makeDeps({ baseRepo = BASE_REPO, ghList = null, ghListThrows = false } = {}) {
  const pool = { query: vi.fn() };
  pool.query.mockImplementation(async (sql) => {
    if (/DISTINCT ON \(initiative_id\)/.test(sql)) {
      return { rows: [{ initiative_id: TASK_ID, phase: 'planning', attempts: '2', deadline_at: new Date(Date.now() + 3600e3).toISOString(), pr_url: null, orchestrator_host: 'skill-relay-session' }] };
    }
    if (/FROM tasks/.test(sql)) {
      return { rows: [{ id: TASK_ID, status: 'in_progress', title: 't', pr_url: null, payload: { orchestrator: 'skill-relay', base_repo: baseRepo } }] };
    }
    return { rows: [] };
  });
  const execFn = vi.fn().mockImplementation((cmd) => {
    if (/docker ps/.test(cmd)) return ''; // 容器已消失
    if (/gh pr list/.test(cmd)) {
      if (ghListThrows) throw new Error('gh boom');
      return JSON.stringify(ghList ?? []);
    }
    return '';
  });
  return { pool, execFn, spawnFn: vi.fn().mockResolvedValue({ ok: true, containerId: 'x' }) };
}

beforeEach(() => mockPool.query.mockReset());

describe('watchdog PR 发现护栏', () => {
  it('gh 发现含 short 的 OPEN PR → 不重点火 + 回写 pr_url 到 run 与 task', async () => {
    const deps = makeDeps({ ghList: [{ headRefName: 'cp-other-11112222', url: 'u', state: 'OPEN' }, OPEN_PR] });
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).not.toHaveBeenCalled();
    expect(r.resumed).toBe(0);
    const updates = deps.pool.query.mock.calls.filter((c) => /UPDATE/.test(c[0]));
    expect(updates.some((c) => /initiative_runs/.test(c[0]) && /pr_url/.test(c[0]) && c[1][1] === OPEN_PR.url)).toBe(true);
    expect(updates.some((c) => /UPDATE tasks/.test(c[0]) && /pr_url/.test(c[0]) && c[1][1] === OPEN_PR.url)).toBe(true);
  });

  it('gh 发现含 short 的 MERGED PR → 收敛：run 标 done + task 标 completed，不重点火', async () => {
    const deps = makeDeps({ ghList: [MERGED_PR] });
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).not.toHaveBeenCalled();
    expect(r.mergedPr).toBe(1);
    const updates = deps.pool.query.mock.calls.filter((c) => /UPDATE/.test(c[0]));
    expect(updates.some((c) => /initiative_runs/.test(c[0]) && /'done'/.test(c[0]))).toBe(true);
    expect(updates.some((c) => /UPDATE tasks/.test(c[0]) && /'completed'/.test(c[0]))).toBe(true);
  });

  it('无匹配分支（含 CLOSED 命中不算）→ 原行为：重点火', async () => {
    const deps = makeDeps({ ghList: [
      { headRefName: 'cp-unrelated-99998888', url: 'u1', state: 'OPEN' },
      { headRefName: `cp-07080800-${SHORT}`, url: 'u2', state: 'CLOSED' },
    ] });
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).toHaveBeenCalledOnce();
    expect(r.resumed).toBe(1);
  });

  it('base_repo 缺失 → 不调 gh pr list，原行为重点火', async () => {
    const deps = makeDeps({ baseRepo: null });
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.execFn.mock.calls.every((c) => !/gh pr list/.test(c[0]))).toBe(true);
    expect(deps.spawnFn).toHaveBeenCalledOnce();
    expect(r.resumed).toBe(1);
  });

  it('gh pr list 抛错 → 保守跳过：不重点火、不标 failed', async () => {
    const deps = makeDeps({ ghListThrows: true });
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).not.toHaveBeenCalled();
    expect(r.resumed).toBe(0);
    expect(r.capped).toBe(0);
    const updates = deps.pool.query.mock.calls.filter((c) => /UPDATE/.test(c[0]));
    expect(updates.some((c) => /'failed'/.test(c[0]))).toBe(false);
  });
});

describe('_parseBaseRepo', () => {
  it('github https URL（带/不带 .git、尾斜杠）→ owner/repo', () => {
    expect(_parseBaseRepo('https://github.com/org/repo.git')).toBe('org/repo');
    expect(_parseBaseRepo('https://github.com/org/repo')).toBe('org/repo');
    expect(_parseBaseRepo('https://github.com/org/repo/')).toBe('org/repo');
  });
  it('本地路径 / 非 github / 含非法字符 → null', () => {
    expect(_parseBaseRepo('/Users/x/repo')).toBe(null);
    expect(_parseBaseRepo('https://gitlab.com/org/repo')).toBe(null);
    expect(_parseBaseRepo('https://github.com/org/re;po')).toBe(null);
    expect(_parseBaseRepo(null)).toBe(null);
  });
});

describe('_discoverPrFromGithub', () => {
  it('MERGED 优先于 OPEN', () => {
    const execFn = () => JSON.stringify([
      { headRefName: `cp-a-${SHORT}`, url: 'u-open', state: 'OPEN' },
      { headRefName: `cp-b-${SHORT}`, url: 'u-merged', state: 'MERGED' },
    ]);
    const task = { payload: { base_repo: BASE_REPO } };
    expect(_discoverPrFromGithub(task, SHORT, execFn)).toMatchObject({ url: 'u-merged', state: 'MERGED' });
  });
});
```

- [ ] **Step 2: 跑测试确认 Red**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-relay-watchdog-pr-discovery.test.js 2>&1 | tail -20`
Expected: FAIL——`_parseBaseRepo`/`_discoverPrFromGithub` 未导出（SyntaxError: does not provide an export），且行为测试 1/2/5 失败（当前代码会直接重点火）。**必须亲眼看到红**（proven-to-fire）。

- [ ] **Step 3: Commit（Red）**

```bash
git add packages/brain/src/__tests__/harness-relay-watchdog-pr-discovery.test.js
git commit -m "test(brain): watchdog PR 发现护栏 failing 回归测试 (Red)"
```

---

### Task 2: 实现发现护栏（commit-2 Green）

**Files:**
- Modify: `packages/brain/src/harness-relay-watchdog.js`（两处：文件顶部函数区 + resumeStalledRelayRuns L143 后）

**Interfaces:**
- Produces: `_parseBaseRepo(baseRepo): string|null`；`_discoverPrFromGithub(task, short, execFn): {url,state,headRefName}|null`（gh 失败时抛错，由调用方 catch）

- [ ] **Step 1: 在 `shortId` 函数之后新增两个导出函数**

```js
/**
 * 从 payload.base_repo 解析 owner/repo。
 * 只放行 https://github.com/<owner>/<repo>[.git][/]，owner/repo 限 [\w.-]
 * （防 shell 注入——结果会拼进 execFn 命令）。其余返回 null。
 */
export function _parseBaseRepo(baseRepo) {
  if (typeof baseRepo !== 'string') return null;
  const m = baseRepo.match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/);
  return m ? m[1] : null;
}

/**
 * 从 GitHub 反查该 task 的 PR（Issue 198ba8db：relay session 不回写 pr_url，
 * DB 侧护栏失明）。按分支名含 task short 匹配（spawn/controller 分支规约
 * cp-*-<short>* / cp-*-ws-<short>*）。MERGED 优先于 OPEN；仅 CLOSED 视为无命中。
 * gh 调用/解析失败会抛错——调用方必须保守跳过（不盲目重点火）。
 */
export function _discoverPrFromGithub(task, short, execFn) {
  const repo = _parseBaseRepo(task.payload?.base_repo);
  if (!repo) return null;
  const raw = execFn(`gh pr list --repo "${repo}" --state all --limit 50 --json headRefName,url,state`);
  const prs = JSON.parse(raw);
  if (!Array.isArray(prs)) return null;
  const matches = prs.filter((p) => typeof p?.headRefName === 'string' && p.headRefName.includes(short));
  return matches.find((p) => p.state === 'MERGED') || matches.find((p) => p.state === 'OPEN') || null;
}
```

- [ ] **Step 2: 在 resumeStalledRelayRuns 里插入发现逻辑**

锚点：既有 MERGED 护栏结束的 `}`（`gh pr view 失败…保守跳过` catch 块所在 if 的闭合，约 L143）与 `// B6: 上限熔断` 注释之间，插入：

```js
      // PR 发现护栏（Issue 198ba8db）：relay session 不回写 pr_url，DB 三处全空时
      // 上方 MERGED 护栏失明——先从 GitHub 按分支名含 short 反查，防止
      // "已有 PR 在等 CI/审批" 被误判死跑而重复点火出重复 PR。
      if (!effectivePrUrl) {
        let discovered = null;
        try {
          discovered = _discoverPrFromGithub(task, short, execFn);
        } catch (err) {
          console.warn(`[relay-watchdog] PR 发现失败，initiative=${run.initiative_id} 保守跳过: ${err.message}`);
          continue;
        }
        if (discovered && discovered.state === 'MERGED') {
          await dbPool.query(
            `UPDATE initiative_runs SET phase='done', completed_at=NOW(), pr_url=$2
              WHERE initiative_id=$1 AND orchestrator_version='v2' AND phase NOT IN ('done','failed')`,
            [run.initiative_id, discovered.url]
          );
          await dbPool.query(
            `UPDATE tasks SET status='completed', completed_at=NOW(), pr_url=$2
              WHERE id=$1 AND status='in_progress'`,
            [run.initiative_id, discovered.url]
          );
          out.mergedPr++;
          console.log(`[relay-watchdog] GitHub 发现已 MERGED PR → 标 completed initiative=${run.initiative_id} pr=${discovered.url}`);
          continue;
        }
        if (discovered && discovered.state === 'OPEN') {
          await dbPool.query(
            `UPDATE initiative_runs SET pr_url=$2
              WHERE initiative_id=$1 AND orchestrator_version='v2' AND phase NOT IN ('done','failed')`,
            [run.initiative_id, discovered.url]
          );
          await dbPool.query(
            `UPDATE tasks SET pr_url=$2 WHERE id=$1 AND pr_url IS NULL`,
            [run.initiative_id, discovered.url]
          );
          console.log(`[relay-watchdog] GitHub 发现在途 OPEN PR → 回写 pr_url 跳过重点火 initiative=${run.initiative_id} pr=${discovered.url}`);
          continue;
        }
        // 仅 CLOSED / 无命中 → 走原逻辑（attempt cap → 重点火）
      }
```

- [ ] **Step 3: 跑新测试确认 Green**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-relay-watchdog-pr-discovery.test.js 2>&1 | tail -10`
Expected: 全部 PASS（9 tests）。

- [ ] **Step 4: 跑既有 watchdog 测试确认无回归**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-relay-watchdog.test.js src/__tests__/harness-skill-relay.test.js 2>&1 | tail -10`
Expected: 全部 PASS。
注意：既有测试的 makeDeps 里 execFn 对 `gh pr list` 返回 `''`（default 分支返回空串）→ `JSON.parse('')` 会抛错 → 新逻辑保守跳过 → **可能导致既有 "重点火一次" 测试失败**。若失败，属预期冲突：给既有测试的 execFn mock 增加 `if (/gh pr list/.test(cmd)) return '[]';` 一行（放在 `docker ps` 判断之后），不改断言。

- [ ] **Step 5: Commit（Green）**

```bash
git add packages/brain/src/harness-relay-watchdog.js packages/brain/src/__tests__/harness-relay-watchdog.test.js
git commit -m "fix(brain): watchdog 重点火前从 GitHub 反查已有 PR——OPEN 回写跳过/MERGED 收敛，杜绝重复 PR"
```

---

### Task 3: 版本 bump + DevGate + Learning

**Files:**
- Modify: `packages/brain/package.json`（version 1.243.1 → 1.243.2）
- Modify: `packages/brain/package-lock.json`（npm 同步）
- Modify: `DEFINITION.md`（版本行 1.243.1 → 1.243.2）
- Create: `docs/learnings/cp-07081417-relay-watchdog-pr-check.md`

- [ ] **Step 1: bump 版本三处**

```bash
cd packages/brain
npm version 1.243.2 --no-git-tag-version
cd ../..
grep -n "1.243.1" DEFINITION.md   # 找到版本行
# 用编辑器把 DEFINITION.md 中 brain 版本 1.243.1 改为 1.243.2
```

- [ ] **Step 2: DevGate 校验**

Run: `bash scripts/check-version-sync.sh && node scripts/facts-check.mjs`
Expected: 两者都 ✅。失败则按报错补齐（可能还有 .brain-versions 等第 4 处，脚本会指出）。

- [ ] **Step 3: 写 Learning**

创建 `docs/learnings/cp-07081417-relay-watchdog-pr-check.md`：

```markdown
# relay watchdog 重复点火出重复 PR

### 根本原因
watchdog 判死 = 容器消失；relay session 全程不回写 pr_url；既有 MERGED 护栏只读 DB 三处 pr_url，全空即失明 → 已开 PR 等 CI/审批的"活任务"被当死跑重点火，新 session 全新分支从头再跑 → 同任务多个重复 PR（5d090237 实证：5 attempt / 4 个 open PR）。

### 下次预防
- [ ] 外部编排的收敛判据必须以外部真相（GitHub）兜底，不能只信自家 DB 回写
- [ ] 任何"重试/重点火"逻辑上线前先问：重试前查过已有产出吗？
- [ ] 阶段二（另任务）：harness-controller 开 PR 后立即回写 pr_url；重点火 session 接续已有分支而非另起
```

- [ ] **Step 4: Commit**

```bash
git add packages/brain/package.json packages/brain/package-lock.json DEFINITION.md docs/learnings/cp-07081417-relay-watchdog-pr-check.md
git commit -m "chore(brain): bump 1.243.2 + learning（watchdog PR 发现护栏）"
```
