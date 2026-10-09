# 手机设备资源锁 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** device_locks 纳管 4 台安卓手机，原子 acquire + 双重判据抢占，派发路径（dispatcher + worker-pool）接线互斥，对账式 sweeper 释放。

**Architecture:** 全部在 `packages/brain/`。新模块 `src/device-lock-helpers.js` 承载三条原子 SQL（acquire/release/sweep）；dispatcher 在原子 claim 之后 acquire；释放靠 recovery-loop 对账 sweeper（正确性）+ task-updater 终态即时释放（低延迟）。Spec：`docs/superpowers/specs/2026-09-16-device-locks-phones-design.md`（含被否备选与 10 场景错误分析，实现时先读）。

**Tech Stack:** Node.js ESM + pg + vitest（unit=mock pool 断言 SQL 形状；并发原子性=真库 `*.pg.integration.test.js`，仿 `attempt-store-run-lock.pg.integration.test.js` 的 beforeAll 建临时库+跑 migrate.js 形状）。

**前置（开工第一步，Brain DevGate）：**
```bash
cd packages/brain && node ../../scripts/facts-check.mjs && bash ../../scripts/check-version-sync.sh && node ../quality/scripts/devgate/check-dod-mapping.cjs
```
（在仓库根跑则路径去掉前缀。任一失败先修再动码。）

---

### Task 1: Migration 448（扩列 + 手机种子）

**Files:**
- Create: `packages/brain/migrations/448_device_locks_phones.sql`

- [ ] **Step 1: 写 migration**

```sql
-- 448: device_locks 纳管安卓手机（管家 G5 横切件，task 104ab89f）
--
-- 加 host/device_type 两列：本期仅登记元数据（手机会换宿主，锁按 serial 键），
-- 派发不做主机路由校验。种子 4 台手机 = 2026-09-16 xian-m1/xian-m4 adb 实采。
-- 释放/抢占语义见 src/device-lock-helpers.js。

ALTER TABLE device_locks ADD COLUMN IF NOT EXISTS host TEXT;
ALTER TABLE device_locks ADD COLUMN IF NOT EXISTS device_type TEXT;

UPDATE device_locks SET device_type = 'machine' WHERE device_type IS NULL;

INSERT INTO device_locks (device_name, host, device_type)
VALUES
  ('ANGYVB4311010223', 'xian-m1', 'phone'),
  ('e6c7ef34',         'xian-m1', 'phone'),
  ('ANGYVB4227006983', 'xian-m4', 'phone'),
  ('ANGYVB4402004137', 'xian-m4', 'phone')
ON CONFLICT (device_name) DO UPDATE
  SET host = EXCLUDED.host, device_type = EXCLUDED.device_type;

INSERT INTO schema_version (version, description)
VALUES ('448', 'device_locks 纳管安卓手机: host/device_type 列 + 4 台手机种子')
ON CONFLICT (version) DO NOTHING;
```

- [ ] **Step 2: 本地验证 migration 可跑**

Run: `cd packages/brain && DB_NAME=cecelia_scratch node src/migrate.js 2>&1 | tail -3`
Expected: 无报错，输出含 448 已应用（或 already applied）。**禁连生产库。**

- [ ] **Step 3: Commit**

```bash
git add packages/brain/migrations/448_device_locks_phones.sql
git commit -m "feat(brain): migration 448 device_locks 纳管4台安卓手机"
```

---

### Task 2: device-lock-helpers.js（TDD：先真库并发测试）

**Files:**
- Create: `packages/brain/src/device-lock-helpers.js`
- Test: `packages/brain/src/__tests__/integration/device-locks.pg.integration.test.js`

- [ ] **Step 1: 写 failing 真库集成测试**（beforeAll/afterAll 整段照抄 `attempt-store-run-lock.pg.integration.test.js:117` 形状——临时库名前缀改 `device_locks_`，`quotedIdentifier` 的正则同步改 `/^device_locks_[a-z0-9_]+$/`）

```js
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
import { acquireDeviceLock, releaseDeviceLocksHeldBy, sweepStaleDeviceLocks } from '../../device-lock-helpers.js';

// beforeAll: CREATE DATABASE device_locks_<pid>_<uuid> + execFileSync(migrate.js) + testPool（形状同上述样板）

const SERIAL = 'ANGYVB4311010223'; // migration 448 种子行

async function seedTask(status) {
  const id = randomUUID();
  await testPool.query("INSERT INTO tasks (id,title,status) VALUES ($1,'device lock test',$2)", [id, status]);
  return id;
}

beforeEach(async () => {
  await testPool.query('UPDATE device_locks SET locked_by=NULL, locked_at=NULL, expires_at=NULL');
});

describe('acquireDeviceLock 原子性', () => {
  it('并发 acquire 同一设备恰一个赢', async () => {
    const [t1, t2] = [await seedTask('queued'), await seedTask('queued')];
    const results = await Promise.all([
      acquireDeviceLock(t1, SERIAL, 30, testPool),
      acquireDeviceLock(t2, SERIAL, 30, testPool),
    ]);
    const wins = results.filter((r) => r.result === 'acquired');
    expect(wins).toHaveLength(1);
    expect(results.filter((r) => r.result === 'locked')).toHaveLength(1);
  });

  it('同持有者 reacquire 续期成功', async () => {
    const t1 = await seedTask('in_progress');
    expect((await acquireDeviceLock(t1, SERIAL, 30, testPool)).result).toBe('acquired');
    expect((await acquireDeviceLock(t1, SERIAL, 30, testPool)).result).toBe('acquired');
  });

  it('过期 + 持有任务仍 in_progress → 不可抢', async () => {
    const holder = await seedTask('in_progress');
    await acquireDeviceLock(holder, SERIAL, 30, testPool);
    await testPool.query("UPDATE device_locks SET expires_at = NOW() - interval '1 minute' WHERE device_name=$1", [SERIAL]);
    const rival = await seedTask('queued');
    expect((await acquireDeviceLock(rival, SERIAL, 30, testPool)).result).toBe('locked');
  });

  it('过期 + 持有任务已 failed → 可抢', async () => {
    const holder = await seedTask('failed');
    await testPool.query(
      "UPDATE device_locks SET locked_by=$1, locked_at=NOW(), expires_at=NOW() - interval '1 minute' WHERE device_name=$2",
      [holder, SERIAL]);
    const rival = await seedTask('queued');
    expect((await acquireDeviceLock(rival, SERIAL, 30, testPool)).result).toBe('acquired');
  });

  it('未注册 serial → unknown_device', async () => {
    const t1 = await seedTask('queued');
    expect((await acquireDeviceLock(t1, 'NO_SUCH_SERIAL', 30, testPool)).result).toBe('unknown_device');
  });

  it('expires_at IS NULL 且 locked_by 非空（永久锁）→ 持有任务活跃时不可抢', async () => {
    const holder = await seedTask('in_progress');
    await testPool.query('UPDATE device_locks SET locked_by=$1, locked_at=NOW(), expires_at=NULL WHERE device_name=$2', [holder, SERIAL]);
    const rival = await seedTask('queued');
    expect((await acquireDeviceLock(rival, SERIAL, 30, testPool)).result).toBe('locked');
  });
});

describe('release 与 sweeper', () => {
  it('releaseDeviceLocksHeldBy 只放本任务的锁', async () => {
    const t1 = await seedTask('in_progress');
    await acquireDeviceLock(t1, SERIAL, 30, testPool);
    await releaseDeviceLocksHeldBy(t1, testPool);
    const { rows } = await testPool.query('SELECT locked_by FROM device_locks WHERE device_name=$1', [SERIAL]);
    expect(rows[0].locked_by).toBeNull();
  });

  it('sweeper 释放持有任务非活跃(completed)的锁，保留活跃(in_progress)的锁', async () => {
    const dead = await seedTask('completed');
    const alive = await seedTask('in_progress');
    await testPool.query('UPDATE device_locks SET locked_by=$1, locked_at=NOW() WHERE device_name=$2', [dead, 'ANGYVB4311010223']);
    await testPool.query('UPDATE device_locks SET locked_by=$1, locked_at=NOW() WHERE device_name=$2', [alive, 'e6c7ef34']);
    const swept = await sweepStaleDeviceLocks(testPool);
    expect(swept).toBe(1);
    const { rows } = await testPool.query('SELECT device_name, locked_by FROM device_locks ORDER BY device_name');
    expect(rows.find((r) => r.device_name === 'ANGYVB4311010223').locked_by).toBeNull();
    expect(rows.find((r) => r.device_name === 'e6c7ef34').locked_by).toBe(alive);
  });

  it('sweeper 释放持有 task 已不存在的锁', async () => {
    await testPool.query('UPDATE device_locks SET locked_by=$1, locked_at=NOW() WHERE device_name=$2', [randomUUID(), SERIAL]);
    expect(await sweepStaleDeviceLocks(testPool)).toBe(1);
  });
});
```

- [ ] **Step 2: 跑测试确认 FAIL**

Run: `cd packages/brain && npx vitest run src/__tests__/integration/device-locks.pg.integration.test.js 2>&1 | tail -5`
Expected: FAIL（`device-lock-helpers.js` 不存在）

- [ ] **Step 3: 写实现**

```js
/**
 * device-lock-helpers.js — 手机/设备资源锁（管家 G5 横切件，task 104ab89f）
 *
 * 三条原子 SQL，全部 DB 侧 NOW()（时钟死规矩：禁收执行体自报时间戳）。
 * 释放的正确性由 recovery-loop 的 sweepStaleDeviceLocks 对账保证（executor 有
 * 47 处终态直写 + psql 直设病史，逐回写点接线必漏）；task-updater 终态即时
 * 释放只是低延迟优化。
 * 多设备：当前单 serial。将来同任务多台手机必须按 device_name 排序 + 单条
 * 原子多行 UPDATE all-or-nothing，防死锁。
 */
import defaultPool from './db.js';

const TTL_MIN = 1;
const TTL_MAX = 240;
const TTL_DEFAULT = 30;

function clampTtl(ttlMinutes) {
  const n = Number(ttlMinutes);
  if (!Number.isFinite(n)) return TTL_DEFAULT;
  return Math.min(TTL_MAX, Math.max(TTL_MIN, Math.round(n)));
}

/**
 * 原子抢锁。占用判定：locked_by 非空 且（expires_at NULL=永久锁 或 未过期 或
 * 过期但持有任务仍 in_progress——双重判据，防长任务锁被抢导致双 RPA 同机）。
 * @returns {{result:'acquired',lock:object}|{result:'locked',holder:object}|{result:'unknown_device'}}
 */
export async function acquireDeviceLock(taskId, deviceName, ttlMinutes = TTL_DEFAULT, pool = defaultPool) {
  const ttl = clampTtl(ttlMinutes);
  const { rows } = await pool.query(
    `UPDATE device_locks
        SET locked_by = $1, locked_at = NOW(),
            expires_at = NOW() + ($2 || ' minutes')::interval
      WHERE device_name = $3
        AND (
          locked_by IS NULL
          OR locked_by = $1
          OR (
            expires_at IS NOT NULL AND expires_at < NOW()
            AND NOT EXISTS (
              SELECT 1 FROM tasks t
               WHERE t.id::text = device_locks.locked_by AND t.status = 'in_progress'
            )
          )
        )
      RETURNING *`,
    [String(taskId), String(ttl), deviceName],
  );
  if (rows.length > 0) return { result: 'acquired', lock: rows[0] };
  const { rows: existing } = await pool.query(
    'SELECT device_name, locked_by, locked_at, expires_at FROM device_locks WHERE device_name = $1',
    [deviceName],
  );
  if (existing.length === 0) return { result: 'unknown_device' };
  return { result: 'locked', holder: existing[0] };
}

/** 释放某任务持有的全部设备锁（无锁时 no-op）。 */
export async function releaseDeviceLocksHeldBy(taskId, pool = defaultPool) {
  const { rowCount } = await pool.query(
    'UPDATE device_locks SET locked_by = NULL, locked_at = NULL, expires_at = NULL WHERE locked_by = $1',
    [String(taskId)],
  );
  return rowCount;
}

/**
 * 对账式释放：持有任务已非活跃（不在 queued/in_progress，含 task 被删/psql 直设
 * quarantined/blocked/dep_failed/archived 等一切非活跃态）→ 立即释放。
 * 注意 queued 算活跃：dispatch revert 回 queued 的任务保留锁，二次派发走同持有者
 * reacquire；真死的 queued 由其自身超时链收尾。
 */
export async function sweepStaleDeviceLocks(pool = defaultPool) {
  const { rowCount } = await pool.query(
    `UPDATE device_locks
        SET locked_by = NULL, locked_at = NULL, expires_at = NULL
      WHERE locked_by IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM tasks t
           WHERE t.id::text = device_locks.locked_by
             AND t.status IN ('queued','in_progress')
        )`,
  );
  return rowCount;
}
```

- [ ] **Step 4: 跑测试确认 PASS**

Run: `cd packages/brain && npx vitest run src/__tests__/integration/device-locks.pg.integration.test.js 2>&1 | tail -5`
Expected: 全 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/device-lock-helpers.js packages/brain/src/__tests__/integration/device-locks.pg.integration.test.js
git commit -m "feat(brain): device-lock-helpers 原子acquire/release/对账sweeper (TDD)"
```

---

### Task 3: API 改造（brain-meta.js acquire 原子化 + register 端点）

**Files:**
- Modify: `packages/brain/src/routes/brain-meta.js`（尾部 Device Lock API 段，约 1694-1780 行）
- Test: `packages/brain/src/__tests__/device-lock-api.test.js`

- [ ] **Step 1: 写 failing 单测**（mock `../db.js` 与 supertest 既有形状一致——先看同目录任一 routes 测试怎么 mount router，照抄其 app 构建方式）

```js
import { describe, expect, it, vi, beforeEach } from 'vitest';

const queryMock = vi.hoisted(() => vi.fn());
vi.mock('../db.js', () => ({ default: { query: queryMock } }));

// 断言三件事（按同目录既有 routes 测试的 supertest/直调形状组织）：
// 1. POST /device-locks/acquire：queryMock 第一条 SQL 必须是单条 UPDATE ... RETURNING（不允许先 SELECT）——
//    断言 queryMock.mock.calls[0][0] 匹配 /^\s*UPDATE device_locks/i 且含 'RETURNING'
// 2. acquire 对 unknown_device（UPDATE 0行 + SELECT 0行）返回 404，body.error 含 'Unknown device'
// 3. POST /device-locks/register：SQL 为 INSERT ... ON CONFLICT (device_name) DO UPDATE，
//    且 SET 子句只碰 host/device_type、不含 locked_by
```

- [ ] **Step 2: 跑测试确认 FAIL**

Run: `cd packages/brain && npx vitest run src/__tests__/device-lock-api.test.js 2>&1 | tail -5`

- [ ] **Step 3: 改 brain-meta.js**

acquire 路由体替换为调 helper（保持响应契约：acquired:true/false、404 unknown）：

```js
import { acquireDeviceLock } from '../device-lock-helpers.js';  // 文件顶部 import 区

// POST /device-locks/acquire 路由体：
const { device_name, locked_by, ttl_minutes = 30 } = req.body;
if (!device_name || !locked_by) {
  return res.status(400).json({ success: false, error: 'device_name and locked_by are required' });
}
const r = await acquireDeviceLock(locked_by, device_name, ttl_minutes);
if (r.result === 'unknown_device') {
  return res.status(404).json({ success: false, error: `Unknown device: ${device_name}` });
}
if (r.result === 'locked') {
  return res.json({ acquired: false, locked_by: r.holder.locked_by, expires_at: r.holder.expires_at });
}
res.json({ acquired: true, lock: r.lock });
```

新增 register（放 release 路由之后、export default 之前）：

```js
/**
 * POST /api/brain/device-locks/register
 * 幂等注册/更新设备（手机换宿主重注册即可；不碰锁字段）
 * body: { device_name, host?, device_type? }
 */
router.post('/device-locks/register', async (req, res) => {
  try {
    const { device_name, host = null, device_type = 'phone' } = req.body;
    if (!device_name) {
      return res.status(400).json({ success: false, error: 'device_name is required' });
    }
    const { rows } = await pool.query(
      `INSERT INTO device_locks (device_name, host, device_type)
       VALUES ($1, $2, $3)
       ON CONFLICT (device_name) DO UPDATE
         SET host = EXCLUDED.host, device_type = EXCLUDED.device_type
       RETURNING device_name, host, device_type, locked_by, expires_at`,
      [device_name, host, device_type],
    );
    res.json({ success: true, device: rows[0] });
  } catch (err) {
    console.error('[API] device-locks/register error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});
```

- [ ] **Step 4: 跑测试确认 PASS**，Step 5: Commit

```bash
git add packages/brain/src/routes/brain-meta.js packages/brain/src/__tests__/device-lock-api.test.js
git commit -m "feat(brain): device-locks acquire 原子化 + register 幂等端点"
```

---

### Task 4: dispatcher 接线（claim 后 acquire + revert 路径释放）

**Files:**
- Modify: `packages/brain/src/dispatcher.js`
- Test: `packages/brain/src/__tests__/dispatcher-device-lock.test.js`

**接线位置**：候选循环内 codex pool 检查之后、`// Passed all checks — this is the task to dispatch` / `nextTask = guidedCandidate; break;`（约 723 行）**之前**。此时原子 claim 已持有（631 行 claimResult）。

- [ ] **Step 1: 写 failing 单测**（mock `device-lock-helpers.js` 三个导出 + 照抄 `__tests__/integration/take-map-kernel-authority.pg.integration.test.js` 的 dispatcher mock 集，或用更轻的纯单测 mock 全依赖；断言三分支）

```js
// 断言：
// 1. payload.device_serial 存在且 acquireDeviceLock→{result:'locked'} 时：
//    - 执行了 UPDATE tasks SET claimed_by = NULL（释放 claim）
//    - triggerCeceliaRun 未被调用；该候选进 skip 名单后循环继续（返回值 reason 不为 dispatched）
// 2. {result:'unknown_device'} 时：任务被 UPDATE 成 status='failed' 且 error_message 含 serial；
//    payload 合并 failure_class='unknown_device'
// 3. {result:'acquired'} 时：正常走到 triggerCeceliaRun
// 4. 无 device_serial 的任务：acquireDeviceLock 从未被调用（零影响）
```

- [ ] **Step 2: 确认 FAIL**，**Step 3: 改 dispatcher.js**

文件顶部 import 区加：

```js
import { acquireDeviceLock, releaseDeviceLocksHeldBy } from './device-lock-helpers.js';
```

候选循环插入（在 codex pool 段结束后、`nextTask = guidedCandidate; break;` 前）：

```js
    // 3e. 设备锁（G5 横切件，task 104ab89f）：payload.device_serial 存在时派前必抢。
    //     必须在原子 claim 之后（claim 前抢会踩 pre-flight/HOL 等 8+ 条拒绝路径泄漏锁）。
    const deviceSerial = guidedCandidate?.payload?.device_serial;
    if (deviceSerial) {
      const ttl = guidedCandidate?.payload?.device_ttl_minutes;
      let lockResult;
      try {
        lockResult = await acquireDeviceLock(candidate.id, deviceSerial, ttl);
      } catch (lockErr) {
        console.error(`[dispatch] device lock acquire error (task=${candidate.id}): ${lockErr.message}`);
        lockResult = { result: 'locked', holder: { locked_by: 'acquire_error' } }; // fail-closed：抢不到按被占跳过
      }
      if (lockResult.result === 'unknown_device') {
        tickLog(`[dispatch] task ${candidate.id} device_serial=${deviceSerial} 未注册 → terminal failed`);
        await pool.query(
          `UPDATE tasks SET status='failed', completed_at=NOW(), claimed_by=NULL, claimed_at=NULL,
             error_message=$2,
             payload = COALESCE(payload,'{}'::jsonb) || jsonb_build_object('failure_class','unknown_device')
           WHERE id=$1`,
          [candidate.id, `device_serial "${deviceSerial}" not registered in device_locks — register via POST /api/brain/device-locks/register`]
        );
        await recordDispatchResult(pool, false, 'unknown_device', undefined, candidate.id);
        attempt--;
        holSkipIds.push(candidate.id);
        continue;
      }
      if (lockResult.result === 'locked') {
        tickLog(`[dispatch] HOL skip: device ${deviceSerial} locked by ${lockResult.holder?.locked_by}, skipping task ${candidate.id}`);
        await pool.query(`UPDATE tasks SET claimed_by = NULL, claimed_at = NULL WHERE id = $1`, [candidate.id]);
        holSkipIds.push(candidate.id);
        if (holSkipIds.length >= MAX_SKIP_HEAD_FOR_BLOCKED) {
          await recordDispatchResult(pool, false, 'hol_skip_cap_exceeded');
          return { dispatched: false, reason: 'hol_skip_cap_exceeded', hol_skipped: holSkipIds.length, actions };
        }
        attempt--;
        continue;
      }
    }
```

claim 后 revert 路径补释放（每处 `UPDATE tasks SET claimed_by = NULL` 之后加，try/catch 包住防连锁；无锁时是 no-op）：postClaimException 兜底（约 442-455 行）、mark in_progress 失败（约 736 行）、bridge 拦截回滚（约 760 行）、cecelia-run 不可用 revert（约 771 行）、派发失败 cleanup（约 904/936 行）：

```js
        try { await releaseDeviceLocksHeldBy(nextTask.id); } catch (e) { console.error(`[dispatch] device lock release failed (non-fatal): ${e.message}`); }
```

（postClaimException 处用 `nextTask?.id ?? candidate?.id`，取当处作用域可用的任务 id 变量。）

- [ ] **Step 4: 确认 PASS**，**Step 5: Commit**

```bash
git add packages/brain/src/dispatcher.js packages/brain/src/__tests__/dispatcher-device-lock.test.js
git commit -m "feat(brain): dispatcher 派发接线设备锁——claim后抢锁/被占HOL跳过/未注册fail-fast"
```

---

### Task 5: worker-pool 旁路接线

**Files:**
- Modify: `packages/brain/src/worker-pool-dispatch.js`（CAS 预占约 154-160 行之后、发射 tmux 之前）
- Test: `packages/brain/src/__tests__/worker-pool-device-lock.test.js`

- [ ] **Step 1: failing 单测**：mock helpers，断言 ①CAS 成功且 payload.device_serial 被占 → 执行 `UPDATE tasks SET claimed_by = NULL ... AND claimed_by = 'interactive-dev-skill'` 回滚且不发射；②acquired → 正常发射；③无 serial → helper 不被调用。
- [ ] **Step 2: 确认 FAIL**，**Step 3: 实现**（locked_by 用 task id，不是 'interactive-dev-skill'——与 dispatcher 侧同键，sweeper 才认得）：

```js
import { acquireDeviceLock } from './device-lock-helpers.js';  // 顶部

// CAS rowCount===1 之后、发射前：
const deviceSerial = task.payload?.device_serial;
if (deviceSerial) {
  const lockResult = await acquireDeviceLock(task.id, deviceSerial, task.payload?.device_ttl_minutes)
    .catch((e) => { console.error(`[worker-pool] device lock error: ${e.message}`); return { result: 'locked' }; });
  if (lockResult.result !== 'acquired') {
    console.log(`[worker-pool] device ${deviceSerial} unavailable (${lockResult.result}), revert task ${task.id}`);
    await pool.query(
      `UPDATE tasks SET claimed_by = NULL, claimed_at = NULL WHERE id = $1 AND claimed_by = 'interactive-dev-skill'`,
      [task.id],
    );
    continue;  // 留给下轮扫描（unknown_device 也留队列——worker-pool 无 terminal 语义，dispatcher 侧才判死）
  }
}
```

（插入点的循环/变量名以实读 worker-pool-dispatch.js 为准；`continue` 若不在循环内改为 `return`/跳过当前 task 的等价控制流。）

- [ ] **Step 4: PASS**，**Step 5: Commit**

```bash
git add packages/brain/src/worker-pool-dispatch.js packages/brain/src/__tests__/worker-pool-device-lock.test.js
git commit -m "feat(brain): worker-pool 旁路派发接线设备锁"
```

---

### Task 6: 释放接线（recovery-loop sweeper + task-updater 终态即时释放）

**Files:**
- Modify: `packages/brain/src/recovery-loop.js`（runRecoveryPass 函数内，仿 cleanupStaleClaims 条目形状加一条）
- Modify: `packages/brain/src/task-updater.js`（updateTaskStatus 成功后，status 非 queued/in_progress 时释放）
- Test: `packages/brain/src/__tests__/device-lock-release-wiring.test.js`

- [ ] **Step 1: failing 单测**：①mock helpers 后调 recovery-loop 的 pass 函数，断言 `sweepStaleDeviceLocks` 被调用且异常不中断其余恢复步骤；②updateTaskStatus(id,'completed') 后 `releaseDeviceLocksHeldBy` 被调用、updateTaskStatus(id,'in_progress') 不调用。
- [ ] **Step 2: FAIL**，**Step 3: 实现**

recovery-loop.js（仿既有条目的 try/catch + opts 注入形状）：

```js
  // N. 设备锁对账（G5 横切件）：释放持有任务已非活跃的锁——正确性主保证，
  //    覆盖 executor 47 处终态直写 / psql 直设 / task 被删等一切回写旁路。
  try {
    const sweep = opts.sweepStaleDeviceLocks
      || (await import('./device-lock-helpers.js')).sweepStaleDeviceLocks;
    const swept = await sweep();
    if (swept > 0) console.log(`[recovery-loop] released ${swept} stale device lock(s)`);
  } catch (err) {
    console.warn(`[recovery-loop] sweepStaleDeviceLocks failed (non-fatal): ${err.message}`);
  }
```

task-updater.js updateTaskStatus 的 UPDATE 成功之后：

```js
    // 终态/非活跃态 → 即时释放设备锁（低延迟优化；正确性由 recovery-loop sweeper 兜底）
    if (!['queued', 'in_progress'].includes(status)) {
      try {
        const { releaseDeviceLocksHeldBy } = await import('./device-lock-helpers.js');
        await releaseDeviceLocksHeldBy(taskId);
      } catch (err) {
        console.warn(`[task-updater] device lock release failed (non-fatal): ${err.message}`);
      }
    }
```

- [ ] **Step 4: PASS**，**Step 5: Commit**

```bash
git add packages/brain/src/recovery-loop.js packages/brain/src/task-updater.js packages/brain/src/__tests__/device-lock-release-wiring.test.js
git commit -m "feat(brain): 设备锁释放接线——recovery-loop 对账 sweeper + 终态即时释放"
```

---

### Task 7: 版本碎片 + DevGate + 全量回归

**Files:**
- Create: `changes/cp-09162247-device-locks-phones.md`

- [ ] **Step 1: 写版本碎片**（PR 禁碰版本五件套，规约见 changes/README.md）

```markdown
## Brain {VERSION} — 手机设备资源锁（G5 横切件）

- device_locks 纳管 4 台安卓手机（migration 448，serial 主键 + host/device_type 登记列）
- acquire 原子化（单条 UPDATE + 过期抢占双重判据：expires_at 过期且持有任务已非 in_progress）
- 派发接线：dispatcher 原子 claim 后抢锁（被占 HOL 跳过 / 未注册 fail-fast）+ worker-pool 旁路同接
- 释放：recovery-loop 对账 sweeper（按持有任务非活跃判）+ 终态即时释放；新增 POST /device-locks/register 幂等注册
```

- [ ] **Step 2: node --check 冒烟 + DevGate 三件套**

```bash
cd packages/brain && for f in src/device-lock-helpers.js src/dispatcher.js src/worker-pool-dispatch.js src/recovery-loop.js src/task-updater.js src/routes/brain-meta.js; do node --check "$f" || exit 1; done
cd ../.. && node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs
```
Expected: 全过

- [ ] **Step 3: 全量测试**

Run: `cd packages/brain && npm test 2>&1 | tail -10`
Expected: 全绿（既有 device-locks smoke `scripts/smoke/smoke-runtime.sh` 的 GET 契约未变）

- [ ] **Step 4: Commit**

```bash
git add changes/cp-09162247-device-locks-phones.md
git commit -m "chore(brain): 版本碎片——手机设备资源锁"
```

---

## 收尾（plan 外，走 /dev 接力链）

push → PR → engine-ship → engine-pr-watchdog；merge 后回写 Brain task 104ab89f（status=completed + pr_url）。生产 migration 448 随 brain-deploy 走（**禁手连生产库**）。
