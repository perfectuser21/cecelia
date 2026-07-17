# 产能判定合并（slot-allocator 收权 + cap 函数化）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** harness 派发闸从"数 in_progress 任务的固定常数 cap"换轨为"slot-allocator 里数活容器的动态函数 cap"，终结纸面满机器空转。

**Architecture:** 新建 `machine-vitals.js`（采样器写缓存，scheduler-jobs 60s 驱动）；`slot-allocator.js` 新增 `harnessSlotCheck()` 作判定唯一入口（容器数+inflight vs min(内存/账号/硬顶) 三分量 cap，收编 quota-guard）；dispatcher 的 `MAX_CONCURRENT_HARNESS_INITIATIVES` 判定删除，仅留 TASK_CAP=12 兜底。

**Tech Stack:** Node.js ESM、vitest、execFile docker CLI、PostgreSQL（pool.query）。

## Global Constraints

- 语言：所有注释/日志/commit message 简体中文（commit 尾行 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`）
- TDD 铁律：每个 task commit-1 = failing test，commit-2 = 实现变绿；测试禁 mock 判定函数与数据源之间的边（mock 只允许打在 `execFile`/`pool.query` 系统边界）
- 2026-04-18 pivot 语义不许改：memory_pressure 仅 = Brain RSS halt；系统低内存只 warn
- resume 豁免（`payload.resume_from_checkpoint===true`）语义不变，留在 dispatcher 层
- 跑测试命令：`cd packages/brain && npx vitest run src/__tests__/<file> --reporter=basic`（全量 vitest 会 OOM，只跑目标文件 + 最后跑受影响清单）
- Spec（SSOT）：`docs/superpowers/specs/2026-07-17-slot-allocator-consolidation-design.md`

---

### Task 1: machine-vitals 采样器模块

**Files:**
- Create: `packages/brain/src/machine-vitals.js`
- Test: `packages/brain/src/__tests__/machine-vitals.test.js`

**Interfaces:**
- Produces: `sampleMachineVitals(): Promise<object>`（采样写缓存并返回）；`getMachineVitals(): {sampled_at, relay_containers, relay_count, vm_total_mb, vm_used_mb, host_disk_pct, docker_disk_pct, error, stale}`（同步读缓存，缓存 age>180s → stale:true；从未采样 → `{error:'never_sampled', stale:true}`）；`STALE_MS`；`_resetVitalsCacheForTest()`、`_setVitalsCacheForTest(obj)`（测试注入）
- Consumes: 无（底层 execFile）

- [ ] **Step 1: 写 failing test**

```js
// packages/brain/src/__tests__/machine-vitals.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// mock 只打在 child_process 系统边界（禁 mock 模块内部函数）
const execFileMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile: execFileMock }));

import {
  sampleMachineVitals, getMachineVitals, STALE_MS,
  _resetVitalsCacheForTest, _setVitalsCacheForTest,
} from '../machine-vitals.js';

// execFile(cmd, args, opts, cb) → 按 args 派发假输出
function stubDocker({ psNames = '', memTotal = String(8 * 1024 ** 3), memUsage = '', dfHost = 'Filesystem 1024-blocks Used Available Capacity Mounted\n/dev/disk3s5 100 50 50 50% /', fail = null } = {}) {
  execFileMock.mockImplementation((cmd, args, opts, cb) => {
    const done = typeof opts === 'function' ? opts : cb;
    if (fail) return done(new Error(fail));
    if (cmd === 'docker' && args[0] === 'ps') return done(null, psNames, '');
    if (cmd === 'docker' && args[0] === 'info') return done(null, memTotal, '');
    if (cmd === 'docker' && args[0] === 'stats') return done(null, memUsage, '');
    if (cmd === 'df') return done(null, dfHost, '');
    return done(new Error(`unexpected: ${cmd} ${args.join(' ')}`));
  });
}

describe('machine-vitals', () => {
  beforeEach(() => { _resetVitalsCacheForTest(); execFileMock.mockReset(); });

  it('采样成功：relay 容器按前缀计数，其他容器不算', async () => {
    stubDocker({
      psNames: 'cecelia-relay-aaa-111\ncecelia-relay-bbb-222\ncecelia-task-ccc-333\ncecelia-node-brain\n',
      memUsage: '512MiB / 8GiB\n1.5GiB / 8GiB\n',
    });
    await sampleMachineVitals();
    const v = getMachineVitals();
    expect(v.relay_count).toBe(2);
    expect(v.relay_containers).toEqual(['cecelia-relay-aaa-111', 'cecelia-relay-bbb-222']);
    expect(v.vm_total_mb).toBe(8192);
    expect(v.vm_used_mb).toBe(512 + 1536);
    expect(v.host_disk_pct).toBe(50);
    expect(v.error).toBeNull();
    expect(v.stale).toBe(false);
  });

  it('docker 命令失败：error 进缓存', async () => {
    stubDocker({ fail: 'docker daemon down' });
    await sampleMachineVitals();
    const v = getMachineVitals();
    expect(v.error).toMatch(/docker daemon down/);
  });

  it('从未采样：never_sampled + stale', () => {
    const v = getMachineVitals();
    expect(v.error).toBe('never_sampled');
    expect(v.stale).toBe(true);
  });

  it('缓存超 STALE_MS：stale=true', () => {
    _setVitalsCacheForTest({ sampled_at: Date.now() - STALE_MS - 1000, relay_count: 1, error: null });
    expect(getMachineVitals().stale).toBe(true);
  });

  it('缓存新鲜：stale=false', () => {
    _setVitalsCacheForTest({ sampled_at: Date.now() - 5000, relay_count: 1, error: null });
    expect(getMachineVitals().stale).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/machine-vitals.test.js --reporter=basic`
Expected: FAIL（Cannot find module '../machine-vitals.js'）

- [ ] **Step 3: commit-1（failing test）**

```bash
git add packages/brain/src/__tests__/machine-vitals.test.js
git commit -m "test(brain): machine-vitals 采样器 failing test（beeba317 T1）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: 实现 machine-vitals.js**

```js
// packages/brain/src/machine-vitals.js
/**
 * machine-vitals —— 本机体征采样器（beeba317 产能判定合并）
 *
 * 单一职责：采集 docker 容器数 / OrbStack VM 内存 / 磁盘水位写内存缓存。
 * 不做判定——判定在 slot-allocator.harnessSlotCheck()。
 * 由 scheduler-jobs 每 60s 驱动 sampleMachineVitals()；
 * 派发热路径只调 getMachineVitals()（同步读缓存，零命令执行）。
 */
import { execFile } from 'node:child_process';

export const STALE_MS = 180 * 1000;          // 3×采样周期(60s)，超龄=stale
const STALE_ALERT_MS = 15 * 60 * 1000;       // 持续 stale 15min → 升级告警
const RELAY_PREFIX = 'cecelia-relay-';
const CMD_TIMEOUT_MS = 10 * 1000;

let _cache = null;                            // { sampled_at, relay_containers, relay_count, vm_total_mb, vm_used_mb, host_disk_pct, docker_disk_pct, error }
let _lastGoodAt = 0;
let _staleAlerted = false;

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: CMD_TIMEOUT_MS }, (err, stdout) => {
      if (err) return reject(err);
      resolve(String(stdout));
    });
  });
}

/** "512MiB / 8GiB" → MB 数（左值） */
function parseMemUsageLine(line) {
  const m = line.trim().match(/^([\d.]+)\s*(B|KiB|MiB|GiB|TiB)/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  const mult = { b: 1 / 1024 ** 2, kib: 1 / 1024, mib: 1, gib: 1024, tib: 1024 ** 2 }[unit] ?? 0;
  return n * mult;
}

/** df -P 输出 → 使用率百分比整数 */
function parseDfPct(out) {
  const lines = out.trim().split('\n');
  const last = lines[lines.length - 1] || '';
  const m = last.match(/(\d+)%/);
  return m ? parseInt(m[1], 10) : null;
}

export async function sampleMachineVitals() {
  const next = {
    sampled_at: Date.now(),
    relay_containers: [], relay_count: 0,
    vm_total_mb: null, vm_used_mb: null,
    host_disk_pct: null, docker_disk_pct: null,
    error: null,
  };
  try {
    const [psOut, infoOut, statsOut, dfOut] = await Promise.all([
      run('docker', ['ps', '--format', '{{.Names}}']),
      run('docker', ['info', '--format', '{{.MemTotal}}']),
      run('docker', ['stats', '--no-stream', '--format', '{{.MemUsage}}']),
      run('df', ['-P', '/']),
    ]);
    next.relay_containers = psOut.split('\n').map(s => s.trim()).filter(n => n.startsWith(RELAY_PREFIX));
    next.relay_count = next.relay_containers.length;
    next.vm_total_mb = Math.round(parseInt(infoOut.trim(), 10) / 1024 / 1024);
    next.vm_used_mb = Math.round(statsOut.split('\n').filter(Boolean).reduce((s, l) => s + parseMemUsageLine(l), 0));
    next.host_disk_pct = parseDfPct(dfOut);
    // OrbStack data 盘与宿主同卷（APFS），docker_disk_pct 并入宿主口径（spec 约定的降级路径）
    next.docker_disk_pct = next.host_disk_pct;
    _lastGoodAt = next.sampled_at;
    _staleAlerted = false;
  } catch (err) {
    next.error = err.message;
    // 持续采样失败超 15min → 升级告警（一次性，恢复后复位）
    if (_lastGoodAt && Date.now() - _lastGoodAt > STALE_ALERT_MS && !_staleAlerted) {
      _staleAlerted = true;
      console.error(`[machine-vitals] 采样持续失败超 ${STALE_ALERT_MS / 60000}min，harness 派发将保守拒发: ${err.message}`);
    }
  }
  _cache = next;
  return next;
}

export function getMachineVitals() {
  if (!_cache) return { error: 'never_sampled', stale: true, relay_count: null, relay_containers: [], vm_total_mb: null, vm_used_mb: null, host_disk_pct: null, docker_disk_pct: null, sampled_at: null };
  return { ..._cache, stale: Date.now() - _cache.sampled_at > STALE_MS };
}

export function _resetVitalsCacheForTest() { _cache = null; _lastGoodAt = 0; _staleAlerted = false; }
export function _setVitalsCacheForTest(obj) { _cache = obj; }
```

- [ ] **Step 5: 跑测试变绿**

Run: `cd packages/brain && npx vitest run src/__tests__/machine-vitals.test.js --reporter=basic`
Expected: PASS（5 个用例全绿）

- [ ] **Step 6: commit-2**

```bash
git add packages/brain/src/machine-vitals.js
git commit -m "feat(brain): machine-vitals 体征采样器——docker 容器数/VM内存/盘水位写缓存（beeba317 T1）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: account-usage 新增 getAvailableAccountCount()

**Files:**
- Modify: `packages/brain/src/account-usage.js`（在 `isAuthFailed` 定义之后加导出）
- Test: `packages/brain/src/__tests__/account-available-count.test.js`

**Interfaces:**
- Consumes: 既有 `isSpendingCapped(accountId)`、`isAuthFailed(accountId)`、`markSpendingCap`、`markAuthFailure`、内部 `ACCOUNTS`
- Produces: `getAvailableAccountCount(accounts = ACCOUNTS): number`（未 spending-cap 且未 auth-fail 的账号数）

- [ ] **Step 1: 写 failing test**

```js
// packages/brain/src/__tests__/account-available-count.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getAvailableAccountCount, markSpendingCap, markAuthFailure,
  _resetAuthFailures, isSpendingCapped,
} from '../account-usage.js';

describe('getAvailableAccountCount', () => {
  beforeEach(() => {
    _resetAuthFailures();
    // 清 spending cap：markSpendingCap 无对称 reset，用注入账号列表隔离生产态
  });

  it('注入 3 账号全健康 → 3', () => {
    expect(getAvailableAccountCount(['t1', 't2', 't3'])).toBe(3);
  });

  it('1 个 spending-capped → 扣除', () => {
    markSpendingCap('t2', new Date(Date.now() + 3600_000).toISOString());
    expect(isSpendingCapped('t2')).toBe(true);
    expect(getAvailableAccountCount(['t1', 't2', 't3'])).toBe(2);
  });

  it('1 个 auth-failed → 扣除', () => {
    markAuthFailure('t3', new Date(Date.now() + 3600_000).toISOString());
    expect(getAvailableAccountCount(['t1', 't3'])).toBe(1);
  });

  it('默认参数走生产 ACCOUNTS（2 账号）→ 返回 0-2 之间', () => {
    const n = getAvailableAccountCount();
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/account-available-count.test.js --reporter=basic`
Expected: FAIL（getAvailableAccountCount is not exported）

- [ ] **Step 3: commit-1**

```bash
git add packages/brain/src/__tests__/account-available-count.test.js
git commit -m "test(brain): getAvailableAccountCount failing test（beeba317 T2）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: 实现（account-usage.js 中 isAuthFailed 函数体之后插入）**

```js
/**
 * 可用 Claude 账号数（未 spending-cap 且未 auth-fail）。
 * slot-allocator 动态 cap 的账号派生天花板数据源（beeba317）：
 * cap_acct = 可用账号数 × 每账号安全并发。加账号 = ACCOUNTS 加一行，天花板自动涨。
 */
export function getAvailableAccountCount(accounts = ACCOUNTS) {
  return accounts.filter(id => !isSpendingCapped(id) && !isAuthFailed(id)).length;
}
```

- [ ] **Step 5: 跑测试变绿**

Run: `cd packages/brain && npx vitest run src/__tests__/account-available-count.test.js --reporter=basic`
Expected: PASS

- [ ] **Step 6: commit-2**

```bash
git add packages/brain/src/account-usage.js
git commit -m "feat(brain): getAvailableAccountCount——账号派生天花板数据源（beeba317 T2）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: slot-allocator 新增 harnessSlotCheck()（核心判定）

**Files:**
- Modify: `packages/brain/src/slot-allocator.js`（文件尾部 API 区加函数 + exports 区加导出）
- Test: `packages/brain/src/__tests__/harness-slot-check.test.js`

**Interfaces:**
- Consumes: `getMachineVitals()`（T1）、`getAvailableAccountCount()`（T2）、`checkQuotaGuard()`（quota-guard.js 既有）、`evaluateMemoryHealth`/`getBrainRssMB`（platform-utils 既有，slot-allocator 已 import）、`pool.query`（inflight 计数）、`RESOURCE_TIERS`（spawn/middleware/resource-tier.js——确认其导出名后 import normal 档 memoryMB；若未导出则 `export` 化，禁止硬编码 1024）
- Produces: `harnessSlotCheck({ candidate } = {}): Promise<{allow, reason, containers, inflight, cap:{effective, mem_cap, acct_cap, hard_cap}, stale}>`；常量 `PER_ACCOUNT_CONCURRENCY=2`、`HARNESS_HARD_CAP`（env 默认 8）、`INFLIGHT_GRACE_MS = 5*60*1000`

- [ ] **Step 1: 写 failing test**

```js
// packages/brain/src/__tests__/harness-slot-check.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock 只打在系统边界：DB、quota-guard 的 usage API 缓存、账号 cap 状态注入、vitals 缓存注入
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../quota-guard.js', () => ({ checkQuotaGuard: vi.fn() }));
vi.mock('../account-usage.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, getAvailableAccountCount: vi.fn(() => 2) };
});

import pool from '../db.js';
import { checkQuotaGuard } from '../quota-guard.js';
import { getAvailableAccountCount } from '../account-usage.js';
import { _setVitalsCacheForTest, _resetVitalsCacheForTest } from '../machine-vitals.js';
import { harnessSlotCheck, PER_ACCOUNT_CONCURRENCY, HARNESS_HARD_CAP } from '../slot-allocator.js';

function vitals(over = {}) {
  return {
    sampled_at: Date.now(), error: null,
    relay_containers: [], relay_count: 0,
    vm_total_mb: 13600, vm_used_mb: 5400,   // 余量 8200MB → mem_cap=8
    host_disk_pct: 50, docker_disk_pct: 50,
    ...over,
  };
}

beforeEach(() => {
  _resetVitalsCacheForTest();
  pool.query.mockReset().mockResolvedValue({ rows: [{ n: 0 }] });   // inflight=0 默认
  checkQuotaGuard.mockReset().mockResolvedValue({ allow: true, priorityFilter: null, reason: 'ok', bestPct: 10 });
  getAvailableAccountCount.mockReturnValue(2);
});

describe('harnessSlotCheck 动态 cap（beeba317 主线）', () => {
  it('【主线A 收权】活容器 2 + 体征好 + 额度足 → 放行（任务数无关）', async () => {
    _setVitalsCacheForTest(vitals({ relay_count: 2, relay_containers: ['cecelia-relay-a-1', 'cecelia-relay-b-2'] }));
    const r = await harnessSlotCheck({ candidate: { priority: 'P1' } });
    expect(r.allow).toBe(true);
    expect(r.cap.effective).toBe(4);   // min(mem=8, acct=2*2=4, hard=8)
  });

  it('【主线B 函数化】活容器 4 + acct_cap=4 → 拒；账号加到 3（acct_cap=6）→ 放行——有内存+有账号则不被常数卡', async () => {
    _setVitalsCacheForTest(vitals({ relay_count: 4 }));
    const r1 = await harnessSlotCheck({ candidate: { priority: 'P1' } });
    expect(r1.allow).toBe(false);
    expect(r1.reason).toBe('cap_reached');
    getAvailableAccountCount.mockReturnValue(3);   // 加账号=池里加一行
    const r2 = await harnessSlotCheck({ candidate: { priority: 'P1' } });
    expect(r2.allow).toBe(true);
    expect(r2.cap.effective).toBe(6);
  });

  it('内存余量只够 1 档（1.5G）→ mem_cap=1，活容器 1 → 拒', async () => {
    _setVitalsCacheForTest(vitals({ vm_total_mb: 6900, vm_used_mb: 5400, relay_count: 1 }));
    const r = await harnessSlotCheck({ candidate: { priority: 'P1' } });
    expect(r.allow).toBe(false);
    expect(r.cap.mem_cap).toBe(1);
  });

  it('盘 >85% → 拒 disk_pressure', async () => {
    _setVitalsCacheForTest(vitals({ host_disk_pct: 91 }));
    const r = await harnessSlotCheck({ candidate: { priority: 'P1' } });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe('disk_pressure');
  });

  it('vitals error → 保守拒', async () => {
    _setVitalsCacheForTest(vitals({ error: 'docker daemon down' }));
    const r = await harnessSlotCheck({ candidate: { priority: 'P1' } });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe('vitals_error');
  });

  it('vitals stale（超180s）→ 保守拒', async () => {
    _setVitalsCacheForTest(vitals({ sampled_at: Date.now() - 200_000 }));
    const r = await harnessSlotCheck({ candidate: { priority: 'P1' } });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe('vitals_stale');
  });

  it('quota >98%（allow=false）→ 拒 quota_critical', async () => {
    _setVitalsCacheForTest(vitals());
    checkQuotaGuard.mockResolvedValue({ allow: false, priorityFilter: null, reason: 'critical', bestPct: 99 });
    const r = await harnessSlotCheck({ candidate: { priority: 'P0' } });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe('quota_critical');
  });

  it('quota >90%：P2 拒 / P0 过', async () => {
    _setVitalsCacheForTest(vitals());
    checkQuotaGuard.mockResolvedValue({ allow: true, priorityFilter: ['P0', 'P1'], reason: 'low', bestPct: 93 });
    const rP2 = await harnessSlotCheck({ candidate: { priority: 'P2' } });
    expect(rP2.allow).toBe(false);
    expect(rP2.reason).toBe('quota_low_priority');
    const rP0 = await harnessSlotCheck({ candidate: { priority: 'P0' } });
    expect(rP0.allow).toBe(true);
  });

  it('inflight 超发窗口：活容器 1 + 宽限期内无容器新派发 1 → 拟占用 2，cap=2 时拒', async () => {
    _setVitalsCacheForTest(vitals({ relay_count: 1, relay_containers: ['cecelia-relay-a-1'], vm_total_mb: 7900, vm_used_mb: 5400 })); // mem_cap=2
    pool.query.mockResolvedValue({ rows: [{ n: 1 }] });   // inflight=1
    const r = await harnessSlotCheck({ candidate: { priority: 'P1' } });
    expect(r.allow).toBe(false);
    expect(r.inflight).toBe(1);
    expect(r.reason).toBe('cap_reached');
  });

  it('inflight 查询抛错 → 保守拒', async () => {
    _setVitalsCacheForTest(vitals());
    pool.query.mockRejectedValue(new Error('db down'));
    const r = await harnessSlotCheck({ candidate: { priority: 'P1' } });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe('inflight_query_error');
  });

  it('memory_pressure(halt) → 拒（brain_rss 注入走 vitals 缓存外的 evaluateMemoryHealth 现算，用超大 RSS 模拟不可行——改由 harnessSlotCheck 接受注入的 memHealth 覆盖参数验证）', async () => {
    _setVitalsCacheForTest(vitals());
    const r = await harnessSlotCheck({ candidate: { priority: 'P1' }, _memHealthOverride: { action: 'halt', reason: 'brain rss leak' } });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe('memory_pressure');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-slot-check.test.js --reporter=basic`
Expected: FAIL（harnessSlotCheck is not exported）

- [ ] **Step 3: commit-1**

```bash
git add packages/brain/src/__tests__/harness-slot-check.test.js
git commit -m "test(brain): harnessSlotCheck 动态cap failing test——主线A收权+主线B函数化（beeba317 T3）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: 实现（slot-allocator.js）**

顶部 import 区追加：

```js
import { getMachineVitals } from './machine-vitals.js';
import { checkQuotaGuard } from './quota-guard.js';
import { getAvailableAccountCount } from './account-usage.js';
import { RESOURCE_TIERS } from './spawn/middleware/resource-tier.js';
```

> 若 `resource-tier.js` 的档位表未导出（当前是模块内 const），先在该文件把档位表 `export`（named export `RESOURCE_TIERS`），不改任何数值。

常量区（BACKPRESSURE 常量附近）追加：

```js
// ============================================================
// harnessSlotCheck 动态 cap（beeba317 产能判定合并）
// cap 是函数不是常数：min(内存余量÷档位, 账号数×每账号并发, 硬顶)
// ============================================================
const RELAY_TIER_MB = RESOURCE_TIERS.normal.memoryMB;   // relay 容器档位（1024），改档位自动跟
export const PER_ACCOUNT_CONCURRENCY = 2;               // 每 Claude 账号安全并发
export const HARNESS_HARD_CAP = (() => {                // 失控兜底
  const raw = parseInt(process.env.HARNESS_HARD_CAP || '', 10);
  return Number.isFinite(raw) && raw >= 1 ? raw : 8;
})();
export const INFLIGHT_GRACE_MS = 5 * 60 * 1000;         // 派发→容器出现的超发窗口宽限期
const DISK_PRESSURE_PCT = 85;
```

API 区（getSlotStatus 之后）追加：

```js
/**
 * harness 派发 admission 判定——唯一入口（beeba317 收权自 dispatcher 任务数 cap）。
 * 拟占用 = 活 relay 容器数 + 宽限期内已派发但尚无容器的 harness 数（防超发窗口）。
 * 动态 cap = min(mem_cap, acct_cap, hard_cap)，任一维度保守失败即拒。
 * @param {{candidate?: {priority?: string}, _memHealthOverride?: object}} opts
 */
async function harnessSlotCheck({ candidate, _memHealthOverride } = {}) {
  const v = getMachineVitals();
  const base = { containers: v.relay_count, inflight: null, cap: null, stale: v.stale };

  // 1. vitals 可用性（保守：看不见机器就不派）
  if (v.error) return { ...base, allow: false, reason: v.error === 'never_sampled' ? 'vitals_stale' : 'vitals_error' };
  if (v.stale) return { ...base, allow: false, reason: 'vitals_stale' };

  // 2. 盘水位（07-15 宿主盘满事故案底）
  if ((v.host_disk_pct ?? 0) > DISK_PRESSURE_PCT || (v.docker_disk_pct ?? 0) > DISK_PRESSURE_PCT) {
    return { ...base, allow: false, reason: 'disk_pressure' };
  }

  // 3. 内存健康（仅 Brain RSS halt；2026-04-18 pivot 语义不改）
  const memHealth = _memHealthOverride ?? evaluateMemoryHealth({
    brain_rss_mb: getBrainRssMB(),
    system_available_mb: Math.round(os.freemem() / 1024 / 1024),
    system_total_mb: Math.round(os.totalmem() / 1024 / 1024),
    system_floor_mb: MEMORY_PRESSURE_THRESHOLD_MB,
  });
  if (memHealth.action === 'halt') return { ...base, allow: false, reason: 'memory_pressure' };

  // 4. Claude 额度——收编 quota-guard，禁在此重写阈值（考古：初版漏查酿第五套）
  const qg = await checkQuotaGuard();
  if (!qg.allow) return { ...base, allow: false, reason: 'quota_critical' };
  if (qg.priorityFilter && candidate?.priority && !qg.priorityFilter.includes(candidate.priority)) {
    return { ...base, allow: false, reason: 'quota_low_priority' };
  }

  // 5. 动态 cap 三分量
  const memFreeMB = (v.vm_total_mb ?? 0) - (v.vm_used_mb ?? 0);
  const mem_cap = Math.floor(memFreeMB / RELAY_TIER_MB);
  const acct_cap = getAvailableAccountCount() * PER_ACCOUNT_CONCURRENCY;
  const cap = { mem_cap, acct_cap, hard_cap: HARNESS_HARD_CAP, effective: Math.max(1, Math.min(mem_cap, acct_cap, HARNESS_HARD_CAP)) };

  // 内存余量连 1 档都不够且已有容器在跑 → 不再叠加
  if (mem_cap <= 0 && v.relay_count >= 1) return { ...base, cap, allow: false, reason: 'no_memory_headroom' };

  // inflight：宽限期内已 in_progress 但 docker ps 还看不到容器的 harness（防派发→容器出现间隙超发）
  let inflight;
  try {
    const r = await pool.query(
      `SELECT count(*)::int AS n FROM tasks
         WHERE task_type IN ('harness_initiative', 'golden_path_proposal')
           AND status = 'in_progress'
           AND started_at > NOW() - make_interval(secs => $1)
           AND NOT EXISTS (
             SELECT 1 FROM unnest($2::text[]) AS c(name)
             WHERE c.name LIKE 'cecelia-relay-' || substring(tasks.id::text, 1, 8) || '%'
           )`,
      [INFLIGHT_GRACE_MS / 1000, v.relay_containers]
    );
    inflight = r.rows[0]?.n ?? 0;
  } catch (err) {
    return { ...base, cap, allow: false, reason: 'inflight_query_error' };
  }

  const occupied = v.relay_count + inflight;
  if (occupied >= cap.effective) {
    return { containers: v.relay_count, inflight, cap, stale: false, allow: false, reason: 'cap_reached' };
  }
  return { containers: v.relay_count, inflight, cap, stale: false, allow: true, reason: 'ok' };
}
```

> ⚠️ 容器名与任务的关联：relay 容器命名 `cecelia-relay-<initiativeShortId>-<suffix>`，任务 id 前 8 位是否等于 initiativeShortId 需在实现时用 `docker ps` 实况 + `harness-skill-relay.js` 的容器命名代码核实；若命名取的是 initiative_id 而非 task id，SQL 的 LIKE 匹配改为 join initiative 字段（`payload->>'initiative_id'` 前 8 位）。核实后按实况写，测试用例同步对齐。

exports 区追加：`harnessSlotCheck`（PER_ACCOUNT_CONCURRENCY/HARNESS_HARD_CAP/INFLIGHT_GRACE_MS 已在定义处 export）。

- [ ] **Step 5: 跑测试变绿 + 既有测试回归**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-slot-check.test.js src/__tests__/slot-allocator.test.js src/__tests__/slot-buffer.test.js src/__tests__/slot-accounting.test.js --reporter=basic`
Expected: 全 PASS

- [ ] **Step 6: commit-2**

```bash
git add packages/brain/src/slot-allocator.js packages/brain/src/spawn/middleware/resource-tier.js
git commit -m "feat(brain): harnessSlotCheck 动态cap判定——容器数+inflight vs min(内存/账号/硬顶)，收编quota-guard（beeba317 T3）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: dispatcher 换轨（删任务数 cap，接 harnessSlotCheck + TASK_CAP 兜底）

**Files:**
- Modify: `packages/brain/src/dispatcher.js`（55-102 行常量区 + 555-577 行判定现场）
- Modify: `packages/brain/src/__tests__/dispatcher-harness-concurrency-cap.test.js`（重写为新语义）
- Test（回归保留）: `packages/brain/src/__tests__/dispatcher-resume-cap-exempt.test.js`

**Interfaces:**
- Consumes: `harnessSlotCheck`（T3 签名）
- Produces: `shouldApplyHarnessCap(candidate)` 语义不变（类型过滤 + resume 豁免）；新常量 `HARNESS_TASK_CAP_BACKSTOP = 12`；删除 `MAX_CONCURRENT_HARNESS_INITIATIVES`、`harnessConcurrencyExceeded`

- [ ] **Step 1: 重写 cap 测试为 failing（新语义）**

`dispatcher-harness-concurrency-cap.test.js` 全文替换：

```js
// 主线A（收权）：in_progress 任务数不再是判定依据；判定走 harnessSlotCheck
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../slot-allocator.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, harnessSlotCheck: vi.fn(), calculateSlotBudget: vi.fn() };
});

import { shouldApplyHarnessCap, HARNESS_TASK_CAP_BACKSTOP } from '../dispatcher.js';

describe('harness cap 收权后语义（beeba317）', () => {
  it('MAX_CONCURRENT_HARNESS_INITIATIVES 已删除', async () => {
    const mod = await import('../dispatcher.js');
    expect(mod.MAX_CONCURRENT_HARNESS_INITIATIVES).toBeUndefined();
    expect(mod.harnessConcurrencyExceeded).toBeUndefined();
  });

  it('TASK_CAP 兜底常量 = 12', () => {
    expect(HARNESS_TASK_CAP_BACKSTOP).toBe(12);
  });

  it('shouldApplyHarnessCap 语义不变：harness_initiative 受控', () => {
    expect(shouldApplyHarnessCap({ task_type: 'harness_initiative' })).toBe(true);
    expect(shouldApplyHarnessCap({ task_type: 'golden_path_proposal' })).toBe(true);
    expect(shouldApplyHarnessCap({ task_type: 'dev' })).toBe(false);
  });

  it('resume 豁免语义不变（回归：OPEN-2 自愈锁死案）', () => {
    expect(shouldApplyHarnessCap({ task_type: 'harness_initiative', payload: { resume_from_checkpoint: true } })).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/dispatcher-harness-concurrency-cap.test.js --reporter=basic`
Expected: FAIL（MAX_CONCURRENT_HARNESS_INITIATIVES 仍存在 / HARNESS_TASK_CAP_BACKSTOP 未定义）

- [ ] **Step 3: commit-1**

```bash
git add packages/brain/src/__tests__/dispatcher-harness-concurrency-cap.test.js
git commit -m "test(brain): dispatcher harness cap 换轨 failing test（beeba317 T4）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: 改 dispatcher.js**

常量区（53-102 行）：删除 `MAX_CONCURRENT_HARNESS_INITIATIVES` 与 `harnessConcurrencyExceeded`（含注释块），替换为：

```js
// ============================================================
// harness 派发闸——判定唯一入口在 slot-allocator.harnessSlotCheck()（beeba317 收权）
// 数活容器不数任务：任务生命周期一半在等 CI，容器已退仍占任务数位 = 纸面满机器空转。
// 这里只留任务数纯兜底（docker 层全瞎时防无限叠加），阈值宽到正常永不触发。
// ============================================================
export const HARNESS_TASK_CAP_BACKSTOP = 12;
```

`shouldApplyHarnessCap` 原样保留。import 区把 `calculateSlotBudget` 一行扩为：

```js
import { calculateSlotBudget, harnessSlotCheck } from './slot-allocator.js';
```

判定现场（原 3b'' 块，555-577 行）替换为：

```js
    // 3b''. harness admission —— 判定收归 slot-allocator（beeba317）。
    //       放在原子 claim 之前 → 被拒时无需释放 claim；拒发直接 return 让位下一 tick。
    if (shouldApplyHarnessCap(candidate)) {
      // 任务数纯兜底：docker 层全瞎时防无限叠加（正常永不触发）
      const capRes = await pool.query(
        `SELECT count(*)::int AS n FROM tasks
           WHERE task_type IN ('harness_initiative', 'golden_path_proposal')
             AND status = 'in_progress'
             AND id != $1`,
        [candidate.id]
      );
      const running = capRes.rows[0]?.n ?? 0;
      if (running >= HARNESS_TASK_CAP_BACKSTOP) {
        tickLog(`[dispatch] harness 任务数兜底 ${running}/${HARNESS_TASK_CAP_BACKSTOP}，延后派发 ${candidate.id}`);
        await recordDispatchResult(pool, false, 'task_cap_backstop');
        return { dispatched: false, reason: 'task_cap_backstop', running, task_id: candidate.id, actions };
      }

      const slotCheck = await harnessSlotCheck({ candidate });
      const capStr = slotCheck.cap
        ? `${slotCheck.cap.effective}(mem=${slotCheck.cap.mem_cap} acct=${slotCheck.cap.acct_cap} hard=${slotCheck.cap.hard_cap})`
        : 'n/a';
      tickLog(`[dispatch] slot_check containers=${slotCheck.containers} inflight=${slotCheck.inflight} cap=${capStr} stale=${slotCheck.stale} verdict=${slotCheck.allow ? 'allow' : `deny:${slotCheck.reason}`}`);
      if (!slotCheck.allow) {
        await recordDispatchResult(pool, false, slotCheck.reason);
        return { dispatched: false, reason: slotCheck.reason, slot_check: slotCheck, task_id: candidate.id, actions };
      }
    }
```

全仓 grep `MAX_CONCURRENT_HARNESS_INITIATIVES`、`harnessConcurrencyExceeded` 清理残余引用（含 `dispatcher-resume-cap-exempt.test.js` 若引用了旧常量则改用新判定路径，resume 豁免断言本身保留）。

- [ ] **Step 5: 跑测试变绿 + dispatcher 回归**

Run: `cd packages/brain && npx vitest run src/__tests__/dispatcher-harness-concurrency-cap.test.js src/__tests__/dispatcher-resume-cap-exempt.test.js src/__tests__/dispatcher.test.js src/__tests__/dispatcher-initiative-lock.test.js --reporter=basic`
Expected: 全 PASS

- [ ] **Step 6: commit-2**

```bash
git add packages/brain/src/dispatcher.js packages/brain/src/__tests__/
git commit -m "feat(brain): dispatcher harness 闸换轨 harnessSlotCheck，任务数降级 TASK_CAP=12 兜底（beeba317 T4）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: scheduler-jobs 接采样 + capacity-budget 暴露 machine_vitals

**Files:**
- Modify: `packages/brain/src/scheduler-jobs.js`（JOBS 数组加一行 + import）
- Modify: `packages/brain/src/routes/capacity-budget.js`（响应加 machine_vitals 段 + import）
- Test: `packages/brain/src/__tests__/machine-vitals-wiring.test.js`

**Interfaces:**
- Consumes: `sampleMachineVitals`/`getMachineVitals`（T1）、`runSchedulerJobsOnce(pool, jobs)`（既有）
- Produces: JOBS 含 `{ name: 'machine-vitals', needsPool: false, timeoutMs: DEFAULT_TIMEOUT_MS, handler: sampleMachineVitals, description: '本机体征采样（docker容器数/VM内存/盘，60s，harness admission 数据源，beeba317）' }`；GET /capacity-budget 响应含 `machine_vitals`

- [ ] **Step 1: 写 failing test**

```js
// packages/brain/src/__tests__/machine-vitals-wiring.test.js
import { describe, it, expect, vi } from 'vitest';

const execFileMock = vi.hoisted(() => vi.fn((cmd, args, opts, cb) => {
  const done = typeof opts === 'function' ? opts : cb;
  done(null, cmd === 'docker' && args[0] === 'info' ? String(8 * 1024 ** 3) : '', '');
}));
vi.mock('node:child_process', () => ({ execFile: execFileMock }));
vi.mock('../db.js', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));

import { JOBS } from '../scheduler-jobs.js';
import { getMachineVitals, _resetVitalsCacheForTest } from '../machine-vitals.js';

describe('machine-vitals 接线', () => {
  it('JOBS 注册了 machine-vitals 采样 job', () => {
    const job = JOBS.find(j => j.name === 'machine-vitals');
    expect(job).toBeDefined();
    expect(job.needsPool).toBe(false);
  });

  it('job handler 执行后缓存被填充', async () => {
    _resetVitalsCacheForTest();
    const job = JOBS.find(j => j.name === 'machine-vitals');
    await job.handler();
    expect(getMachineVitals().error).toBeNull();
    expect(getMachineVitals().stale).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/machine-vitals-wiring.test.js --reporter=basic`
Expected: FAIL（JOBS 里找不到 machine-vitals）

- [ ] **Step 3: commit-1**

```bash
git add packages/brain/src/__tests__/machine-vitals-wiring.test.js
git commit -m "test(brain): machine-vitals scheduler 接线 failing test（beeba317 T5）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: 实现接线**

scheduler-jobs.js：import 区加 `import { sampleMachineVitals } from './machine-vitals.js';`，JOBS 数组（guard-drill 行后）加：

```js
  { name: 'machine-vitals', needsPool: false, timeoutMs: DEFAULT_TIMEOUT_MS, handler: sampleMachineVitals, description: '本机体征采样（docker容器数/VM内存/盘，60s，harness admission 数据源，beeba317）' },
```

capacity-budget.js：import 区加 `import { getMachineVitals } from '../machine-vitals.js';`，GET 路由响应对象（return/res.json 处）加一个字段：

```js
    machine_vitals: getMachineVitals(),
```

- [ ] **Step 5: 跑测试变绿**

Run: `cd packages/brain && npx vitest run src/__tests__/machine-vitals-wiring.test.js src/__tests__/scheduler-jobs.test.js --reporter=basic`
（scheduler-jobs 既有测试文件名以 `ls packages/brain/src/__tests__/ | grep scheduler` 实况为准，存在则一并跑）
Expected: 全 PASS

- [ ] **Step 6: commit-2**

```bash
git add packages/brain/src/scheduler-jobs.js packages/brain/src/routes/capacity-budget.js
git commit -m "feat(brain): machine-vitals 挂 scheduler-jobs 60s 采样 + capacity-budget 暴露 machine_vitals 段（beeba317 T5）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: DevGate + 版本 bump + 受影响面回归

**Files:**
- Modify: `packages/brain/package.json`（1.266.0 → 1.267.0，以合并时主干实况为准 minor bump）+ `package-lock.json` 同步
- Modify: `DEFINITION.md`（若 facts-check 报 dispatcher 常量相关断言）

**Interfaces:**
- Consumes: 全部前序 task
- Produces: DevGate 三闸全绿、版本同步

- [ ] **Step 1: DevGate 三连**

```bash
cd /Users/administrator/worktrees/cecelia/slot-alloc-consolidation
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/engine/scripts/devgate/check-dod-mapping.cjs
```

Expected: facts-check 若因删除 `MAX_CONCURRENT_HARNESS_INITIATIVES` 报错 → 同步修 DEFINITION.md 对应段；version-sync 在 bump 后重跑通过。

- [ ] **Step 2: 版本 bump**

```bash
cd packages/brain && npm version minor --no-git-tag-version   # 1.266.0 → 1.267.0（以实况为准）
cd .. && bash scripts/check-version-sync.sh                    # 确认四处同步，报错处逐一对齐
```

- [ ] **Step 3: 受影响面全量回归（分批防 OOM）**

```bash
cd packages/brain
npx vitest run src/__tests__/machine-vitals.test.js src/__tests__/account-available-count.test.js src/__tests__/harness-slot-check.test.js --reporter=basic
npx vitest run src/__tests__/dispatcher-harness-concurrency-cap.test.js src/__tests__/dispatcher-resume-cap-exempt.test.js src/__tests__/dispatcher.test.js src/__tests__/dispatcher-initiative-lock.test.js src/__tests__/dispatcher-circuit-harness-exempt.test.js --reporter=basic
npx vitest run src/__tests__/slot-allocator.test.js src/__tests__/slot-buffer.test.js src/__tests__/slot-accounting.test.js src/__tests__/machine-vitals-wiring.test.js --reporter=basic
node --check src/server.js
```

Expected: 全 PASS + syntax OK

- [ ] **Step 4: commit**

```bash
git add -A
git commit -m "chore(brain): bump 1.267.0——harness 派发判定换轨 slot-allocator 动态cap（beeba317 T6）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 交付后验收（PR merge + 部署后，容器内实弹，写进 PR 验证记录）

1. `docker logs cecelia-node-brain | grep slot_check` 出现全维行（containers/inflight/cap 三分量/verdict）
2. `curl -s localhost:5221/api/brain/capacity-budget | jq .machine_vitals` 非空且 stale=false
3. proven-to-fire：容器内 `chmod 000 /var/run/docker.sock`（或等效弄坏 docker 访问）→ 观察下轮采样 error 进缓存、harness 派发 deny:vitals_error → 恢复权限 → 派发恢复。截图/日志进验证记录
4. 复现主场景：多任务等 CI（in_progress 高）但活容器少时，新 harness 任务被正常派发
