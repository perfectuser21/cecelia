# A3 Promotion 冻结登记 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After evaluator PASS, automatically freeze the sprint's verified golden path into `golden_path` table + `regression-contract.yaml` so B1's unconditional regression re-runs deterministic scripts instead of re-summoning the LLM judge.

**Architecture:** New self-contained module `packages/brain/src/harness-promote-regression.js` (pure parse/merge functions + `promoteToRegression` orchestrator with injected `{pool, execFile}` deps), wired into `reportNode`'s currently-empty PASS branch as best-effort. The yaml change reaches main via a dedicated auto-merge PR created by the module itself (at reportNode time all sub-task PRs are already merged — there is no other ride to main).

**Tech Stack:** Node.js ESM, js-yaml (`^4.1.1` already in packages/brain deps), pg (mocked), vitest.

**Spec (read it first):** `docs/superpowers/specs/2026-07-02-a3-promote-regression-design.md` — contains the two deliberate corrections vs the original A3 方案文档 (schema aligned to `run-core-regression.sh`'s `test_command` field; auto-PR channel). The spec wins over the 方案文档 on any conflict.

**Worktree:** `/Users/administrator/worktrees/cecelia/a3-promote-regression` — Bash cwd resets every call; prefix EVERY command with `cd /Users/administrator/worktrees/cecelia/a3-promote-regression &&`. Tests run from `packages/brain`.

---

### Task 1: Pure functions (parse + merge)

**Files:**
- Create: `packages/brain/src/harness-promote-regression.js`
- Create: `packages/brain/src/__tests__/harness-promote-regression.test.js`

- [ ] **Step 1: Write the failing tests (pure-function half)**

Create `packages/brain/src/__tests__/harness-promote-regression.test.js`:

```javascript
/**
 * harness-promote-regression.test.js — A3 冻结登记单测。
 * 纯函数：parseBehaviorEntries / parseGoldenPathSteps / buildGoldenPathEntries / mergeGoldenPaths
 * 主函数：promoteToRegression（mock pool + execFile + fs 注入，见 Task 2 追加的 describe）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  parseBehaviorEntries,
  parseGoldenPathSteps,
  buildGoldenPathEntries,
  mergeGoldenPaths,
} from '../harness-promote-regression.js';

describe('parseBehaviorEntries', () => {
  it('标准格式：desc + manual: 命令成对提取', () => {
    const md = [
      '## BEHAVIOR 条目',
      '',
      '- [ ] [BEHAVIOR] 发布成功且 DB 有新记录',
      "  Test: manual:bash -c 'curl -s $API | jq -e \".ok\"'",
      '- [x] [BEHAVIOR] 页面显示文字',
      '  Test: manual:node -e "process.exit(0)"',
    ].join('\n');
    const out = parseBehaviorEntries(md);
    expect(out).toHaveLength(2);
    expect(out[0].desc).toBe('发布成功且 DB 有新记录');
    expect(out[0].cmd).toBe("bash -c 'curl -s $API | jq -e \".ok\"'");
    expect(out[1].desc).toBe('页面显示文字');
    expect(out[1].cmd).toBe('node -e "process.exit(0)"');
  });

  it('无 Test: manual: 行的 BEHAVIOR 条目被跳过（不产半卡）', () => {
    const md = '- [ ] [BEHAVIOR] 只有描述没有命令\n\n- [ ] [BEHAVIOR] 有命令\n  Test: manual:true';
    const out = parseBehaviorEntries(md);
    expect(out).toHaveLength(1);
    expect(out[0].cmd).toBe('true');
  });

  it('无匹配 → 空数组', () => {
    expect(parseBehaviorEntries('# 空文档')).toEqual([]);
  });
});

describe('parseGoldenPathSteps', () => {
  it('标准 ## Golden Path 段编号列表', () => {
    const md = [
      '# sprint-prd',
      '## Golden Path（核心场景）',
      '用户从 [入口] → 到达 [出口]',
      '具体：',
      '1. 用户点击发布',
      '2. 系统调用 API',
      '3. 页面出现成功提示',
      '',
      '## 下一段',
    ].join('\n');
    const out = parseGoldenPathSteps(md);
    expect(out).toEqual([
      { order_no: 1, note: '用户点击发布' },
      { order_no: 2, note: '系统调用 API' },
      { order_no: 3, note: '页面出现成功提示' },
    ]);
  });

  it('段缺失 → 空数组（调用方降级到 BEHAVIOR 序号）', () => {
    expect(parseGoldenPathSteps('# 无 golden path 段')).toEqual([]);
  });
});

describe('buildGoldenPathEntries', () => {
  const base = {
    taskId: 'bd7e251c-0000-0000-0000-000000000001',
    journeyId: 'bb8cc561-b3ee-4fec-b74d-2255694bd963',
    behaviors: [
      { desc: '发布成功', cmd: 'bash -c true' },
      { desc: '记录落库', cmd: 'psql "$DB" -c "SELECT 1" | grep -q 1' },
    ],
    prUrl: 'https://github.com/x/y/pull/1',
    sprintDir: 'sprints/0702-demo',
    now: '2026-07-02T03:00:00.000Z',
  };

  it('每个 BEHAVIOR 一条，schema 对齐 run-core-regression.sh 消费字段', () => {
    const out = buildGoldenPathEntries(base);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      id: 'GP-bd7e251c-001',
      name: '发布成功',
      priority: 'P0',
      trigger: ['PR', 'Release'],
      method: 'auto',
      test_command: 'bash -c true',
      owner_task_id: base.taskId,
      journey_id: base.journeyId,
    });
    expect(out[1].id).toBe('GP-bd7e251c-002');
    expect(out[0].source).toMatchObject({
      pr_url: base.prUrl,
      sprint_dir: base.sprintDir,
      frozen_at: base.now,
    });
  });
});

describe('mergeGoldenPaths', () => {
  it('幂等：同 task 前缀旧条目被覆盖，跑两次条目数不翻倍', () => {
    const fresh = [
      { id: 'GP-bd7e251c-001', name: 'v2 卡片', test_command: 'true' },
    ];
    const existing = [
      { id: 'CORE-001', name: '别人的卡', test_command: 'node --check x.js' },
      { id: 'GP-bd7e251c-001', name: 'v1 旧卡', test_command: 'false' },
      { id: 'GP-bd7e251c-002', name: 'v1 已删步骤的旧卡', test_command: 'false' },
    ];
    const merged = mergeGoldenPaths(existing, fresh, 'GP-bd7e251c-');
    expect(merged).toHaveLength(2);
    expect(merged.find((g) => g.id === 'CORE-001')).toBeTruthy();
    expect(merged.find((g) => g.id === 'GP-bd7e251c-001').name).toBe('v2 卡片');
    expect(merged.find((g) => g.id === 'GP-bd7e251c-002')).toBeUndefined();
    // 再跑一次不翻倍
    const twice = mergeGoldenPaths(merged, fresh, 'GP-bd7e251c-');
    expect(twice).toHaveLength(2);
  });

  it('existing 为空/undefined 容忍', () => {
    expect(mergeGoldenPaths(undefined, [{ id: 'GP-a-001' }], 'GP-a-')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/administrator/worktrees/cecelia/a3-promote-regression/packages/brain && npx vitest run src/__tests__/harness-promote-regression.test.js`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Commit test-only**

```bash
cd /Users/administrator/worktrees/cecelia/a3-promote-regression && git add packages/brain/src/__tests__/harness-promote-regression.test.js && git commit -m "test: failing tests for A3 promote-regression pure functions"
```

- [ ] **Step 4: Implement the pure functions**

Create `packages/brain/src/harness-promote-regression.js`:

```javascript
/**
 * harness-promote-regression.js — A3 冻结登记（harness 验证模型重构）。
 *
 * evaluator PASS 后把判官的一次性判断固化成常驻卡片：
 *   ① golden_path 表覆盖写（结构化事实：这条路径已被验收）
 *   ② regression-contract.yaml 追加 golden_paths 条目（读卡机卡片，B1 无条件复跑）
 *   ③ commit 校验拒假卡（引用物必须已被 git 跟踪）
 *
 * yaml schema 对齐 B1 消费方 scripts/ci/run-core-regression.sh（yq 读
 * golden_paths[].id/.trigger[]/.test_command）——不是 A3 方案文档里的 checks[] 数组。
 * yaml 上 main 走本模块自开的 auto-merge PR（reportNode 时 sub-task PR 已全 merge，
 * 没有别的顺风车）。
 *
 * Spec: docs/superpowers/specs/2026-07-02-a3-promote-regression-design.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import yaml from 'js-yaml';
import pool from './db.js';

const defaultExecFile = promisify(nodeExecFile);

// yaml dump 会丢注释头 → 抽成常量重贴（保持与现存文件头一致）
export const CONTRACT_HEADER = `# ============================================================================
# Regression Contract - cecelia-core
# ============================================================================
# 全量回归的唯一合法定义来源
#
# Trigger 规则：
#   - PR:      跑 trigger 包含 PR 的条目
#   - Release: 跑 trigger 包含 Release 的条目
# ============================================================================

`;

/**
 * 解析 contract-dod.md 的 [BEHAVIOR] 条目。
 * 格式：`- [ ] [BEHAVIOR] <desc>` 下一行（允许隔缩进）`Test: manual:<cmd>`。
 * 没有 manual: 命令的条目跳过（不产半卡）。
 * @returns {Array<{desc: string, cmd: string}>}
 */
export function parseBehaviorEntries(text) {
  const out = [];
  const lines = String(text || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*-\s*\[[ x]\]\s*\[BEHAVIOR\]\s*(.+)$/);
    if (!m) continue;
    const desc = m[1].trim();
    // 向下找最近的 Test: manual: 行（下一个 BEHAVIOR 条目前）
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*-\s*\[[ x]\]\s*\[BEHAVIOR\]/.test(lines[j])) break;
      const t = lines[j].match(/^\s*Test:\s*manual:(.+)$/);
      if (t) {
        out.push({ desc, cmd: t[1].trim() });
        break;
      }
    }
  }
  return out;
}

/**
 * 解析 sprint-prd.md 的 ## Golden Path 段编号列表。
 * 格式（harness-planner SKILL 模板，已验证 3 个现存样本一致）：
 *   ## Golden Path（核心场景）
 *   ...
 *   1. <步骤>
 * @returns {Array<{order_no: number, note: string}>}
 */
export function parseGoldenPathSteps(text) {
  const src = String(text || '');
  const sec = src.match(/^##\s*Golden Path[^\n]*\n([\s\S]*?)(?=^##\s|\n*$(?![\s\S]))/m);
  if (!sec) return [];
  const out = [];
  for (const line of sec[1].split('\n')) {
    const m = line.match(/^\s*(\d+)[.、)]\s*(.+)$/);
    if (m) out.push({ order_no: parseInt(m[1], 10), note: m[2].trim() });
  }
  return out;
}

/**
 * 把 [BEHAVIOR] 条目构建成 regression-contract.yaml golden_paths 条目。
 * schema 对齐 run-core-regression.sh：id/trigger/test_command 是消费字段，
 * owner_task_id/journey_id/source 是溯源附加（yq 按需取，多余无害）。
 */
export function buildGoldenPathEntries({ taskId, journeyId, behaviors, prUrl, sprintDir, now }) {
  const prefix = `GP-${String(taskId).slice(0, 8)}-`;
  return (behaviors || []).map((b, i) => ({
    id: `${prefix}${String(i + 1).padStart(3, '0')}`,
    name: b.desc,
    priority: 'P0',
    trigger: ['PR', 'Release'],
    method: 'auto',
    test_command: b.cmd,
    owner_task_id: taskId,
    journey_id: journeyId || null,
    source: { pr_url: prUrl || null, sprint_dir: sprintDir, frozen_at: now },
  }));
}

/**
 * 幂等合并：滤掉同 task 前缀的旧条目再追加 fresh（同 ability 二次 PASS 覆盖不叠加）。
 */
export function mergeGoldenPaths(existing, fresh, taskPrefix) {
  const kept = (existing || []).filter((g) => !String(g?.id || '').startsWith(taskPrefix));
  return [...kept, ...fresh];
}

export default { parseBehaviorEntries, parseGoldenPathSteps, buildGoldenPathEntries, mergeGoldenPaths };
```

- [ ] **Step 5: Run to verify pass, commit**

Run: `cd /Users/administrator/worktrees/cecelia/a3-promote-regression/packages/brain && npx vitest run src/__tests__/harness-promote-regression.test.js`
Expected: PASS.

```bash
cd /Users/administrator/worktrees/cecelia/a3-promote-regression && git add packages/brain/src/harness-promote-regression.js && git commit -m "feat(brain): A3 promote-regression pure functions (parse + merge)"
```

---

### Task 2: promoteToRegression orchestrator

**Files:**
- Modify: `packages/brain/src/harness-promote-regression.js` (append)
- Modify: `packages/brain/src/__tests__/harness-promote-regression.test.js` (append describe)

- [ ] **Step 1: Append failing tests**

Append to the test file:

```javascript
describe('promoteToRegression', () => {
  const TASK = {
    id: 'bd7e251c-0000-0000-0000-000000000001',
    payload: {
      journey_id: 'bb8cc561-b3ee-4fec-b74d-2255694bd963',
      feature_id: 'fe000000-0000-0000-0000-000000000001',
    },
  };
  const SPRINT_DIR = 'sprints/0702-demo';
  const WT = '/tmp/fake-worktree';

  function makeDeps({ lsFilesFails = false, files = {} } = {}) {
    const queries = [];
    const client = {
      query: vi.fn(async (sql, params) => {
        queries.push({ sql, params });
        if (/SELECT id FROM journey_features/i.test(sql)) return { rows: [{ id: TASK.payload.feature_id }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const poolMock = { connect: vi.fn(async () => client) };
    const execFileCalls = [];
    const execFileMock = vi.fn(async (cmd, args, opts2) => {
      execFileCalls.push({ cmd, args });
      if (cmd === 'git' && args[0] === 'ls-files' && lsFilesFails) {
        const e = new Error('not tracked'); e.code = 1; throw e;
      }
      return { stdout: '', stderr: '' };
    });
    const fsMock = {
      readFileSync: vi.fn((p) => {
        const key = Object.keys(files).find((k) => String(p).endsWith(k));
        if (key) return files[key];
        const e = new Error(`ENOENT ${p}`); e.code = 'ENOENT'; throw e;
      }),
      writeFileSync: vi.fn(),
      existsSync: vi.fn((p) => Object.keys(files).some((k) => String(p).endsWith(k))),
    };
    return { poolMock, client, queries, execFileMock, execFileCalls, fsMock };
  }

  const GOOD_FILES = {
    'sprint-prd.md': '## Golden Path\n1. 步骤一\n2. 步骤二\n',
    'contract-dod.md': '- [ ] [BEHAVIOR] 行为一\n  Test: manual:true\n',
    'regression-contract.yaml': 'version: "1.0.0"\nupdated: "2026-02-04"\ncore: []\ngolden_paths: []\n',
  };

  let promoteToRegression;
  beforeEach(async () => {
    ({ promoteToRegression } = await import('../harness-promote-regression.js'));
  });

  it('happy path：DB 覆盖写（DELETE 后 INSERT，事务）+ yaml auto-PR 流程走完', async () => {
    const d = makeDeps({ files: GOOD_FILES });
    const r = await promoteToRegression(
      { pool: d.poolMock, execFile: d.execFileMock, fsImpl: d.fsMock },
      { task: TASK, sprintDir: SPRINT_DIR, subTasks: [{ pr_url: 'https://github.com/x/y/pull/9' }], worktreePath: WT },
    );
    expect(r.ok).toBe(true);
    expect(r.dbWritten).toBe(true);
    const sqls = d.queries.map((q) => q.sql);
    expect(sqls.some((s) => /BEGIN/i.test(s))).toBe(true);
    expect(sqls.some((s) => /DELETE FROM golden_path WHERE owner_task_id/i.test(s))).toBe(true);
    expect(sqls.some((s) => /INSERT INTO golden_path/i.test(s))).toBe(true);
    expect(sqls.some((s) => /COMMIT/i.test(s))).toBe(true);
    // yaml 写入 + git 流程被调用（checkout -b / commit / push / gh pr create）
    expect(d.fsMock.writeFileSync).toHaveBeenCalled();
    const gitArgs = d.execFileCalls.map((c) => `${c.cmd} ${c.args.join(' ')}`);
    expect(gitArgs.some((s) => s.includes('checkout -b'))).toBe(true);
    expect(gitArgs.some((s) => s.startsWith('gh pr create'))).toBe(true);
  });

  it('commit 校验失败（contract-dod.md 未被 git 跟踪）→ yaml 跳过但 DB 保留', async () => {
    const d = makeDeps({ files: GOOD_FILES, lsFilesFails: true });
    const r = await promoteToRegression(
      { pool: d.poolMock, execFile: d.execFileMock, fsImpl: d.fsMock },
      { task: TASK, sprintDir: SPRINT_DIR, subTasks: [], worktreePath: WT },
    );
    expect(r.dbWritten).toBe(true);
    expect(r.yamlPrUrl == null).toBe(true);
    expect(d.fsMock.writeFileSync).not.toHaveBeenCalled();
  });

  it('worktreePath/sprintDir 为空 → 整体 skipped，不碰 DB', async () => {
    const d = makeDeps({ files: GOOD_FILES });
    const r = await promoteToRegression(
      { pool: d.poolMock, execFile: d.execFileMock, fsImpl: d.fsMock },
      { task: TASK, sprintDir: null, subTasks: [], worktreePath: WT },
    );
    expect(r.skipped).toBe(true);
    expect(d.poolMock.connect).not.toHaveBeenCalled();
  });

  it('sprint-prd 无 Golden Path 段 → 降级用 BEHAVIOR 序号写 golden_path 表', async () => {
    const files = { ...GOOD_FILES, 'sprint-prd.md': '# 没有 golden path 段' };
    const d = makeDeps({ files });
    const r = await promoteToRegression(
      { pool: d.poolMock, execFile: d.execFileMock, fsImpl: d.fsMock },
      { task: TASK, sprintDir: SPRINT_DIR, subTasks: [], worktreePath: WT },
    );
    expect(r.dbWritten).toBe(true);
    const ins = d.queries.find((q) => /INSERT INTO golden_path/i.test(q.sql));
    expect(ins.params.join(' ')).toContain('行为一'); // 降级 note = BEHAVIOR 描述
  });

  it('DB 阶段抛错 → ROLLBACK 且不抛出（best-effort，返回 ok:false）', async () => {
    const d = makeDeps({ files: GOOD_FILES });
    d.client.query.mockImplementation(async (sql) => {
      if (/INSERT INTO golden_path/i.test(sql)) throw new Error('db boom');
      d.queries.push({ sql });
      return { rows: [] };
    });
    const r = await promoteToRegression(
      { pool: d.poolMock, execFile: d.execFileMock, fsImpl: d.fsMock },
      { task: TASK, sprintDir: SPRINT_DIR, subTasks: [], worktreePath: WT },
    );
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure** (`promoteToRegression` not exported yet)

- [ ] **Step 3: Commit test-only**

```bash
cd /Users/administrator/worktrees/cecelia/a3-promote-regression && git add packages/brain/src/__tests__/harness-promote-regression.test.js && git commit -m "test: failing tests for promoteToRegression orchestrator"
```

- [ ] **Step 4: Implement promoteToRegression (append to module)**

```javascript
/**
 * promoteToRegression — PASS 后冻结登记主函数（best-effort，绝不 throw）。
 *
 * @param {{pool?: object, execFile?: Function, fsImpl?: object, now?: string}} deps
 * @param {{task: object, sprintDir: string, subTasks: Array, worktreePath: string}} params
 * @returns {Promise<{ok: boolean, dbWritten: boolean, yamlPrUrl?: string|null, skipped?: boolean, reason?: string}>}
 */
export async function promoteToRegression(deps = {}, params = {}) {
  const dbPool = deps.pool || pool;
  const execFile = deps.execFile || defaultExecFile;
  const fsImpl = deps.fsImpl || fs;
  const now = deps.now || new Date().toISOString();
  const { task, sprintDir, subTasks, worktreePath } = params;

  const taskId = task?.id;
  if (!taskId || !sprintDir || !worktreePath) {
    console.warn(`[promote-regression] skipped: 缺 taskId/sprintDir/worktreePath (task=${taskId} sprintDir=${sprintDir} wt=${worktreePath})`);
    await _alert(`A3 冻结跳过：task=${taskId} 缺 sprintDir/worktreePath`);
    return { ok: false, dbWritten: false, skipped: true, reason: 'missing_inputs' };
  }

  // ── 解析原料 ──
  const readOrNull = (p) => { try { return fsImpl.readFileSync(p, 'utf8'); } catch { return null; } };
  const prdText = readOrNull(path.join(worktreePath, sprintDir, 'sprint-prd.md'));
  const dodText = readOrNull(path.join(worktreePath, sprintDir, 'contract-dod.md'));
  const behaviors = parseBehaviorEntries(dodText || '');
  let steps = parseGoldenPathSteps(prdText || '');
  if (steps.length === 0 && behaviors.length > 0) {
    // 降级：BEHAVIOR 条目序号当步骤（note=描述），不依赖 sprint-prd 解析
    steps = behaviors.map((b, i) => ({ order_no: i + 1, note: b.desc }));
  }
  if (steps.length === 0 && behaviors.length === 0) {
    console.warn(`[promote-regression] skipped: ${sprintDir} 无 Golden Path 也无 [BEHAVIOR] 可冻结`);
    await _alert(`A3 冻结跳过：task=${taskId} 无可冻结内容（${sprintDir}）`);
    return { ok: false, dbWritten: false, skipped: true, reason: 'nothing_to_freeze' };
  }

  // ── ① golden_path 表覆盖写（事务）──
  let dbWritten = false;
  try {
    const client = await dbPool.connect();
    try {
      await client.query('BEGIN');
      // feature_id 验证存在，失败留 NULL（schema ON DELETE SET NULL 语义一致）
      let featureId = null;
      const rawFeatureId = task?.payload?.feature_id;
      if (rawFeatureId) {
        try {
          const fe = await client.query('SELECT id FROM journey_features WHERE id=$1', [rawFeatureId]);
          featureId = fe.rows[0]?.id || null;
        } catch { featureId = null; }
      }
      await client.query('DELETE FROM golden_path WHERE owner_task_id=$1', [taskId]);
      for (const s of steps) {
        await client.query(
          'INSERT INTO golden_path (owner_task_id, order_no, feature_id, note) VALUES ($1,$2,$3,$4)',
          [taskId, s.order_no, featureId, s.note],
        );
      }
      await client.query('COMMIT');
      dbWritten = true;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* noop */ }
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(`[promote-regression] golden_path DB 写失败 task=${taskId}: ${err.message}`);
    await _alert(`A3 冻结 DB 写失败：task=${taskId} ${err.message}`);
    return { ok: false, dbWritten: false, reason: 'db_write_failed' };
  }

  // ── ② commit 校验（防假卡）── behaviors 为空则没有 yaml 可冻，直接返回
  if (behaviors.length === 0) {
    console.warn(`[promote-regression] DB 已写但无 [BEHAVIOR] 命令，yaml 冻结跳过 task=${taskId}`);
    return { ok: true, dbWritten, yamlPrUrl: null, reason: 'no_behavior_commands' };
  }
  try {
    await execFile('git', ['ls-files', '--error-unmatch', path.join(sprintDir, 'contract-dod.md')], { cwd: worktreePath });
  } catch {
    console.error(`[promote-regression] contract-dod.md 未被 git 跟踪，拒绝冻结假卡 task=${taskId}`);
    await _alert(`A3 冻结拒绝（假卡防护）：task=${taskId} contract-dod.md 未入库`);
    return { ok: true, dbWritten, yamlPrUrl: null, reason: 'dod_not_committed' };
  }

  // ── ③ yaml 冻结 + 专属 auto-PR ──
  try {
    const contractPath = path.join(worktreePath, 'regression-contract.yaml');
    const raw = readOrNull(contractPath) || 'version: "1.0.0"\ncore: []\ngolden_paths: []\n';
    const doc = yaml.load(raw) || {};
    const prUrl = (subTasks || []).map((t) => t?.pr_url).filter(Boolean)[0] || null;
    const fresh = buildGoldenPathEntries({
      taskId, journeyId: task?.payload?.journey_id, behaviors, prUrl, sprintDir, now,
    });
    const prefix = `GP-${String(taskId).slice(0, 8)}-`;
    doc.golden_paths = mergeGoldenPaths(doc.golden_paths, fresh, prefix);
    doc.updated = now.slice(0, 10);
    fsImpl.writeFileSync(contractPath, CONTRACT_HEADER + yaml.dump(doc, { lineWidth: 200 }), 'utf8');

    // 专属 auto-PR（reportNode 时 sub-task PR 已 merge，yaml 没有别的顺风车上 main）
    const branch = `cp-${now.slice(5, 16).replace(/[-T:]/g, '')}-promote-regression-${String(taskId).slice(0, 8)}`;
    const run = (args) => execFile('git', args, { cwd: worktreePath });
    await run(['checkout', '-b', branch]);
    await run(['add', 'regression-contract.yaml']);
    await run(['commit', '-m', `feat(regression): freeze golden path GP-${String(taskId).slice(0, 8)} (A3 promotion)`]);
    await run(['push', '-u', 'origin', branch]);
    const pr = await execFile('gh', ['pr', 'create', '--fill', '--title', `feat(regression): A3 冻结 ${String(taskId).slice(0, 8)} 验收卡片`], { cwd: worktreePath });
    const yamlPrUrl = String(pr.stdout || '').trim().split('\n').pop() || null;
    try { await execFile('gh', ['pr', 'merge', '--auto', '--squash', yamlPrUrl], { cwd: worktreePath }); } catch { /* auto-merge best-effort */ }
    console.log(`[promote-regression] 冻结完成 task=${taskId} → ${yamlPrUrl}`);
    return { ok: true, dbWritten, yamlPrUrl };
  } catch (err) {
    console.error(`[promote-regression] yaml 冻结/auto-PR 失败（DB 已写）task=${taskId}: ${err.message}`);
    await _alert(`A3 yaml 冻结失败（DB 已登记）：task=${taskId} ${err.message}`);
    return { ok: true, dbWritten, yamlPrUrl: null, reason: 'yaml_freeze_failed' };
  }
}

/** best-effort 飞书告警（缺 token/失败静默，与 reportNode non-fatal 风格一致） */
async function _alert(text) {
  try {
    const { sendFeishu } = await import('./notifier.js');
    await sendFeishu(`⚠️ [A3 promote-regression] ${text}`);
  } catch { /* non-fatal */ }
}
```

Also update the default export to include `promoteToRegression`.

Note for implementer: check `notifier.js`'s export list first (`grep -n "export" packages/brain/src/notifier.js` around line 306) — if `sendFeishu` is not in the export block, use whichever exported generic send function exists, or wrap with the same try/catch and accept the import failing silently.

- [ ] **Step 5: Run tests, all pass; commit**

Run: `cd /Users/administrator/worktrees/cecelia/a3-promote-regression/packages/brain && npx vitest run src/__tests__/harness-promote-regression.test.js`
Expected: PASS (all describes).

```bash
cd /Users/administrator/worktrees/cecelia/a3-promote-regression && git add packages/brain/src/harness-promote-regression.js && git commit -m "feat(brain): promoteToRegression orchestrator (A3 freeze on PASS)"
```

---

### Task 3: reportNode wiring

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js` (reportNode, insert right before the `if (computedVerdict !== 'PASS')` block at ~L1589)
- Create: `packages/brain/src/__tests__/harness-promote-wiring.test.js`

- [ ] **Step 1: Write failing wiring tests**

```javascript
/**
 * harness-promote-wiring.test.js — A3 reportNode 接线测试。
 * PASS → promoteToRegression 被调；FAIL → 不调；promote 抛错 → reportNode 仍返回 report_path。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const promoteMock = vi.fn(async () => ({ ok: true, dbWritten: true }));
vi.mock('../harness-promote-regression.js', () => ({
  promoteToRegression: promoteMock,
  default: { promoteToRegression: promoteMock },
}));
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(async () => ({ rows: [] })),
    connect: vi.fn(async () => ({ query: vi.fn(async () => ({ rows: [] })), release: vi.fn() })),
  },
}));

function makePool() {
  return {
    query: vi.fn(async () => ({ rows: [] })),
    connect: vi.fn(async () => ({ query: vi.fn(async () => ({ rows: [] })), release: vi.fn() })),
  };
}

const baseState = {
  initiativeId: 'bd7e251c-0000-0000-0000-000000000001',
  task: { id: 'bd7e251c-0000-0000-0000-000000000001', title: 't', payload: { journey_id: 'j1', feature_id: 'f1' } },
  sprintDir: 'sprints/0702-demo',
  worktreePath: '/tmp/wt',
  sub_tasks: [{ id: 'ws1', status: 'merged', pr_url: 'https://github.com/x/y/pull/9', evaluate_verdict: 'PASS' }],
};

describe('reportNode × promoteToRegression 接线', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('computedVerdict=PASS（全 merged）→ promoteToRegression 被调一次', async () => {
    const { reportNode } = await import('../workflows/harness-initiative.graph.js');
    const r = await reportNode(baseState, { pool: makePool(), _checkPrMerged: async () => true });
    expect(r.report_path).toBeTruthy();
    expect(promoteMock).toHaveBeenCalledTimes(1);
    const [, params] = promoteMock.mock.calls[0];
    expect(params.task.id).toBe(baseState.task.id);
    expect(params.sprintDir).toBe('sprints/0702-demo');
  });

  it('computedVerdict=FAIL（有未 merged）→ 不调 promote', async () => {
    const { reportNode } = await import('../workflows/harness-initiative.graph.js');
    const failState = { ...baseState, sub_tasks: [{ id: 'ws1', status: 'failed', evaluate_verdict: 'FAIL' }] };
    await reportNode(failState, { pool: makePool(), _checkPrMerged: async () => false });
    expect(promoteMock).not.toHaveBeenCalled();
  });

  it('promote 抛错 → reportNode 不炸，仍返回 report_path', async () => {
    promoteMock.mockRejectedValueOnce(new Error('promotion boom'));
    const { reportNode } = await import('../workflows/harness-initiative.graph.js');
    const r = await reportNode(baseState, { pool: makePool(), _checkPrMerged: async () => true });
    expect(r.report_path).toBeTruthy();
  });
});
```

Note for implementer: reportNode has an idempotency gate `if (state.report_path) return ...` at ~L1409 and does several DB/exec things — if the mocks above are insufficient (e.g., it calls `opts.execFile` for self-merge only when statuses need fixing; with status already 'merged' + evaluate_verdict PASS it should skip self-merge), adjust the state/mocks so the node reaches the verdict computation naturally. Read the actual reportNode code first (L1406-1620). Existing test `harness-reporter-payload.test.js` shows the working mock pattern — copy its approach.

- [ ] **Step 2: Run to verify failure** (promoteMock never called — wiring absent)

- [ ] **Step 3: Commit test-only**

```bash
cd /Users/administrator/worktrees/cecelia/a3-promote-regression && git add packages/brain/src/__tests__/harness-promote-wiring.test.js && git commit -m "test: failing wiring tests for reportNode PASS → promoteToRegression"
```

- [ ] **Step 4: Wire into reportNode**

In `harness-initiative.graph.js`, right BEFORE the existing `if (computedVerdict !== 'PASS') {` failure-report block (~L1589), insert:

```javascript
  // A3 Promotion（harness 验证模型重构）：PASS → 冻结登记（golden_path 表 + regression-contract.yaml）。
  // best-effort：冻结失败绝不阻断生命周期闭合（内部已告警）；只 PASS 触发，FAIL/SKIP 不冻结。
  if (computedVerdict === 'PASS') {
    try {
      const { promoteToRegression } = await import('../harness-promote-regression.js');
      await promoteToRegression(
        { pool: dbPool, execFile: opts.execFile },
        {
          task: state.task,
          sprintDir: state.sprintDir,
          subTasks: reconciledSubTasks,
          worktreePath: state.worktreePath,
        },
      );
    } catch (err) {
      console.warn(`[reportNode] promoteToRegression failed (non-fatal): ${err.message}`);
    }
  }
```

(`dbPool` and `reconciledSubTasks` are already in scope at that point; `opts.execFile` may be undefined → promoteToRegression falls back to its own default.)

- [ ] **Step 5: Run wiring tests + full graph test regression**

Run: `cd /Users/administrator/worktrees/cecelia/a3-promote-regression/packages/brain && npx vitest run src/__tests__/harness-promote-wiring.test.js src/__tests__/harness-reporter-payload.test.js && npx vitest run src/workflows/`
Expected: PASS, no regressions in existing graph/report tests.

- [ ] **Step 6: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/a3-promote-regression && git add packages/brain/src/workflows/harness-initiative.graph.js && git commit -m "feat(brain): wire promoteToRegression into reportNode PASS branch (A3)"
```

---

### Task 4: Smoke script

**Files:**
- Create: `packages/brain/scripts/smoke/harness-promote-regression-smoke.sh` (chmod +x)

- [ ] **Step 1: Write the smoke script**

Pattern-match `packages/brain/scripts/smoke/journey-goldenpaths-invariants-smoke.sh` (env handling: `BRAIN_URL`/`DATABASE_URL` with local defaults). This smoke exercises the DB layer + pure functions against the real DB WITHOUT needing gh/git (execFile mocked to no-op via a node inline script):

```bash
#!/usr/bin/env bash
# harness-promote-regression-smoke.sh
# 真环境 smoke：A3 promoteToRegression 的 DB 冻结层 + 解析/幂等纯函数全链路。
# git/gh 外部调用注入 no-op mock（smoke 不真开 PR），yaml 写到临时目录。
set -euo pipefail

DB_URL="${DATABASE_URL:-${DB_URL:-postgresql://localhost/cecelia}}"
export SMOKE_DB_URL="$DB_URL"

echo "[smoke] A3 promote-regression — DB=$DB_URL"
cd "$(dirname "$0")/../.."   # → packages/brain

node --input-type=module -e '
import { promoteToRegression, parseBehaviorEntries, mergeGoldenPaths } from "./src/harness-promote-regression.js";
import pg from "pg";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const pool = new pg.Pool({ connectionString: process.env.SMOKE_DB_URL });
const client0 = await pool.connect();

// 夹具：真实 task
const t = await client0.query("INSERT INTO tasks (title) VALUES ($1) RETURNING id", ["a3-smoke-task-" + Date.now()]);
const taskId = t.rows[0].id;
client0.release();

// 临时 worktree 目录 + sprint 文件
const wt = fs.mkdtempSync(path.join(os.tmpdir(), "a3-smoke-"));
const sprintDir = "sprints/a3-smoke";
fs.mkdirSync(path.join(wt, sprintDir), { recursive: true });
fs.writeFileSync(path.join(wt, sprintDir, "sprint-prd.md"), "## Golden Path\n1. 步骤一\n2. 步骤二\n");
fs.writeFileSync(path.join(wt, sprintDir, "contract-dod.md"), "- [ ] [BEHAVIOR] 行为一\n  Test: manual:true\n");
fs.writeFileSync(path.join(wt, "regression-contract.yaml"), "version: \"1.0.0\"\ncore: []\ngolden_paths: []\n");

// execFile mock：git/gh 全 no-op（ls-files 成功 = 视为已跟踪）
const execFileMock = async () => ({ stdout: "https://example.com/pr/1", stderr: "" });

const r1 = await promoteToRegression(
  { pool, execFile: execFileMock },
  { task: { id: taskId, payload: {} }, sprintDir, subTasks: [], worktreePath: wt },
);
if (!r1.dbWritten) { console.error("FAIL: dbWritten=false", r1); process.exit(1); }

const c1 = await pool.query("SELECT count(*)::int AS n FROM golden_path WHERE owner_task_id=$1", [taskId]);
if (c1.rows[0].n !== 2) { console.error("FAIL: golden_path 行数=" + c1.rows[0].n + " 期望 2"); process.exit(1); }
console.log("✓ golden_path 表覆盖写 2 行");

// 幂等：再跑一次不翻倍
const r2 = await promoteToRegression(
  { pool, execFile: execFileMock },
  { task: { id: taskId, payload: {} }, sprintDir, subTasks: [], worktreePath: wt },
);
const c2 = await pool.query("SELECT count(*)::int AS n FROM golden_path WHERE owner_task_id=$1", [taskId]);
if (c2.rows[0].n !== 2) { console.error("FAIL: 二次跑后行数=" + c2.rows[0].n + " 期望 2（覆盖非叠加）"); process.exit(1); }
console.log("✓ 幂等：二次 PASS 覆盖不叠加");

// yaml 冻结形态（本地文件层断言）
const yaml = fs.readFileSync(path.join(wt, "regression-contract.yaml"), "utf8");
if (!yaml.includes("GP-" + String(taskId).slice(0,8) + "-001") || !yaml.includes("test_command")) {
  console.error("FAIL: yaml 冻结条目缺失"); process.exit(1);
}
console.log("✓ regression-contract.yaml 冻结条目含 id + test_command");

// 清理
await pool.query("DELETE FROM golden_path WHERE owner_task_id=$1", [taskId]);
await pool.query("DELETE FROM tasks WHERE id=$1", [taskId]);
fs.rmSync(wt, { recursive: true, force: true });
await pool.end();
console.log("✅ harness-promote-regression-smoke 全链路通过");
'
```

- [ ] **Step 2: Run it locally against real DB**

Run: `cd /Users/administrator/worktrees/cecelia/a3-promote-regression && DATABASE_URL="postgresql://postgres@localhost/cecelia" bash packages/brain/scripts/smoke/harness-promote-regression-smoke.sh`
Expected: all ✓ lines + final ✅. (It cleans its own fixtures.)

- [ ] **Step 3: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/a3-promote-regression && chmod +x packages/brain/scripts/smoke/harness-promote-regression-smoke.sh && git add packages/brain/scripts/smoke/harness-promote-regression-smoke.sh && git commit -m "test(smoke): real-env smoke for A3 promote-regression (DB freeze + idempotency)"
```

---

### Task 5: Full test pass + DevGate (controller runs this, not a subagent)

- [ ] `cd packages/brain && npx vitest run src/__tests__/harness-promote-regression.test.js src/__tests__/harness-promote-wiring.test.js src/__tests__/harness-reporter-payload.test.js src/workflows/` — all green
- [ ] `node scripts/facts-check.mjs && bash scripts/check-version-sync.sh` — green
- [ ] push (run_in_background) → PR → engine-pr-watchdog → merged
- [ ] HANDOFF 第 5 节更新（A3 已落地，附 PR；注明 schema 对齐修正 + auto-PR 通道），独立 docs 分支
