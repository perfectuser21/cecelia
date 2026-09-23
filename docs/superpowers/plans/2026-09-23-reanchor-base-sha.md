# 派发时重锚定 base_sha（接班收据）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让派发 preflight 在任务分支尚无任何产出时，自动把路由收据的 base_sha 快进到地图当前 revision（插接班收据），有产出的任务标 `needs_rebase`，阻塞原因带结构化 `reason_code`，并提供一次性脚本恢复存量停车任务。

**Architecture:** 收据表 append-only（迁移 413 触发器），所以快进 = 在 `createKernelRun` 事务内、地图 authority 锁后，由 `ensureNormalMapImpactPreflight` 检测到 `map_revision_mismatch` 时调用新模块 `base-sha-reanchor.js`：查 `initiative_runs` 证明"无产出" → INSERT 接班收据（`supersedes_receipt_id`、`anchor_generation+1`）→ 同事务 UPDATE `tasks.payload{routing_receipt_id, base_sha}` → 事件留痕 → 用新收据继续预检。dispatcher/executor 把失败原因结构化为 `reason_code`；`needs_rebase` 直接 block 不计数。

**Tech Stack:** Node ESM（packages/brain）、PostgreSQL（迁移 SQL + rollback）、vitest（mock client 按 SQL 正则路由）。

**工作树：** `/Users/administrator/worktrees/cecelia/0923-reanchor-base-sha`，分支 `cp-0923171741-0923-reanchor-base-sha`（已快进 origin/main 745222e）。所有命令在 `packages/brain` 下执行；测试命令 `npx vitest run <file>`。**每个 Task 两次提交：commit-1 只含失败测试，commit-2 含实现。** commit message 用 Conventional Commits，末尾加 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。

**规则：** `blockTask(taskId, {reason, detail})` 的 `detail` 传对象时原样存 jsonb（传字符串会被包成 `{message}`）；`recordTaskEventSafe(clientOrPool, taskId, eventType, payload)` 接受任何带 `.query` 的对象；DevGate 三件套在仓库根目录跑：`node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs`。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `packages/brain/migrations/465_work_routing_receipt_supersession.sql` | 新建 | 加 `anchor_generation`；唯一键改四列；`supersedes_receipt_id` 唯一 |
| `packages/brain/migrations/rollback/465_work_routing_receipt_supersession.down.sql` | 新建 | 回滚 |
| `packages/brain/src/__tests__/migration-465-receipt-supersession.test.js` | 新建 | up/down SQL 正则测试 |
| `packages/brain/src/lib/dispatch-reason-code.js` | 新建 | `classifyDispatchReasonCode()`：失败对象 → 结构化 reason_code |
| `packages/brain/src/lib/__tests__/dispatch-reason-code.test.js` | 新建 | 单元测试 |
| `packages/brain/src/orchestrator/preflight/base-sha-reanchor.js` | 新建 | `reanchorReceiptIfEmptyBranch()` 判定 + 接班收据 + 留痕 |
| `packages/brain/src/orchestrator/preflight/base-sha-reanchor.test.js` | 新建 | 条件矩阵单元测试 |
| `packages/brain/src/orchestrator/preflight/map-impact-contract.js` | 修改 236-262 | mismatch 时调用 reanchor，用新收据继续 |
| `packages/brain/src/orchestrator/preflight/map-impact-contract.test.js` | 修改 | 新 describe：快进后预检成功；无法快进时仍 mismatch |
| `packages/brain/src/orchestrator/kernel-run-store.js` | 修改 561 | 预检上下文传 `createdSource` |
| `packages/brain/src/orchestrator/__tests__/kernel-run-store.test.js` | 修改 | 断言上下文含 createdSource |
| `packages/brain/src/work-routing-store.js` | 修改 184-197, 273-274 | 回读取最新收据；sameRoute 忽略 base_sha 系字段 |
| `packages/brain/src/__tests__/work-routing-store-reanchor.test.js` | 新建 | 源码文本断言（排序 + 忽略字段） |
| `packages/brain/src/executor.js` | 修改 3565-3572, 3625-3631 | 返回体带 `reason_code`/`detail`；needs_rebase 专用 reason |
| `packages/brain/src/dispatcher.js` | 修改 1204-1208, 1224, 1252-1259 | needs_rebase 直接 block；autoblock/failed_dispatch 带 reason_code |
| `packages/brain/src/__tests__/dispatch-fail-autoblock.test.js` | 修改 | 新 describe：reason_code 与 needs_rebase |
| `packages/brain/scripts/reanchor-blocked-tasks.mjs` | 新建 | 一次性回填脚本（`--dry-run`） |
| `packages/brain/src/__tests__/reanchor-blocked-tasks-script.test.js` | 新建 | 脚本源码断言 |

---

### Task 1: 迁移 465 —— 收据链式接班

**Files:**
- Create: `packages/brain/migrations/465_work_routing_receipt_supersession.sql`
- Create: `packages/brain/migrations/rollback/465_work_routing_receipt_supersession.down.sql`
- Test: `packages/brain/src/__tests__/migration-465-receipt-supersession.test.js`

- [ ] **Step 1: 写失败测试**

```js
// packages/brain/src/__tests__/migration-465-receipt-supersession.test.js
import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const upUrl = new URL('../../migrations/465_work_routing_receipt_supersession.sql', import.meta.url);
const downUrl = new URL('../../migrations/rollback/465_work_routing_receipt_supersession.down.sql', import.meta.url);

describe('migration 465 — work_routing_receipts 链式接班（anchor_generation）', () => {
  it('up/down 文件存在', () => {
    expect(existsSync(upUrl)).toBe(true);
    expect(existsSync(downUrl)).toBe(true);
  });

  it('加 anchor_generation 列，默认 1 且非空', () => {
    const upSql = readFileSync(upUrl, 'utf8');
    expect(upSql).toMatch(/ADD COLUMN IF NOT EXISTS anchor_generation integer NOT NULL DEFAULT 1/i);
  });

  it('按定义（不按名字）删旧三列唯一键，新建四列唯一键与 supersedes 唯一', () => {
    const upSql = readFileSync(upUrl, 'utf8');
    expect(upSql).toMatch(/pg_get_constraintdef\(oid\) = 'UNIQUE \(source, source_id, router_version\)'/);
    expect(upSql).toMatch(/work_routing_receipts_route_generation_unique UNIQUE \(source, source_id, router_version, anchor_generation\)/);
    expect(upSql).toMatch(/work_routing_receipts_supersedes_unique UNIQUE \(supersedes_receipt_id\)/);
    expect(upSql).toMatch(/INSERT INTO schema_version[\s\S]*'465'/);
  });

  it('down 还原三列唯一键并删列', () => {
    const downSql = readFileSync(downUrl, 'utf8');
    expect(downSql).toMatch(/DROP CONSTRAINT IF EXISTS work_routing_receipts_route_generation_unique/);
    expect(downSql).toMatch(/DROP CONSTRAINT IF EXISTS work_routing_receipts_supersedes_unique/);
    expect(downSql).toMatch(/DROP COLUMN IF EXISTS anchor_generation/);
    expect(downSql).toMatch(/UNIQUE \(source, source_id, router_version\)/);
    expect(downSql).toMatch(/DELETE FROM schema_version WHERE version = '465'/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/migration-465-receipt-supersession.test.js`
Expected: FAIL（up/down 文件不存在）

- [ ] **Step 3: 提交失败测试**

```bash
git add packages/brain/src/__tests__/migration-465-receipt-supersession.test.js
git commit -m "test(brain): 迁移 465 收据链式接班 failing test"
```

- [ ] **Step 4: 写迁移 up**

```sql
-- packages/brain/migrations/465_work_routing_receipt_supersession.sql
-- Migration 465: work_routing_receipts 链式接班（派发时重锚定 base_sha）。
-- 413 的 append-only 触发器保留；同一路由键允许多代收据，用 anchor_generation 区分。
-- 任务 d9c405e2 / 决策 49035988。
BEGIN;

ALTER TABLE work_routing_receipts
  ADD COLUMN IF NOT EXISTS anchor_generation integer NOT NULL DEFAULT 1;

-- 旧三列唯一键在 413 里未命名，按定义查找后删除，不依赖默认名。
DO $$
DECLARE
  legacy_name text;
BEGIN
  SELECT conname INTO legacy_name
    FROM pg_constraint
   WHERE conrelid = 'work_routing_receipts'::regclass
     AND contype = 'u'
     AND pg_get_constraintdef(oid) = 'UNIQUE (source, source_id, router_version)';
  IF legacy_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE work_routing_receipts DROP CONSTRAINT %I', legacy_name);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'work_routing_receipts'::regclass
       AND conname = 'work_routing_receipts_route_generation_unique'
  ) THEN
    ALTER TABLE work_routing_receipts
      ADD CONSTRAINT work_routing_receipts_route_generation_unique UNIQUE (source, source_id, router_version, anchor_generation);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'work_routing_receipts'::regclass
       AND conname = 'work_routing_receipts_supersedes_unique'
  ) THEN
    ALTER TABLE work_routing_receipts
      ADD CONSTRAINT work_routing_receipts_supersedes_unique UNIQUE (supersedes_receipt_id);
  END IF;
END
$$;

INSERT INTO schema_version (version, description, applied_at)
VALUES ('465', 'work_routing_receipts chained supersession via anchor_generation', NOW())
ON CONFLICT (version) DO NOTHING;

COMMIT;
```

- [ ] **Step 5: 写迁移 down**

```sql
-- packages/brain/migrations/rollback/465_work_routing_receipt_supersession.down.sql
-- 回滚前提：不存在 anchor_generation > 1 的接班收据（否则三列唯一键重建会失败，需先人工清理）。
BEGIN;
ALTER TABLE work_routing_receipts DROP CONSTRAINT IF EXISTS work_routing_receipts_route_generation_unique;
ALTER TABLE work_routing_receipts DROP CONSTRAINT IF EXISTS work_routing_receipts_supersedes_unique;
ALTER TABLE work_routing_receipts DROP COLUMN IF EXISTS anchor_generation;
ALTER TABLE work_routing_receipts
  ADD CONSTRAINT work_routing_receipts_source_source_id_router_version_key UNIQUE (source, source_id, router_version);
DELETE FROM schema_version WHERE version = '465';
COMMIT;
```

- [ ] **Step 6: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/migration-465-receipt-supersession.test.js`
Expected: PASS（4 tests）

- [ ] **Step 7: 提交实现**

```bash
git add packages/brain/migrations/465_work_routing_receipt_supersession.sql packages/brain/migrations/rollback/465_work_routing_receipt_supersession.down.sql
git commit -m "feat(brain): 迁移 465 收据链式接班——anchor_generation 入唯一键，supersedes 唯一"
```

---

### Task 2: `classifyDispatchReasonCode()`

**Files:**
- Create: `packages/brain/src/lib/dispatch-reason-code.js`
- Test: `packages/brain/src/lib/__tests__/dispatch-reason-code.test.js`

- [ ] **Step 1: 写失败测试**

```js
// packages/brain/src/lib/__tests__/dispatch-reason-code.test.js
import { describe, expect, it } from 'vitest';
import { classifyDispatchReasonCode } from '../dispatch-reason-code.js';

describe('classifyDispatchReasonCode', () => {
  it('优先取显式 reason_code', () => {
    expect(classifyDispatchReasonCode({ reason_code: 'needs_rebase', error: 'x' })).toBe('needs_rebase');
  });
  it('从 error 文本识别 map_* / impact_* / credential_* 前缀', () => {
    expect(classifyDispatchReasonCode({ error: 'map_revision_mismatch' })).toBe('map_revision_mismatch');
    expect(classifyDispatchReasonCode({ error: 'impact_assertion_missing' })).toBe('impact_assertion_missing');
    expect(classifyDispatchReasonCode({ error: 'kernel_process_fatal:credential_payload_invalid' })).toBe('credential_payload_invalid');
  });
  it('识别 needs_rebase / map_thrash 单词', () => {
    expect(classifyDispatchReasonCode({ reason: 'needs_rebase' })).toBe('needs_rebase');
    expect(classifyDispatchReasonCode({ error: 'map_thrash' })).toBe('map_thrash');
  });
  it('未知归 executor_failed', () => {
    expect(classifyDispatchReasonCode({ error: 'payload missing callback_url' })).toBe('executor_failed');
    expect(classifyDispatchReasonCode()).toBe('executor_failed');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/lib/__tests__/dispatch-reason-code.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 提交失败测试**

```bash
git add packages/brain/src/lib/__tests__/dispatch-reason-code.test.js
git commit -m "test(brain): classifyDispatchReasonCode failing test"
```

- [ ] **Step 4: 实现**

```js
// packages/brain/src/lib/dispatch-reason-code.js
// 派发失败原因结构化：dispatcher autoblock detail / task_events / executor 返回体共用。
const KNOWN_PREFIX = /(map_[a-z_]+|impact_[a-z_]+|credential_[a-z_]+|needs_rebase|map_thrash)/;

export function classifyDispatchReasonCode(execResult = {}) {
  const explicit = execResult?.reason_code;
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;
  const text = String(execResult?.error || execResult?.reason || '');
  const matched = text.match(KNOWN_PREFIX);
  return matched ? matched[1] : 'executor_failed';
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/lib/__tests__/dispatch-reason-code.test.js`
Expected: PASS（4 tests）

- [ ] **Step 6: 提交实现**

```bash
git add packages/brain/src/lib/dispatch-reason-code.js
git commit -m "feat(brain): 派发失败原因结构化 classifyDispatchReasonCode"
```

---

### Task 3: `reanchorReceiptIfEmptyBranch()` 模块

**Files:**
- Create: `packages/brain/src/orchestrator/preflight/base-sha-reanchor.js`
- Test: `packages/brain/src/orchestrator/preflight/base-sha-reanchor.test.js`

- [ ] **Step 1: 写失败测试**

```js
// packages/brain/src/orchestrator/preflight/base-sha-reanchor.test.js
import { describe, expect, it, vi } from 'vitest';
import { reanchorReceiptIfEmptyBranch, MAX_FASTFORWARD } from './base-sha-reanchor.js';

const OLD = 'a'.repeat(40);
const NEW = 'b'.repeat(40);
const TASK_ID = '11111111-1111-4111-8111-111111111111';
const RECEIPT_ID = '22222222-2222-4222-8222-222222222222';
const NEXT_ID = '33333333-3333-4333-8333-333333333333';

function baseReceipt(overrides = {}) {
  return {
    id: RECEIPT_ID, task_id: TASK_ID, source: 'api', source_id: 'route-1',
    work_kind: 'coding_mutation', change_kind: 'bugfix', pipeline: 'harness',
    canonical_task_type: 'harness_initiative', default_execution_profile: 'hotfix-v1',
    execution_profile_override: null, repo: 'cecelia', map_scope: ['F1'],
    impact_contract_required: true, orchestrator: 'skill-relay', router_version: 'v2',
    route_reason: 'coding', evidence: { branch: 'cp-route-api-1', base_sha: OLD },
    map_scope_validation_version: 'active-business-node-v1', direct_contract_seed: null,
    anchor_generation: 1, has_v2_run: false, superseded: false,
    ...overrides,
  };
}
function freshMap(revision = NEW) {
  return {
    projection_run_id: '44444444-4444-4444-8444-444444444444',
    freshness: { status: 'fresh', repos: { cecelia: { status: 'fresh', source_revision: revision } } },
  };
}
function mockClient({ hasAnyRun = false } = {}) {
  const calls = [];
  const client = {
    query: vi.fn(async (sql, params) => {
      calls.push({ sql, params });
      if (/AS has_any_run/.test(sql)) return { rows: [{ has_any_run: hasAnyRun }] };
      if (/INSERT INTO work_routing_receipts/.test(sql)) {
        return { rows: [{ ...baseReceipt(), id: NEXT_ID, anchor_generation: params[19], supersedes_receipt_id: params[18], evidence: JSON.parse(params[15]) }] };
      }
      if (/UPDATE tasks/.test(sql)) return { rows: [], rowCount: 1 };
      if (/INSERT INTO cecelia_events/.test(sql)) return { rows: [], rowCount: 1 };
      if (/INSERT INTO task_events/.test(sql)) return { rows: [], rowCount: 1 };
      throw new Error(`unexpected SQL: ${sql}`);
    }),
  };
  return { client, calls };
}
const task = { id: TASK_ID, payload: {}, metadata: {} };

describe('reanchorReceiptIfEmptyBranch', () => {
  it('无产出 + 地图前进 → 插接班收据、同步 payload、留痕，返回新收据', async () => {
    const { client, calls } = mockClient();
    const result = await reanchorReceiptIfEmptyBranch(client, { task, receipt: baseReceipt(), map: freshMap(), now: new Date('2026-09-23T09:00:00Z') });
    expect(result.id).toBe(NEXT_ID);
    expect(result.anchor_generation).toBe(2);
    expect(result.evidence).toMatchObject({ base_sha: NEW, prev_base_sha: OLD, reanchor_reason: 'map_revision_advanced' });
    expect(result.has_v2_run).toBe(false);
    const insert = calls.find((c) => /INSERT INTO work_routing_receipts/.test(c.sql));
    expect(insert.params[18]).toBe(RECEIPT_ID); // supersedes_receipt_id
    expect(insert.params[19]).toBe(2);           // anchor_generation
    const update = calls.find((c) => /UPDATE tasks/.test(c.sql));
    expect(JSON.parse(update.params[1])).toMatchObject({ routing_receipt_id: NEXT_ID, base_sha: NEW });
    expect(JSON.parse(update.params[2])).toMatchObject({ base_sha_fastforward_count: 1 });
    // 顺序：先 INSERT 收据，后 UPDATE tasks（421 触发器按最新收据比对）
    expect(calls.findIndex((c) => /INSERT INTO work_routing_receipts/.test(c.sql)))
      .toBeLessThan(calls.findIndex((c) => /UPDATE tasks/.test(c.sql)));
    expect(calls.some((c) => /INSERT INTO cecelia_events/.test(c.sql) && /work_route_reanchored/.test(c.params[0]))).toBe(true);
    expect(calls.some((c) => /INSERT INTO task_events/.test(c.sql) && c.params[1] === 'base_sha_reanchored')).toBe(true);
  });

  it('地图 revision 与 base_sha 相同 → 返回 null 且不写库', async () => {
    const { client, calls } = mockClient();
    expect(await reanchorReceiptIfEmptyBranch(client, { task, receipt: baseReceipt(), map: freshMap(OLD) })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('地图非 fresh → 返回 null', async () => {
    const { client } = mockClient();
    const map = { freshness: { status: 'unknown', repos: { cecelia: { status: 'unknown', source_revision: null } } } };
    expect(await reanchorReceiptIfEmptyBranch(client, { task, receipt: baseReceipt(), map })).toBeNull();
  });

  it('map_recovery=true / explicit_recovery / 非 coding_mutation → 返回 null', async () => {
    const { client } = mockClient();
    expect(await reanchorReceiptIfEmptyBranch(client, { task: { ...task, payload: { map_recovery: true } }, receipt: baseReceipt(), map: freshMap() })).toBeNull();
    expect(await reanchorReceiptIfEmptyBranch(client, { task, receipt: baseReceipt(), map: freshMap(), createdSource: 'explicit_recovery' })).toBeNull();
    expect(await reanchorReceiptIfEmptyBranch(client, { task, receipt: baseReceipt({ work_kind: 'coding_review' }), map: freshMap() })).toBeNull();
  });

  it('已有 initiative_runs → 抛 needs_rebase 且不 INSERT', async () => {
    const { client, calls } = mockClient({ hasAnyRun: true });
    await expect(reanchorReceiptIfEmptyBranch(client, { task, receipt: baseReceipt(), map: freshMap() }))
      .rejects.toMatchObject({ code: 'needs_rebase', detail: { old_base_sha: OLD, new_base_sha: NEW, branch: 'cp-route-api-1' } });
    expect(calls.some((c) => /INSERT INTO work_routing_receipts/.test(c.sql))).toBe(false);
  });

  it('receipt.has_v2_run=true → 抛 needs_rebase（不查库）', async () => {
    const { client, calls } = mockClient();
    await expect(reanchorReceiptIfEmptyBranch(client, { task, receipt: baseReceipt({ has_v2_run: true }), map: freshMap() }))
      .rejects.toMatchObject({ code: 'needs_rebase' });
    expect(calls).toHaveLength(0);
  });

  it(`快进次数 ≥ ${MAX_FASTFORWARD} → 抛 map_thrash`, async () => {
    const { client } = mockClient();
    const thrashTask = { ...task, metadata: { base_sha_fastforward_count: MAX_FASTFORWARD } };
    await expect(reanchorReceiptIfEmptyBranch(client, { task: thrashTask, receipt: baseReceipt(), map: freshMap() }))
      .rejects.toMatchObject({ code: 'map_thrash', detail: { fastforward_count: MAX_FASTFORWARD } });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/orchestrator/preflight/base-sha-reanchor.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 提交失败测试**

```bash
git add packages/brain/src/orchestrator/preflight/base-sha-reanchor.test.js
git commit -m "test(brain): base_sha 重锚定条件矩阵 failing test"
```

- [ ] **Step 4: 实现模块**

```js
// packages/brain/src/orchestrator/preflight/base-sha-reanchor.js
// 派发时重锚定 base_sha（任务 d9c405e2 / 决策 49035988）。
// 路由收据 append-only（迁移 413），快进 = 插接班收据（supersedes_receipt_id + anchor_generation），
// 同事务同步 tasks.payload（421 触发器按最新收据比对 routing_receipt_id，必须先 INSERT 后 UPDATE）。
// 只在"分支尚无任何产出"时快进：kernel-v1 generator 不 push，候选留在跑场机本地，
// git 看不到，所以用 DB 事实 initiative_runs（harness_attempts.run_id 是其 NOT NULL FK）判定。
import { recordTaskEventSafe } from '../../lib/task-event-log.js';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
export const MAX_FASTFORWARD = 5;

function reanchorError(code, detail = {}) {
  const error = new Error(code);
  error.code = code;
  error.detail = detail;
  return error;
}

export async function reanchorReceiptIfEmptyBranch(client, {
  task, receipt, map, now = new Date(), createdSource = null,
}) {
  const oldBaseSha = receipt?.evidence?.base_sha;
  const repoFreshness = map?.freshness?.repos?.[receipt?.repo];
  const targetSha = repoFreshness?.source_revision;
  if (!SHA_PATTERN.test(oldBaseSha ?? '') || repoFreshness?.status !== 'fresh' || !SHA_PATTERN.test(targetSha ?? '')) {
    return null;
  }
  if (targetSha === oldBaseSha) return null;
  if (receipt.work_kind !== 'coding_mutation') return null;
  if (task?.payload?.map_recovery === true) return null;
  if (createdSource === 'explicit_recovery') return null;

  const fastforwardCount = Number(task?.metadata?.base_sha_fastforward_count ?? 0);
  if (fastforwardCount >= MAX_FASTFORWARD) {
    throw reanchorError('map_thrash', {
      fastforward_count: fastforwardCount, old_base_sha: oldBaseSha, map_revision: targetSha,
    });
  }
  const rebaseDetail = {
    old_base_sha: oldBaseSha, new_base_sha: targetSha,
    branch: receipt.evidence?.branch ?? null, has_v2_run: receipt.has_v2_run === true,
  };
  if (receipt.has_v2_run === true) throw reanchorError('needs_rebase', rebaseDetail);
  const { rows: runRows } = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM initiative_runs any_run
        WHERE any_run.current_task_id = $1::uuid
           OR any_run.initiative_id = $1::uuid
     ) AS has_any_run`,
    [task.id],
  );
  if (runRows[0]?.has_any_run === true) throw reanchorError('needs_rebase', rebaseDetail);

  const nextGeneration = Number(receipt.anchor_generation ?? 1) + 1;
  const evidence = {
    ...(receipt.evidence ?? {}),
    base_sha: targetSha,
    prev_base_sha: oldBaseSha,
    resigned_at: now.toISOString(),
    reanchor_reason: 'map_revision_advanced',
  };
  const { rows: inserted } = await client.query(
    `INSERT INTO work_routing_receipts (
       task_id,source,source_id,work_kind,change_kind,pipeline,canonical_task_type,
       default_execution_profile,execution_profile_override,repo,map_scope,
       impact_contract_required,orchestrator,router_version,route_reason,evidence,
       map_scope_validation_version,direct_contract_seed,supersedes_receipt_id,anchor_generation,created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16::jsonb,$17,$18::jsonb,$19,$20,now())
     RETURNING *`,
    [
      receipt.task_id, receipt.source, receipt.source_id, receipt.work_kind, receipt.change_kind,
      receipt.pipeline, receipt.canonical_task_type, receipt.default_execution_profile,
      receipt.execution_profile_override ?? null, receipt.repo, JSON.stringify(receipt.map_scope ?? []),
      receipt.impact_contract_required, receipt.orchestrator, receipt.router_version, receipt.route_reason,
      JSON.stringify(evidence), receipt.map_scope_validation_version ?? null,
      receipt.direct_contract_seed == null ? null : JSON.stringify(receipt.direct_contract_seed),
      receipt.id, nextGeneration,
    ],
  );
  const successor = inserted[0];
  await client.query(
    `UPDATE tasks
        SET payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb,
            metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
            updated_at = NOW()
      WHERE id = $1`,
    [
      task.id,
      JSON.stringify({ routing_receipt_id: successor.id, base_sha: targetSha }),
      JSON.stringify({ base_sha_fastforward_count: fastforwardCount + 1 }),
    ],
  );
  const eventPayload = {
    task_id: task.id,
    old_receipt_id: receipt.id,
    new_receipt_id: successor.id,
    old_base_sha: oldBaseSha,
    new_base_sha: targetSha,
    anchor_generation: nextGeneration,
    map_projection_run_id: map.projection_run_id ?? null,
  };
  await client.query(
    `INSERT INTO cecelia_events (event_type,source,payload) VALUES ($1,'work-router',$2::jsonb)`,
    ['work_route_reanchored', JSON.stringify(eventPayload)],
  );
  await recordTaskEventSafe(client, task.id, 'base_sha_reanchored', eventPayload);
  return {
    ...successor,
    evidence: typeof successor.evidence === 'string' ? JSON.parse(successor.evidence) : successor.evidence,
    anchor_generation: nextGeneration,
    has_v2_run: false,
    superseded: false,
  };
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/orchestrator/preflight/base-sha-reanchor.test.js`
Expected: PASS（7 tests）

- [ ] **Step 6: 提交实现**

```bash
git add packages/brain/src/orchestrator/preflight/base-sha-reanchor.js
git commit -m "feat(brain): 派发时重锚定 base_sha——接班收据 + needs_rebase/map_thrash 判定"
```

---

### Task 4: 预检接线——mismatch 时快进并用新收据继续

**Files:**
- Modify: `packages/brain/src/orchestrator/preflight/map-impact-contract.js:236-262`（及后文 `receipt.` → `activeReceipt.`）
- Modify: `packages/brain/src/orchestrator/preflight/map-impact-contract.test.js`

- [ ] **Step 1: 写失败测试（追加到 map-impact-contract.test.js 末尾）**

```js
describe('派发时重锚定 base_sha（任务 d9c405e2）', () => {
  const OLD = 'a'.repeat(40);
  const NEW = 'b'.repeat(40);
  const authority = {
    manifest_version_id: '11111111-1111-4111-8111-111111111111',
    manifest_digest: 'b'.repeat(64),
    projection_run_id: '22222222-2222-4222-8222-222222222222',
    projection_digest: 'c'.repeat(64),
    fact_revisions: { cecelia: NEW },
  };
  const freshMap = {
    ...authority,
    freshness: { status: 'fresh', repos: { cecelia: { status: 'fresh', source_revision: NEW, reason_code: null } } },
  };
  const radius = {
    ...authority,
    freshness: { status: 'fresh', repos: { cecelia: { status: 'fresh', source_revision: NEW } } },
    affected_business_nodes: [{ node_type: 'capability', node_key: 'F1', name: '开发闭环' }],
    must_run_assertions: [{ assertion_ref: 'assert-1', journey_step_link_id: '55555555-5555-4555-8555-555555555555', assertion_revision: 1 }],
  };
  const receipt = {
    id: '66666666-6666-4666-8666-666666666666', repo: 'cecelia', change_kind: 'bugfix',
    work_kind: 'coding_mutation', map_scope: ['F1'], has_v2_run: false,
    evidence: { base_sha: OLD, branch: 'cp-route-api-1' }, anchor_generation: 1,
  };
  const successor = { ...receipt, id: '77777777-7777-4777-8777-777777777777', anchor_generation: 2, evidence: { base_sha: NEW, branch: 'cp-route-api-1', prev_base_sha: OLD } };

  function deps(reanchorReceipt) {
    return {
      resolveScopeKey: vi.fn(async () => 'cecelia'),
      lockMapProjectionAuthority: vi.fn(async () => authority),
      readMap: vi.fn(async () => freshMap),
      readRadius: vi.fn(async () => radius),
      persistContract: vi.fn(async (_c, input) => ({ contract: { id: 'impact-1', status: 'active' }, input })),
      reanchorReceipt,
    };
  }

  it('地图 revision 前进且分支无产出 → 快进后用新收据继续，合同 base_revision 为新 sha', async () => {
    const reanchorReceipt = vi.fn(async () => successor);
    const d = deps(reanchorReceipt);
    const result = await ensureMapImpactPreflight({ query: vi.fn() }, {
      task: { id: '88888888-8888-4888-8888-888888888888', payload: {}, metadata: {} },
      receipt,
      createdSource: 'kernel_dispatch',
    }, d);
    expect(reanchorReceipt).toHaveBeenCalledOnce();
    expect(reanchorReceipt.mock.calls[0][1]).toMatchObject({ receipt, createdSource: 'kernel_dispatch' });
    expect(d.persistContract.mock.calls[0][1]).toMatchObject({ base_revision: NEW });
    expect(d.persistContract.mock.calls[0][1].contract_body.freshness_evidence.mapper_revision).toBe(NEW);
    expect(result.receipt).toMatchObject({ id: successor.id, anchor_generation: 2 });
    expect(result.contract).toMatchObject({ status: 'active' });
  });

  it('无法快进（reanchor 返回 null）→ 仍抛 map_revision_mismatch 且不持久化合同', async () => {
    const d = deps(vi.fn(async () => null));
    await expect(ensureMapImpactPreflight({ query: vi.fn() }, {
      task: { id: '88888888-8888-4888-8888-888888888888', payload: {} }, receipt,
    }, d)).rejects.toThrow('map_revision_mismatch');
    expect(d.persistContract).not.toHaveBeenCalled();
  });

  it('reanchor 抛 needs_rebase → 原样上抛（不进 recovery 通道）', async () => {
    const err = Object.assign(new Error('needs_rebase'), { code: 'needs_rebase', detail: { old_base_sha: OLD } });
    const d = deps(vi.fn(async () => { throw err; }));
    await expect(ensureMapImpactPreflight({ query: vi.fn() }, {
      task: { id: '88888888-8888-4888-8888-888888888888', payload: { map_recovery: true } }, receipt,
    }, d)).rejects.toMatchObject({ code: 'needs_rebase' });
  });

  it('revision 一致时不调用 reanchor', async () => {
    const reanchorReceipt = vi.fn();
    const d = deps(reanchorReceipt);
    await ensureMapImpactPreflight({ query: vi.fn() }, {
      task: { id: '88888888-8888-4888-8888-888888888888', payload: {} },
      receipt: { ...receipt, evidence: { base_sha: NEW, branch: 'cp-route-api-1' } },
    }, d);
    expect(reanchorReceipt).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/orchestrator/preflight/map-impact-contract.test.js`
Expected: 新 describe 至少前三条 FAIL（现状抛 map_revision_mismatch / 不含 receipt 返回）；原有 6 条 PASS

- [ ] **Step 3: 提交失败测试**

```bash
git add packages/brain/src/orchestrator/preflight/map-impact-contract.test.js
git commit -m "test(brain): 预检 mismatch 时快进 failing test"
```

- [ ] **Step 4: 修改 ensureNormalMapImpactPreflight**

在文件顶部 import 增加：
```js
import { reanchorReceiptIfEmptyBranch } from './base-sha-reanchor.js';
```

把 236-259 行改为：
```js
async function ensureNormalMapImpactPreflight(client, { task, receipt, createdSource = null }, deps = {}) {
  if (!task?.id || !receipt || receipt.work_kind === 'coding_review') {
    throw new Error('routing_receipt_missing');
  }
  let activeReceipt = receipt;
  let baseSha = activeReceipt.evidence?.base_sha;
  if (!activeReceipt.repo || !SHA_PATTERN.test(baseSha ?? '')) throw new Error('map_context_missing');
  if (!Array.isArray(activeReceipt.map_scope) || activeReceipt.map_scope.length === 0) {
    throw new Error('map_scope_missing');
  }
  const scopeKey = deps.resolveScopeKey
    ? await deps.resolveScopeKey(client, activeReceipt.repo)
    : await resolveScopeKey(client, activeReceipt.repo);
  const loadMap = deps.readMap ?? readMap;
  const loadRadius = deps.readRadius ?? readRadius;
  const lockAuthority = deps.lockMapProjectionAuthority ?? lockMapProjectionAuthority;
  const persistContract = deps.persistContract ?? persistImpactContract;
  const reanchor = deps.reanchorReceipt ?? reanchorReceiptIfEmptyBranch;
  const now = deps.now ?? new Date();
  const authority = await lockAuthority(client, { scopeKey });
  const map = await loadMap(client, { scopeKey, now, authority });
  const repoFreshness = map?.freshness?.repos?.[activeReceipt.repo];
  if (map?.freshness?.status !== 'fresh' || repoFreshness?.status !== 'fresh') {
    throw new Error('map_stale');
  }
  if (repoFreshness.source_revision !== baseSha) {
    // 派发时重锚定（任务 d9c405e2）：分支无产出则插接班收据把锚快进到地图 revision；
    // 有产出 → reanchor 抛 needs_rebase；不适用（map_recovery/explicit_recovery/非 fresh）→ null。
    const successor = await reanchor(client, {
      task, receipt: activeReceipt, map, now, createdSource,
    });
    if (!successor) throw new Error('map_revision_mismatch');
    activeReceipt = successor;
    baseSha = successor.evidence?.base_sha;
    if (!SHA_PATTERN.test(baseSha ?? '') || repoFreshness.source_revision !== baseSha) {
      throw new Error('map_revision_mismatch');
    }
  }
```

然后把该函数余下部分所有 `receipt.map_scope` / `receipt.change_kind` / `receipt.repo` 改为 `activeReceipt.…`（共 5 处：`startNodeKeys: receipt.map_scope`、contractBody 的 `change_kind: receipt.change_kind`、`repo: receipt.repo`、`metadata: { scope_key: scopeKey, map_scope: receipt.map_scope }`、persistContract 的 `change_kind`/`repo`），并把最后一行改为：
```js
  return { ...persisted, map, radius, scope_key: scopeKey, receipt: activeReceipt };
```

- [ ] **Step 5: 跑测试确认通过（含原有用例）**

Run: `cd packages/brain && npx vitest run src/orchestrator/preflight/map-impact-contract.test.js src/orchestrator/preflight/base-sha-reanchor.test.js`
Expected: PASS（10 + 7）

- [ ] **Step 6: 提交实现**

```bash
git add packages/brain/src/orchestrator/preflight/map-impact-contract.js
git commit -m "feat(brain): 预检 map_revision_mismatch 时先重锚定再校验"
```

---

### Task 5: kernel-run-store 传 createdSource 给预检

**Files:**
- Modify: `packages/brain/src/orchestrator/kernel-run-store.js:561`
- Modify: `packages/brain/src/orchestrator/__tests__/kernel-run-store.test.js`

- [ ] **Step 1: 写失败测试（追加到 kernel-run-store.test.js 的 createKernelRun describe 内）**

```js
  it('把 createdSource 交给 Map/Impact preflight（重锚定需据此跳过 explicit_recovery）', async () => {
    const harness = transactionPool();
    const ensurePreflight = vi.fn(async () => ({ contract: { id: 'impact-1', status: 'active' } }));
    await createKernelRun(harness.pool, VALID_INPUT, { ensureMapImpactPreflight: ensurePreflight });
    expect(ensurePreflight.mock.calls[0][1]).toMatchObject({ createdSource: 'kernel_dispatch' });
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/orchestrator/__tests__/kernel-run-store.test.js -t createdSource`
Expected: FAIL（上下文无 createdSource）

- [ ] **Step 3: 提交失败测试**

```bash
git add packages/brain/src/orchestrator/__tests__/kernel-run-store.test.js
git commit -m "test(brain): createKernelRun 预检上下文含 createdSource failing test"
```

- [ ] **Step 4: 改一行**

`kernel-run-store.js:561`：
```js
    const preflight = await runPreflight(client, { task, receipt, createdSource: effectiveCreatedSource });
```

- [ ] **Step 5: 跑整文件确认通过**

Run: `cd packages/brain && npx vitest run src/orchestrator/__tests__/kernel-run-store.test.js`
Expected: PASS（全部）

- [ ] **Step 6: 提交**

```bash
git add packages/brain/src/orchestrator/kernel-run-store.js
git commit -m "feat(brain): createKernelRun 向预检传 createdSource"
```

---

### Task 6: work-routing-store 回读最新收据、sameRoute 忽略 base_sha 系字段

**Files:**
- Modify: `packages/brain/src/work-routing-store.js:184-197, 273-274`
- Test: `packages/brain/src/__tests__/work-routing-store-reanchor.test.js`

- [ ] **Step 1: 写失败测试（源码文本断言，与本仓库 work-routing-validation-route.integration.test.js 同风格）**

```js
// packages/brain/src/__tests__/work-routing-store-reanchor.test.js
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { stripReanchorEvidence } from '../work-routing-store.js';

describe('work-routing-store × 接班收据', () => {
  it('幂等回读按 created_at DESC, anchor_generation DESC 取最新一代', async () => {
    const source = await readFile(new URL('../work-routing-store.js', import.meta.url), 'utf8');
    expect(source).toMatch(/WHERE r\.source=\$1 AND r\.source_id=\$2 AND r\.router_version=\$3\s+ORDER BY r\.created_at DESC, r\.anchor_generation DESC\s+LIMIT 1/);
  });

  it('sameRoute 比对 evidence 时剔除 base_sha / prev_base_sha / resigned_at / reanchor_reason', () => {
    expect(stripReanchorEvidence({ branch: 'cp-x', base_sha: 'a'.repeat(40), prev_base_sha: 'b'.repeat(40), resigned_at: 't', reanchor_reason: 'map_revision_advanced' }))
      .toEqual({ branch: 'cp-x' });
    expect(stripReanchorEvidence(null)).toEqual({});
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/work-routing-store-reanchor.test.js`
Expected: FAIL（无 stripReanchorEvidence 导出；SQL 无 ORDER BY）

- [ ] **Step 3: 提交失败测试**

```bash
git add packages/brain/src/__tests__/work-routing-store-reanchor.test.js
git commit -m "test(brain): 路由收据回读取最新一代 failing test"
```

- [ ] **Step 4: 实现**

在 `work-routing-store.js` 的 `createRoutedTask` 之前加导出：
```js
// 接班收据只改 base_sha 系字段（任务 d9c405e2）；幂等比对时剔除，避免重入撞 idempotency_conflict。
export function stripReanchorEvidence(evidence) {
  const { base_sha, prev_base_sha, resigned_at, reanchor_reason, ...rest } = evidence ?? {};
  return rest;
}
```
把 existing 查询（184-197 行）的 WHERE 行改为：
```js
        WHERE r.source=$1 AND r.source_id=$2 AND r.router_version=$3
        ORDER BY r.created_at DESC, r.anchor_generation DESC
        LIMIT 1`,
```
把 sameRoute 里的 evidence 比对（273-274 行）改为：
```js
        && JSON.stringify(canonicalJson(stripReanchorEvidence(persisted.evidence)))
          === JSON.stringify(canonicalJson(stripReanchorEvidence(decision.evidence)))
```

- [ ] **Step 5: 跑相关测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/work-routing-store-reanchor.test.js src/__tests__/work-routing`
Expected: PASS（含既有 work-routing* 测试）

- [ ] **Step 6: 提交**

```bash
git add packages/brain/src/work-routing-store.js
git commit -m "feat(brain): 路由收据回读取最新一代，幂等比对忽略重锚定字段"
```

---

### Task 7: executor / dispatcher —— reason_code 与 needs_rebase 停车

**Files:**
- Modify: `packages/brain/src/executor.js:3565-3572, 3625-3631`
- Modify: `packages/brain/src/dispatcher.js:1204-1208, 1224, 1252-1259`
- Modify: `packages/brain/src/__tests__/dispatch-fail-autoblock.test.js`

- [ ] **Step 1: 写失败测试（追加到 dispatch-fail-autoblock.test.js 末尾）**

```js
describe('reason_code 与 needs_rebase（任务 d9c405e2）', () => {
  const task = makeTask({ metadata: {}, task_type: 'harness_initiative' });

  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectNextDispatchableTask.mockReset();
    mockSelectNextDispatchableTask.mockResolvedValueOnce(task);
  });

  it('三振时 blockTask detail 带 reason_code=map_revision_mismatch', async () => {
    mockTriggerCeceliaRun.mockResolvedValue({ success: false, reason: 'kernel_authority_not_created', error: 'map_revision_mismatch' });
    setupQuerySequence(task, 2, true);
    const { dispatchNextTask } = await import('../dispatcher.js');
    await dispatchNextTask(['goal-1']);
    expect(mockBlockTask).toHaveBeenCalledWith(task.id, expect.objectContaining({
      reason: 'dispatch_fail_autoblock',
      detail: expect.objectContaining({ reason_code: 'map_revision_mismatch', consecutive_failures: 3 }),
    }));
  });

  it('needs_rebase：直接 block（reason=needs_rebase）、不累计 dispatch_fail_consecutive、P3 告警', async () => {
    mockTriggerCeceliaRun.mockResolvedValue({
      success: false, reason: 'needs_rebase', reason_code: 'needs_rebase', error: 'needs_rebase',
      detail: { old_base_sha: 'a'.repeat(40), new_base_sha: 'b'.repeat(40), branch: 'cp-route-api-1' },
    });
    setupQuerySequence(task, 0, false);
    const { dispatchNextTask } = await import('../dispatcher.js');
    const result = await dispatchNextTask(['goal-1']);
    expect(result.dispatched).toBe(false);
    expect(mockBlockTask).toHaveBeenCalledWith(task.id, expect.objectContaining({
      reason: 'needs_rebase',
      detail: expect.objectContaining({ reason_code: 'needs_rebase', branch: 'cp-route-api-1' }),
    }));
    const countUpdate = mockQuery.mock.calls.find(([sql]) => /dispatch_fail_consecutive/.test(String(sql)) && /UPDATE tasks/.test(String(sql)));
    expect(countUpdate).toBeUndefined();
    expect(mockRaise).toHaveBeenCalledWith('P3', 'needs_rebase', expect.stringContaining(task.id));
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/dispatch-fail-autoblock.test.js -t "reason_code 与 needs_rebase"`
Expected: 2 FAIL

- [ ] **Step 3: 提交失败测试**

```bash
git add packages/brain/src/__tests__/dispatch-fail-autoblock.test.js
git commit -m "test(brain): autoblock reason_code 与 needs_rebase 停车 failing test"
```

- [ ] **Step 4: 改 executor.js**

顶部 import 增加：
```js
import { classifyDispatchReasonCode } from './lib/dispatch-reason-code.js';
```
3565-3572 行的返回体改为：
```js
        return {
          success: false,
          taskId: task.id,
          initiative: true,
          reason: 'kernel_authority_not_created',
          reason_code: classifyDispatchReasonCode({ error: result?.error, reason: result?.reason }),
          error: String(result?.error || result?.reason || 'kernel_authority_not_created')
            .slice(0, 500),
        };
```
3625-3631 行（catch 里的返回体）改为：
```js
        const reasonCode = typeof err.code === 'string' && err.code
          ? err.code
          : classifyDispatchReasonCode({ error: err.message });
        return {
          success: false,
          taskId: task.id,
          initiative: true,
          reason: reasonCode === 'needs_rebase' ? 'needs_rebase' : 'kernel_authority_not_created',
          reason_code: reasonCode,
          detail: err.detail ?? null,
          error: err.message?.slice(0, 500),
        };
```

- [ ] **Step 5: 改 dispatcher.js**

顶部 import 增加：
```js
import { classifyDispatchReasonCode } from './lib/dispatch-reason-code.js';
```
1204-1208 行的 failed_dispatch 事件 payload 增加一行：
```js
      reason_code: classifyDispatchReasonCode(execResult),
```
1224 行 `if (execResult.configError) {` 之前插入 needs_rebase 分支（成为 if 链第一项）：
```js
    if (execResult.reason === 'needs_rebase') {
      // 分支已有产出但 base_sha 落后地图：不是执行故障，直接停车等 rebase（任务 d9c405e2），不计熔断/autoblock。
      console.warn(`[dispatch] needs_rebase for task ${nextTask.id} — blocking without autoblock count`);
      try {
        await blockTask(nextTask.id, {
          reason: 'needs_rebase',
          detail: {
            reason_code: 'needs_rebase',
            ...(execResult.detail && typeof execResult.detail === 'object' ? execResult.detail : {}),
            blocked_at_tick: new Date().toISOString(),
          },
        });
      } catch (blockErr) {
        console.error(`[dispatch] blockTask(needs_rebase) failed for task ${nextTask.id}: ${blockErr.message}`);
      }
      try {
        await raise('P3', 'needs_rebase', `task ${nextTask.id} 分支已有产出但 base_sha 落后地图，需 rebase 后解锁`);
      } catch (raiseErr) {
        console.error(`[dispatch] raise failed for needs_rebase (task ${nextTask.id}): ${raiseErr.message}`);
      }
    } else if (execResult.configError) {
```
1252-1259 行 autoblock 的 `detail` 增加：
```js
                reason_code: classifyDispatchReasonCode(execResult),
```

- [ ] **Step 6: 跑测试确认通过（整文件 + 相关 dispatcher 测试）**

Run: `cd packages/brain && npx vitest run src/__tests__/dispatch-fail-autoblock.test.js src/__tests__/dispatch-executor-fail.test.js src/__tests__/dispatcher-hol-skip.test.js`
Expected: PASS（全部）

- [ ] **Step 7: 提交**

```bash
git add packages/brain/src/executor.js packages/brain/src/dispatcher.js
git commit -m "feat(brain): 派发失败 reason_code 结构化，needs_rebase 直接停车不计熔断"
```

---

### Task 8: 一次性回填脚本

**Files:**
- Create: `packages/brain/scripts/reanchor-blocked-tasks.mjs`
- Test: `packages/brain/src/__tests__/reanchor-blocked-tasks-script.test.js`

- [ ] **Step 1: 写失败测试**

```js
// packages/brain/src/__tests__/reanchor-blocked-tasks-script.test.js
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('scripts/reanchor-blocked-tasks.mjs', () => {
  it('只选 map_revision_mismatch 停车任务（三种 detail 形态），解锁前清零计数，支持 --dry-run', async () => {
    const source = await readFile(new URL('../../scripts/reanchor-blocked-tasks.mjs', import.meta.url), 'utf8');
    expect(source).toContain("blocked_reason = 'dispatch_fail_autoblock'");
    expect(source).toContain("blocked_detail->>'reason_code' = 'map_revision_mismatch'");
    expect(source).toContain("blocked_detail->>'last_error' = 'map_revision_mismatch'");
    expect(source).toContain("blocked_detail->>'message' LIKE '%base_sha 落后%'");
    expect(source).toContain('dispatch_fail_consecutive');
    expect(source).toContain('unblockTask(');
    expect(source).toContain("'--dry-run'");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/reanchor-blocked-tasks-script.test.js`
Expected: FAIL（文件不存在）

- [ ] **Step 3: 提交失败测试**

```bash
git add packages/brain/src/__tests__/reanchor-blocked-tasks-script.test.js
git commit -m "test(brain): 回填脚本 failing test"
```

- [ ] **Step 4: 写脚本**

```js
#!/usr/bin/env node
// packages/brain/scripts/reanchor-blocked-tasks.mjs
// 一次性回填：把因 map_revision_mismatch 自动停车的任务解锁并清零连续失败计数，
// 快进本身交给下次派发的预检完成（任务 d9c405e2）。不做定时 job（会与 map_recovery 类任务形成 churn）。
//   node packages/brain/scripts/reanchor-blocked-tasks.mjs [--dry-run]
import pool from '../src/db.js';
import { unblockTask } from '../src/task-updater.js';

const dryRun = process.argv.includes('--dry-run');

const { rows } = await pool.query(
  `SELECT id, title, blocked_detail
     FROM tasks
    WHERE status = 'blocked'
      AND blocked_reason = 'dispatch_fail_autoblock'
      AND (
        blocked_detail->>'reason_code' = 'map_revision_mismatch'
        OR blocked_detail->>'last_error' = 'map_revision_mismatch'
        OR blocked_detail->>'message' LIKE '%base_sha 落后%'
      )
    ORDER BY created_at`,
);
console.log(`[reanchor-blocked-tasks] 候选 ${rows.length} 条${dryRun ? '（dry-run，不改库）' : ''}`);
let done = 0;
let failed = 0;
for (const row of rows) {
  if (dryRun) {
    console.log(`  - ${row.id} | ${String(row.title).slice(0, 60)}`);
    continue;
  }
  try {
    await pool.query(
      `UPDATE tasks
          SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"dispatch_fail_consecutive":0}'::jsonb
        WHERE id = $1`,
      [row.id],
    );
    const result = await unblockTask(row.id);
    if (result?.success) {
      done += 1;
      console.log(`  ✓ ${row.id} 已解锁`);
    } else {
      failed += 1;
      console.log(`  ✗ ${row.id} 解锁失败: ${result?.error ?? 'unknown'}`);
    }
  } catch (err) {
    failed += 1;
    console.log(`  ✗ ${row.id} 异常: ${err.message}`);
  }
}
console.log(`[reanchor-blocked-tasks] 完成 ${done} 失败 ${failed}`);
await pool.end();
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/reanchor-blocked-tasks-script.test.js`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add packages/brain/scripts/reanchor-blocked-tasks.mjs
git commit -m "feat(brain): 一次性回填脚本解锁 map_revision_mismatch 停车任务"
```

---

### Task 9: 全量验证 + DevGate

- [ ] **Step 1: 跑 brain 全量测试**

Run: `cd packages/brain && npx vitest run 2>&1 | tail -15`
Expected: 全绿（Test Files N passed）。若有失败，只修与本刀相关的（如快照/mock 期望里新增字段），不动无关测试。

- [ ] **Step 2: DevGate 三件套（仓库根目录）**

Run: `node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs`
Expected: 三项全 ✅

- [ ] **Step 3: 清理检查**

Run: `git diff origin/main --stat && git grep -n "console.log" -- packages/brain/src/orchestrator/preflight/base-sha-reanchor.js packages/brain/src/lib/dispatch-reason-code.js`
Expected: 两文件无 console.log（脚本文件允许 console.log）

- [ ] **Step 4: 最终提交（如有清理）并推送**

```bash
git push -u origin cp-0923171741-0923-reanchor-base-sha
```

---

## 自检

- **Spec 覆盖**：M1→Task1；M2→Task3；M3+M4（预检内快进、复用 authority/map）→Task4+Task5；M5→Task6；M6+M7→Task7；M8→Task8。
- **占位扫描**：所有步骤含完整代码与命令；无 TBD。
- **类型一致**：`reanchorReceiptIfEmptyBranch(client, {task, receipt, map, now, createdSource})` 在 Task3 定义、Task4 以 `deps.reanchorReceipt` 注入并调用；`classifyDispatchReasonCode(execResult)` 在 Task2 定义、Task7 两处调用；`stripReanchorEvidence` 在 Task6 定义与测试一致；`MAX_FASTFORWARD` 导出并在测试引用。
