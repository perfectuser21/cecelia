# 调度 job 入运行舱 + notion-gtd-sync 整轮有界 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Brain 的 48 个 scheduler job 自动进 `ops_workflows`（source=scheduler）并有真实活性；notion-gtd-sync 整轮有总超时、记录卡在哪一步；卡死 16 分钟内红灯 + 告警。

**Architecture:** 活性来源是 `working_memory` 哨兵 + handler 自报 `liveness_at`；新 job `scheduler-liveness`（独立模块 `ops-scheduler-liveness.js`，JOBS 经注入不 import）每 60s 把哨兵翻译成 `ops_workflows` 行并在翻转到 dead 时 `raiseAlert`；notion-gtd-sync 用 `Promise.race` 加整轮超时并暴露当前步名；pg 客户端加 `query_timeout` 让唯一无界 await 变有界。

**Tech Stack:** Node ESM、node-pg 8.19 / pg-pool 3.12、vitest（fake timers）、PostgreSQL。

设计文档：`docs/superpowers/specs/2026-09-24-scheduler-jobs-ops-cockpit-liveness-design.md`。Brain task `50a2c256`。

> **执行中修订（以设计文档为准，本计划不逐段回改）**：
> - Task 6：`scheduler-liveness` 改放 JOBS **末尾**（不是 ops-notion-push 之前）——放中间会让后排 job 在停机 >15 分钟重启后的首轮被误判 dead 再"恢复"；测试断言改为最后一项。并注入 `self: 'scheduler-liveness'`，自身以当前时刻计活。scheduler-jobs.test.js 部分 mock 掉 ops-collector / openclaw-guards（原用例真跑 ssh/docker 55s，且会碰生产网关）。
> - Task 5：失联翻转按轮合并一条 Bark（无 token 兜底 P1），恢复 P2；`lastRunAt = liveness_at ?? at`（不看 ok）；WHERE 加 `silent_sec` 增量 ≥600 条件；下线 job 置 cold 并清 silent_sec；整函数 try/catch 写 `classifyError` 心跳；新增 pg 集成测试。
> - Task 3：`onStep` 按轮次门控；`isAbandoned()` 步边界停下；超时 env 非法回落默认；`liveness_at = lastCompletedAt ?? loopStartedAt`。
> - 新增 Task 10：`dispatchOpenClawFromNotion` 反查 ops_workflows 只认 `source='n8n'`。

**全局规则**
- 分支 `cp-09241015-scheduler-jobs-ops-cockpit`，工作树 `/Users/administrator/worktrees/cecelia/session-5d77803f`。
- 测试命令一律在 `packages/brain` 下：`npx vitest run src/__tests__/<file> --reporter=dot`。
- 每个 Task 两次 commit：commit-1 只含 failing test，commit-2 含实现。commit 信息 Conventional Commits，结尾加 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。
- **禁碰版本五件套**（`packages/brain/package.json` 版本、两处 `package-lock.json`、`.brain-versions`、`DEFINITION.md` 版本行）。版本条目走 Task 8 的碎片文件。
- 不新建 markdown（计划/设计已存在）。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `packages/brain/src/ops-liveness.js` | 新增 `classifyDeclaredLiveness`（声明间隔的活性判定，不走冷启动门槛） |
| `packages/brain/src/db-config.js` | `DB_DEFAULTS.query_timeout` |
| `packages/brain/src/notion-gtd-sync.js` | 整轮超时、当前步名、`liveness_at` |
| `packages/brain/src/scheduler-jobs.js` | 哨兵 record 带 `liveness_at`；`livenessIntervalSec`；注册 `scheduler-liveness` job（注入 JOBS） |
| `packages/brain/src/ops-scheduler-liveness.js`（新） | 哨兵 → `ops_workflows(source='scheduler')` upsert、降噪、翻转告警、心跳 |
| `packages/brain/src/ops-collector.js` | 导出 `writeHeartbeat`（复用，不复制） |
| `packages/brain/src/routing/cheap-gates.js` | registry 只取 `source='n8n'` |
| `changes/cp-09241015-scheduler-jobs-ops-cockpit.md` | 版本碎片 |

---

### Task 1: `classifyDeclaredLiveness`

**Files:**
- Modify: `packages/brain/src/ops-liveness.js`
- Test: `packages/brain/src/__tests__/ops-liveness.test.js`

- [ ] **Step 1: 写 failing test**（追加到 `ops-liveness.test.js` 末尾）

```js
import { classifyDeclaredLiveness } from '../ops-liveness.js';

describe('classifyDeclaredLiveness — 声明间隔的活性（scheduler job 用）', () => {
  const now = Date.parse('2026-09-24T01:00:00Z');
  const ago = (sec) => new Date(now - sec * 1000).toISOString();

  it('30s 间隔：阈值 warn=300s（下限）/ dead=900s（下限）', () => {
    const r = classifyDeclaredLiveness({ lastRunAt: ago(10), intervalSec: 30, now });
    expect(r).toEqual({ liveness: 'ok', silent_sec: 10, warn_after_sec: 300, dead_after_sec: 900 });
  });

  it('静默 ≥ warn 判 warn，≥ dead 判 dead', () => {
    expect(classifyDeclaredLiveness({ lastRunAt: ago(301), intervalSec: 30, now }).liveness).toBe('warn');
    expect(classifyDeclaredLiveness({ lastRunAt: ago(900), intervalSec: 30, now }).liveness).toBe('dead');
  });

  it('不受运行次数影响（声明间隔不是统计估计，没有冷启动门槛）', () => {
    const r = classifyDeclaredLiveness({ lastRunAt: ago(5), intervalSec: 60, now });
    expect(r.liveness).toBe('ok');
  });

  it('没有 lastRunAt → cold，阈值仍透出', () => {
    const r = classifyDeclaredLiveness({ lastRunAt: null, intervalSec: 60, now });
    expect(r).toEqual({ liveness: 'cold', silent_sec: null, warn_after_sec: 300, dead_after_sec: 1200 });
  });

  it('间隔非法（0/负/NaN）→ 按 60s 兜底', () => {
    expect(classifyDeclaredLiveness({ lastRunAt: ago(1), intervalSec: 0, now }).dead_after_sec).toBe(1200);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/ops-liveness.test.js --reporter=dot`
Expected: FAIL，`classifyDeclaredLiveness is not a function` / 不是导出。

- [ ] **Step 3: commit-1（只含测试）**

```bash
git add packages/brain/src/__tests__/ops-liveness.test.js
git commit -m "test(brain): classifyDeclaredLiveness 声明间隔活性判定（Red）"
```

- [ ] **Step 4: 实现**（追加到 `packages/brain/src/ops-liveness.js` 末尾）

```js
/**
 * 声明间隔的活性判定（scheduler job 用）。
 * 与 classifyLiveness 同一套阈值公式，但间隔来自代码声明而非运行历史统计，
 * 所以**不走 COLD_START_RUNS 冷启动门槛**——一个 30s 的循环刚起就该按 30s 的尺子量。
 * 起因：2026-09-24 notion-gtd-sync 内层循环卡死 8.4h，该 job 不在 ops_workflows，任何尺子都没量它。
 * @param {{lastRunAt:*, intervalSec:number, now?:number}} p
 */
export function classifyDeclaredLiveness({ lastRunAt, intervalSec, now = Date.now() } = {}) {
  const interval = Number.isFinite(intervalSec) && intervalSec > 0 ? intervalSec : 60;
  const warnAfter = Math.round(Math.max(interval * WARN_MULTIPLIER, WARN_FLOOR_SEC));
  const deadAfter = Math.round(Math.min(Math.max(interval * DEAD_MULTIPLIER, DEAD_FLOOR_SEC), DEAD_CEIL_SEC));
  const lastMs = lastRunAt == null ? NaN : toMs(lastRunAt);
  if (!Number.isFinite(lastMs)) {
    return { liveness: 'cold', silent_sec: null, warn_after_sec: warnAfter, dead_after_sec: deadAfter };
  }
  const silentSec = Math.round((now - lastMs) / 1000);
  let liveness = 'ok';
  if (silentSec >= deadAfter) liveness = 'dead';
  else if (silentSec >= warnAfter) liveness = 'warn';
  return { liveness, silent_sec: silentSec, warn_after_sec: warnAfter, dead_after_sec: deadAfter };
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/ops-liveness.test.js --reporter=dot`
Expected: PASS（全部）。

- [ ] **Step 6: commit-2**

```bash
git add packages/brain/src/ops-liveness.js
git commit -m "feat(brain): classifyDeclaredLiveness — 声明间隔活性判定，不走冷启动门槛"
```

---

### Task 2: `DB_DEFAULTS.query_timeout`

**Files:**
- Modify: `packages/brain/src/db-config.js:40-50`
- Test: `packages/brain/src/__tests__/db-config.test.js`

- [ ] **Step 1: 写 failing test**（追加到 `describe('db-config')` 内）

```js
  it('query_timeout 默认 10 分钟：整轮唯一无界的 await 是 pg 查询（09-24 gtd 循环卡死案）', async () => {
    const { DB_DEFAULTS } = await import('../db-config.js');
    expect(DB_DEFAULTS.query_timeout).toBe(parseInt(process.env.DB_QUERY_TIMEOUT_MS || '600000', 10));
    expect(typeof DB_DEFAULTS.query_timeout).toBe('number');
    expect(DB_DEFAULTS.query_timeout).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/db-config.test.js --reporter=dot`
Expected: FAIL，`expected undefined to be 600000`。

- [ ] **Step 3: commit-1**

```bash
git add packages/brain/src/__tests__/db-config.test.js
git commit -m "test(brain): DB_DEFAULTS.query_timeout 默认 10 分钟（Red）"
```

- [ ] **Step 4: 实现**（`db-config.js` 的 `DB_DEFAULTS`，在 `connectionTimeoutMillis` 之后加一行）

```js
  connectionTimeoutMillis: parseInt(process.env.DB_CONN_TIMEOUT_MS || '5000', 10),
  // 客户端级查询超时（node-pg query_timeout，经 pg-pool 透传到 Client）。
  // 2026-09-24：notion-gtd-sync 一轮里某个 await 永不返回，循环卡死 8.4h——整轮唯一无界的
  // 就是 pg 查询（statement_timeout=0、keepalive 7200s）。超时后 pool 丢弃该连接，半死连接随之清出。
  // 取 10 分钟而非更短：主 pool 同时跑启动 runMigrations 与 preview-destroyer 的 pg_advisory_lock 等待。
  query_timeout: parseInt(process.env.DB_QUERY_TIMEOUT_MS || '600000', 10),
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/db-config.test.js src/__tests__/db-config-guard.test.js src/__tests__/db-config-dev-guard.test.js --reporter=dot`
Expected: PASS。

- [ ] **Step 6: commit-2**

```bash
git add packages/brain/src/db-config.js
git commit -m "fix(brain): pg 客户端加 query_timeout（默认 10min），整轮唯一无界 await 变有界"
```

---

### Task 3: notion-gtd-sync 整轮超时 + 当前步名 + `liveness_at`

**Files:**
- Modify: `packages/brain/src/notion-gtd-sync.js:326-405`
- Test: `packages/brain/src/__tests__/scheduler-jobs-gtd-sync.test.js`

- [ ] **Step 1: 写 failing test**（追加到 `describe('notion-gtd-sync 调度')` 内，复现 09-24 事故）

```js
  it('一轮永不返回 → 超过整轮超时后释放 inFlight、下一次 tick 真的再跑、lastRun 记 round_timeout+步名、liveness_at 不前进（09-24 卡死复现）', async () => {
    vi.useFakeTimers();
    try {
      const { ensureGtdSyncLoop, gtdSyncJobHandler } = await import('../notion-gtd-sync.js');
      let tick;
      const setIntervalFn = vi.fn((cb) => { tick = cb; return { unref: vi.fn() }; });
      const env = { QIUMI_SYNC_ENABLED: 'true', QIUMI_SYNC_SINCE: '2026-09-23T00:00:00.000Z', QIUMI_SYNC_ROUND_TIMEOUT_MS: '1000' };
      const hung = new Promise(() => {}); // 第一轮：某步永不返回
      const runOnce = vi.fn()
        .mockImplementationOnce(async (_pool, opts) => { opts.onStep?.('入账'); return hung; })
        .mockResolvedValueOnce({ zhToEn: {}, enToZh: {}, ingest: {}, stops: {}, push: {}, at: '2026-09-24T02:00:00.000Z' });
      ensureGtdSyncLoop({ query: vi.fn() }, { env, setIntervalFn, runOnce });

      const first = tick();               // 第一轮开始，挂住
      await vi.advanceTimersByTimeAsync(1001);
      await first;                        // 超时兜底让回调返回
      let out = await gtdSyncJobHandler({ query: vi.fn() }, { env, setIntervalFn });
      expect(out.lastRun).toMatchObject({ error: 'round_timeout', step: '入账' });
      expect(out.liveness_at).toBeNull(); // 超时的那一轮不算活

      await tick();                       // inFlight 已释放 → 第二轮真的跑
      expect(runOnce).toHaveBeenCalledTimes(2);
      out = await gtdSyncJobHandler({ query: vi.fn() }, { env, setIntervalFn });
      expect(out.lastRun.at).toBe('2026-09-24T02:00:00.000Z');
      expect(out.liveness_at).toBe('2026-09-24T02:00:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it('runGtdSyncOnce 每步前回调 onStep（超时时才能说出卡在哪）', async () => {
    const mod = await import('../notion-gtd-sync.js');
    const steps = [];
    const ok = (v) => vi.fn().mockResolvedValue(v);
    await mod.runGtdSyncOnce({ query: vi.fn() }, {
      token: 'tok', env: {}, onStep: (s) => steps.push(s),
      syncZhToEn: ok({}), syncEnToZh: ok({}), pullMarked: ok({}), applyOwnerStops: ok({}), pushQiumiStatus: ok({}),
    });
    expect(steps).toEqual(['zh→en', 'en→zh', '入账', '急停', '回写', null]);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/scheduler-jobs-gtd-sync.test.js --reporter=dot`
Expected: 两条新用例 FAIL（第一条：超时后 `lastRun` 无 `round_timeout`、`runOnce` 只调 1 次；第二条：`steps` 为空）。

- [ ] **Step 3: commit-1**

```bash
git add packages/brain/src/__tests__/scheduler-jobs-gtd-sync.test.js
git commit -m "test(brain): notion-gtd-sync 一轮永不返回致 inFlight 永真（09-24 卡死复现，Red）"
```

- [ ] **Step 4: 实现** — 替换 `notion-gtd-sync.js` 从 `export async function runGtdSyncOnce` 到文件末尾：

```js
export async function runGtdSyncOnce(pool, {
  token = null, env = process.env, notionReq = defaultNotionReq,
  syncZhToEn: zhToEnFn = syncZhToEn, syncEnToZh: enToZhFn = syncEnToZh,
  pullMarked = pullMarkedNotionTasks, applyOwnerStops: stopsFn = applyOwnerStops,
  pushQiumiStatus: pushFn = pushQiumiStatus, onStep = () => {},
} = {}) {
  // 取 token 也算一步：凭据没配/取不到时整轮五步统一报 notion_token_missing 并返回，
  // 不抛——抛出去会穿过定时回调变成未捕获 rejection，整个循环从此哑掉。
  let tok = token;
  if (!tok) {
    try {
      tok = getToken();
    } catch (err) {
      console.warn(`[notion-gtd] 取 Notion token 失败: ${err.message}`);
      tok = null;
    }
  }
  if (!tok) {
    const e = Object.freeze({ error: 'notion_token_missing' });
    return { zhToEn: e, enToZh: e, ingest: e, stops: e, push: e, at: new Date().toISOString() };
  }
  const sinceIso = env.QIUMI_SYNC_SINCE || null;
  const common = { notionReq, fetchPageContent: fetchNotionPageContent };
  // 每步前上报步名：整轮超时时唯一能说出"卡在哪"的证据（09-24 卡死 8.4h 事后无法复原就是缺这个）
  onStep('zh→en');
  const zhToEn = await safe('zh→en', () => zhToEnFn(pool, tok, { ...common, sinceIso }));
  onStep('en→zh');
  const enToZh = await safe('en→zh', () => enToZhFn(pool, tok, { ...common, sinceIso }));
  onStep('入账');
  const ingest = await safe('入账', () => pullMarked(pool, tok, { env }));
  onStep('急停');
  const stops = await safe('急停', () => stopsFn(pool, tok, { notionReq }));
  onStep('回写');
  const push = await safe('回写', () => pushFn(pool, tok, { notionReq }));
  onStep(null);
  return { zhToEn, enToZh, ingest, stops, push, at: new Date().toISOString() };
}

let loopTimer = null;
let lastRun = null;
/** 最后一轮**真正跑完**的时刻；超时的轮不推进。活性只认它，不认哨兵时间戳（handler 立即返回，哨兵每分钟都新）。 */
let lastCompletedAt = null;

/** 模块级单例重置（测试用；vitest 侧一般靠 vi.resetModules()）。 */
export function __resetGtdSyncLoopForTest() { loopTimer = null; lastRun = null; lastCompletedAt = null; }

const ISO_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;
const validSince = (v) => typeof v === 'string' && ISO_RE.test(v.trim()) && !Number.isNaN(Date.parse(v.trim()));

export const DEFAULT_ROUND_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * 30s 自循环（幂等）。默认关闭：QIUMI_SYNC_ENABLED!=='true' 时既不起定时器也不碰 Notion。
 * 与 us-vps 旧脚本并存期的起算点 QIUMI_SYNC_SINCE 必须由切换脚本写死进部署 env：
 * 缺失或非法即 fail-closed 不起循环。进程自己拿"当下"补一个，等于每次重启都换窗口——
 * 重启前那段时间建的行会被静默漏掉，且两台机器各算各的，账对不上。
 *
 * 整轮总超时（QIUMI_SYNC_ROUND_TIMEOUT_MS，默认 5min）：2026-09-24 00:41Z 一轮里某个 await
 * 永不返回，inFlight 永真，之后每 30s 的触发全部跳过、handler 仍回报 running，卡死 8.4h 无人知。
 * 单请求有超时不等于整轮有超时；超时即释放 inFlight、记下卡在哪一步，迟到的结果丢弃。
 */
export function ensureGtdSyncLoop(pool, {
  env = process.env, setIntervalFn = setInterval, setTimeoutFn = setTimeout, intervalMs,
  runOnce = runGtdSyncOnce,
} = {}) {
  if (env.QIUMI_SYNC_ENABLED !== 'true') return { started: false, running: false };
  if (loopTimer) return { started: false, running: true };
  if (!validSince(env.QIUMI_SYNC_SINCE)) {
    console.warn(`[notion-gtd] 未起循环：QIUMI_SYNC_SINCE 缺失或非法 ISO（当前 ${env.QIUMI_SYNC_SINCE ?? '<未设>'}），并存期起算点必须由部署 env 写死`);
    return { started: false, running: false, reason: 'missing_since' };
  }
  const ms = intervalMs ?? Number(env.QIUMI_SYNC_INTERVAL_MS || 30_000);
  const roundTimeoutMs = Number(env.QIUMI_SYNC_ROUND_TIMEOUT_MS || DEFAULT_ROUND_TIMEOUT_MS);
  let inFlight = false;
  let currentStep = null;
  let round = 0;
  loopTimer = setIntervalFn(async () => {
    if (inFlight) return; // 重入守卫：慢轮（Notion 退避）不许叠加
    inFlight = true;
    round += 1;
    const myRound = round;
    let timer = null;
    const timeout = new Promise((resolve) => {
      timer = setTimeoutFn(() => resolve({ __roundTimedOut: true }), roundTimeoutMs);
      if (typeof timer?.unref === 'function') timer.unref();
    });
    try {
      const result = await Promise.race([
        runOnce(pool, { env, onStep: (s) => { currentStep = s; } }),
        timeout,
      ]);
      if (result?.__roundTimedOut) {
        const at = new Date().toISOString();
        console.warn(`[notion-gtd] 整轮超时 ${roundTimeoutMs}ms，卡在步骤「${currentStep ?? '未知'}」，释放 inFlight（第 ${myRound} 轮）`);
        lastRun = { error: 'round_timeout', step: currentStep, at };
      } else {
        lastRun = result;
        lastCompletedAt = result?.at ?? new Date().toISOString();
      }
    } catch (err) {
      // 兜底：runGtdSyncOnce 已逐步吞错，这里防的是它自己意外抛——
      // 定时回调里的 rejection 没人接，会变成未捕获异常把循环整死。
      console.warn('[notion-gtd] 本轮失败:', err.message);
      lastRun = { error: err.message, at: new Date().toISOString() };
    } finally {
      clearTimeout(timer);
      currentStep = null;
      inFlight = false;
    }
  }, ms);
  if (typeof loopTimer?.unref === 'function') loopTimer.unref();
  console.log(`[notion-gtd] 同步循环已启动（${ms}ms，since=${env.QIUMI_SYNC_SINCE}，整轮超时 ${roundTimeoutMs}ms）`);
  return { started: true, running: true };
}

/** scheduler-jobs handler：只确保循环在跑并回报上次结果，立即返回，不阻塞 60s 串行轮。liveness_at = 最后一轮真正跑完的时刻。 */
export async function gtdSyncJobHandler(pool, opts = {}) {
  const s = ensureGtdSyncLoop(pool, opts);
  return { loop: s.running ? 'running' : 'disabled', lastRun, liveness_at: lastCompletedAt };
}
```

注意：超时后迟到的 `runOnce` 结果会被 `Promise.race` 丢弃（不再写 `lastRun`），因为 race 已 settle；`lastCompletedAt` 也不会被迟到结果推进。这是刻意的——超时的轮不算活。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/scheduler-jobs-gtd-sync.test.js src/__tests__/notion-gtd-sync.test.js src/__tests__/notion-gtd-sync-push-and-stops.test.js --reporter=dot`
Expected: PASS（含既有用例；「定时回调吞掉本轮异常」用例仍过——超时 timer 用 `setTimeoutFn` 默认 `setTimeout`，测试里不推进不影响）。

- [ ] **Step 6: commit-2**

```bash
git add packages/brain/src/notion-gtd-sync.js
git commit -m "fix(brain): notion-gtd-sync 整轮总超时+步名+liveness_at，超时释放 inFlight（09-24 卡死 8.4h 根治）"
```

---

### Task 4: 哨兵 record 带 `liveness_at`，gtd job 声明 `livenessIntervalSec`

**Files:**
- Modify: `packages/brain/src/scheduler-jobs.js:132`（gtd 条目）、`:186-215`（`runSchedulerJobsOnce`）
- Test: `packages/brain/src/__tests__/scheduler-jobs.test.js`

- [ ] **Step 1: 写 failing test**（追加到 `describe('scheduler-jobs 注册表')` 内）

```js
  it('handler 返回 liveness_at → 哨兵 record 原样带上（活性只认 handler 自报的完成时刻）', async () => {
    const pool = makePool();
    const jobs = [
      { name: 'self-report', needsPool: false, timeoutMs: 1000, handler: vi.fn().mockResolvedValue({ loop: 'running', liveness_at: '2026-09-24T02:00:00.000Z' }) },
      { name: 'plain', needsPool: false, timeoutMs: 1000, handler: vi.fn().mockResolvedValue({ ok: true }) },
    ];
    await runSchedulerJobsOnce(pool, jobs);
    const rec = (name) => JSON.parse(pool.query.mock.calls.find(([sql, p]) => sql.includes('working_memory') && p[0] === `${SENTINEL_KEY_PREFIX}${name}`)[1][1]);
    expect(rec('self-report')).toMatchObject({ ok: true, liveness_at: '2026-09-24T02:00:00.000Z' });
    expect(rec('plain')).not.toHaveProperty('liveness_at');
  });

  it('notion-gtd-sync 声明 livenessIntervalSec=30（内层 30s 循环的尺子）', () => {
    const job = JOBS.find((j) => j.name === 'notion-gtd-sync');
    expect(job.livenessIntervalSec).toBe(30);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/scheduler-jobs.test.js --reporter=dot`
Expected: 两条新用例 FAIL。

- [ ] **Step 3: commit-1**

```bash
git add packages/brain/src/__tests__/scheduler-jobs.test.js
git commit -m "test(brain): 哨兵 record 带 liveness_at + gtd job 声明 livenessIntervalSec（Red）"
```

- [ ] **Step 4: 实现**

`scheduler-jobs.js:132` gtd 条目加字段：

```js
  { name: 'notion-gtd-sync', needsPool: true, timeoutMs: 30_000, livenessIntervalSec: 30, handler: (pool) => gtdSyncJobHandler(pool), description: '秋米中文GTD表↔英文Tasks库双向同步+入账+急停+回写（QIUMI_SYNC_ENABLED 门，handler 只确保 30s 自循环在跑并回报上次结果；活性按 handler 自报 liveness_at 算，09-24 卡死案；决策 b8abd28c，task b7efdbff）' },
```

`runSchedulerJobsOnce` 里成功分支改为：

```js
      } else {
        record = { at, ok: true, detail: summarize(result) };
        // handler 自报的完成时刻（如 gtdSyncJobHandler 的内层循环最后一轮）。立即返回型 handler 的
        // 哨兵 `at` 每分钟都新，内层死了也新；scheduler-liveness 只认这个字段算活性。
        if (typeof result?.liveness_at === 'string') record.liveness_at = result.liveness_at;
      }
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/scheduler-jobs.test.js src/__tests__/scheduler-jobs-gtd-sync.test.js --reporter=dot`
Expected: PASS。

- [ ] **Step 6: commit-2**

```bash
git add packages/brain/src/scheduler-jobs.js
git commit -m "feat(brain): 哨兵 record 透传 handler 自报 liveness_at；gtd job 声明 30s 活性尺"
```

---

### Task 5: 新模块 `ops-scheduler-liveness.js`

**Files:**
- Create: `packages/brain/src/ops-scheduler-liveness.js`
- Modify: `packages/brain/src/ops-collector.js:881`（`writeHeartbeat` 加 `export`）
- Test: `packages/brain/src/__tests__/ops-scheduler-liveness.test.js`（新）

- [ ] **Step 1: 写 failing test**

```js
import { describe, it, expect, vi } from 'vitest';
import { runSchedulerLiveness, SCHEDULER_SOURCE, SCHEDULER_MACHINE } from '../ops-scheduler-liveness.js';

const NOW = Date.parse('2026-09-24T01:00:00Z');
const iso = (secAgo) => new Date(NOW - secAgo * 1000).toISOString();
const KEY = 'scheduler_job_last_run:';

/** fakePool：记录 SQL；哨兵查询返回预置行；upsert 返回 RETURNING 行（旧 liveness 由 prev 表给） */
function fakePool({ sentinels = {}, prev = {} } = {}) {
  const queries = [];
  return {
    queries,
    query: async (sql, params) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      queries.push({ sql: s, params });
      if (s.includes('FROM working_memory')) {
        return { rows: Object.entries(sentinels).map(([name, rec]) => ({ key: `${KEY}${name}`, value_json: rec })) };
      }
      if (s.includes('INSERT INTO ops_workflows')) {
        const wfId = params[0];
        const newLv = params[6];
        const old = prev[wfId] ?? null;
        // 模拟 WHERE 降噪：旧 liveness 相同且状态相同 → 不返回行
        if (old && old.liveness === newLv && old.last_run_status === params[4]) return { rows: [] };
        return { rows: [{ wf_id: wfId, liveness: newLv, prev_liveness: old?.liveness ?? null }] };
      }
      return { rows: [] };
    },
  };
}

const jobs = [
  { name: 'notion-gtd-sync', livenessIntervalSec: 30, timeoutMs: 30_000, description: 'gtd' },
  { name: 'ci-patrol', timeoutMs: 300_000, description: 'ci' },
];

describe('runSchedulerLiveness — 调度 job 入运行舱', () => {
  it('每个 job upsert 一行 source=scheduler、machine=us-vps、active=false，只写机器列', async () => {
    const pool = fakePool({ sentinels: { 'notion-gtd-sync': { at: iso(5), ok: true, liveness_at: iso(20) }, 'ci-patrol': { at: iso(5), ok: true } } });
    const r = await runSchedulerLiveness(pool, { jobs, now: NOW, raise: vi.fn() });
    const ups = pool.queries.filter((q) => q.sql.includes('INSERT INTO ops_workflows'));
    expect(ups).toHaveLength(2);
    for (const q of ups) {
      expect(q.sql).toContain(`'${SCHEDULER_SOURCE}'`);
      expect(q.sql).toMatch(/ON CONFLICT \(source, wf_id\) DO UPDATE/);
      for (const manual of ['owner_manual', 'note_manual', 'priority_manual', 'starred', 'enable_intent', 'dispatch']) {
        expect(q.sql).not.toContain(manual);
      }
      expect(q.params[1]).toBe(SCHEDULER_MACHINE);
    }
    expect(r).toMatchObject({ ok: true, jobs: 2 });
  });

  it('活性只认 liveness_at（handler 自报），没有才退回哨兵 at；30s 尺子老于 900s → dead', async () => {
    const pool = fakePool({ sentinels: {
      'notion-gtd-sync': { at: iso(5), ok: true, liveness_at: iso(901) }, // 哨兵每分钟都新，内层死了
      'ci-patrol': { at: iso(5), ok: true },
    } });
    await runSchedulerLiveness(pool, { jobs, now: NOW, raise: vi.fn() });
    const byWf = Object.fromEntries(pool.queries.filter((q) => q.sql.includes('INSERT INTO ops_workflows')).map((q) => [q.params[0], q.params]));
    expect(byWf['notion-gtd-sync'][6]).toBe('dead');
    expect(byWf['notion-gtd-sync'][5]).toBe(30);    // baseline_interval_sec = 声明间隔
    expect(byWf['ci-patrol'][6]).toBe('ok');
    expect(byWf['ci-patrol'][5]).toBe(60);
  });

  it('哨兵 ok:false → last_run_status=error；timedOut → timeout；缺哨兵 → cold', async () => {
    const pool = fakePool({ sentinels: { 'notion-gtd-sync': { at: iso(5), ok: false, error: 'x' } } });
    await runSchedulerLiveness(pool, { jobs: [...jobs, { name: 'hung', timeoutMs: 1000 }], now: NOW, raise: vi.fn() });
    const byWf = Object.fromEntries(pool.queries.filter((q) => q.sql.includes('INSERT INTO ops_workflows')).map((q) => [q.params[0], q.params]));
    expect(byWf['notion-gtd-sync'][4]).toBe('error');
    expect(byWf['ci-patrol'][6]).toBe('cold');
    expect(byWf['hung'][6]).toBe('cold');
  });

  it('翻转到 dead 才告警（去重靠翻转），恢复也告一次，未翻转不告', async () => {
    const raise = vi.fn().mockResolvedValue(undefined);
    const pool = fakePool({
      sentinels: { 'notion-gtd-sync': { at: iso(5), ok: true, liveness_at: iso(2000) }, 'ci-patrol': { at: iso(5), ok: true } },
      prev: { 'notion-gtd-sync': { liveness: 'warn', last_run_status: 'success' }, 'ci-patrol': { liveness: 'ok', last_run_status: 'success' } },
    });
    await runSchedulerLiveness(pool, { jobs, now: NOW, raise });
    expect(raise).toHaveBeenCalledTimes(1);
    expect(raise.mock.calls[0][0]).toBe('P1');
    expect(raise.mock.calls[0][1]).toBe('scheduler_job_dead_notion-gtd-sync');
    expect(raise.mock.calls[0][2]).toMatch(/notion-gtd-sync/);
  });

  it('降噪：UPDATE 带 WHERE，只在 liveness/last_run_status 变化或 last_run_at 前进 ≥10min 时刷新 updated_at', async () => {
    const pool = fakePool({ sentinels: { 'ci-patrol': { at: iso(5), ok: true } } });
    await runSchedulerLiveness(pool, { jobs: [jobs[1]], now: NOW, raise: vi.fn() });
    const up = pool.queries.find((q) => q.sql.includes('INSERT INTO ops_workflows'));
    expect(up.sql).toMatch(/DO UPDATE SET[\s\S]*WHERE ops_workflows\.liveness IS DISTINCT FROM EXCLUDED\.liveness/);
    expect(up.sql).toMatch(/interval '10 minutes'/);
  });

  it('写 scheduler 心跳；raise 抛错不影响返回', async () => {
    const pool = fakePool({ sentinels: { 'notion-gtd-sync': { at: iso(5), ok: true, liveness_at: iso(2000) } }, prev: { 'notion-gtd-sync': { liveness: 'ok', last_run_status: 'success' } } });
    const r = await runSchedulerLiveness(pool, { jobs: [jobs[0]], now: NOW, raise: vi.fn().mockRejectedValue(new Error('bark down')) });
    expect(r.ok).toBe(true);
    const hb = pool.queries.find((q) => q.sql.includes('ops_source_heartbeats'));
    expect(hb.params[0]).toBe(SCHEDULER_SOURCE);
    expect(hb.params[3]).toBe('ok');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/ops-scheduler-liveness.test.js --reporter=dot`
Expected: FAIL，模块不存在。

- [ ] **Step 3: commit-1**

```bash
git add packages/brain/src/__tests__/ops-scheduler-liveness.test.js
git commit -m "test(brain): scheduler job 入运行舱 + 活性 + 翻转告警（Red）"
```

- [ ] **Step 4: 导出 `writeHeartbeat`**（`ops-collector.js:881` 行首加 `export`）

```js
export async function writeHeartbeat(pool, source, host, status, reasonCode, lastError, collectedAt) {
```

- [ ] **Step 5: 新建 `packages/brain/src/ops-scheduler-liveness.js`**

```js
/**
 * ops-scheduler-liveness — Brain 自己的 scheduler job 入运行舱（决策 69cd802f，task 50a2c256）。
 *
 * 起因：2026-09-24 notion-gtd-sync 内层 30s 循环卡死 8.4h，运行舱与 Notion 驾驶舱全绿——
 * 48 个 JOBS 是 Brain 自己的 workflow，却从未进 ops_workflows，活性判定只对表里的行生效。
 * 入图不靠手填：这里把 working_memory 里的调度哨兵翻译成 ops_workflows(source='scheduler') 行。
 *
 * 三条纪律：
 *  1. 活性只认 handler 自报的 liveness_at（立即返回型 handler 的哨兵 `at` 每分钟都新，内层死了也新）；
 *     没自报的才退回哨兵 `at`。尺子用声明间隔（classifyDeclaredLiveness），不走冷启动门槛。
 *  2. 只写机器列。人工列（owner/note/priority/starred/enable_intent/dispatch）永不出现在 SET 里。
 *  3. 降噪：liveness / last_run_status 没变、last_run_at 前进不足 10 分钟就不刷 updated_at——
 *     否则 48 行每分钟都"变更"，把 pushOpsWorkflows 的 LIMIT 50 吃光并让 Notion 每轮 PATCH 48 页。
 *
 * JOBS 经 opts.jobs 注入，不 import scheduler-jobs.js（会成环：scheduler-jobs → 本模块 → scheduler-jobs；
 * 仓库先例 routes/sentinel.js 同样"不 import，避免拖入 handler 依赖链"）。
 */
import { classifyDeclaredLiveness } from './ops-liveness.js';
import { writeHeartbeat } from './ops-collector.js';
import { raise as defaultRaise } from './alerting.js';

export const SCHEDULER_SOURCE = 'scheduler';
export const SCHEDULER_MACHINE = 'us-vps';
const SENTINEL_PREFIX = 'scheduler_job_last_run:';
const DEFAULT_INTERVAL_SEC = 60; // 调度轮 LOOP_INTERVAL_MS

function statusOf(rec) {
  if (!rec) return null;
  if (rec.timedOut) return 'timeout';
  return rec.ok ? 'success' : 'error';
}

/** scheduler-jobs handler（needsPool:true）。opts.jobs 必传（注入 JOBS）；now/raise 供测试。 */
export async function runSchedulerLiveness(pool, { jobs = [], now = Date.now(), raise = defaultRaise } = {}) {
  const collectedAt = new Date(now).toISOString();
  const { rows } = await pool.query(
    `SELECT key, value_json FROM working_memory WHERE key LIKE $1`,
    [`${SENTINEL_PREFIX}%`],
  );
  const sentinels = new Map();
  for (const r of rows) {
    let rec = r.value_json;
    if (typeof rec === 'string') { try { rec = JSON.parse(rec); } catch { rec = null; } }
    sentinels.set(String(r.key).slice(SENTINEL_PREFIX.length), rec);
  }

  let flippedDead = 0; let recovered = 0;
  for (const job of jobs) {
    const rec = sentinels.get(job.name) ?? null;
    const intervalSec = Number.isFinite(job.livenessIntervalSec) && job.livenessIntervalSec > 0
      ? job.livenessIntervalSec : DEFAULT_INTERVAL_SEC;
    // 纪律 1：自报优先；超时/失败的哨兵不算活
    const lastRunAt = rec?.liveness_at ?? (rec?.ok ? rec.at : null) ?? null;
    const lv = classifyDeclaredLiveness({ lastRunAt, intervalSec, now });
    const meta = {
      kind: 'scheduler_job', description: job.description ?? '', timeoutMs: job.timeoutMs ?? null,
      livenessIntervalSec: intervalSec, last_error: rec?.error ?? null,
    };
    // 纪律 2：SET 里只有机器列。纪律 3：WHERE 降噪。RETURNING 带旧 liveness 供翻转告警。
    const { rows: changed } = await pool.query(
      `INSERT INTO ops_workflows (source, wf_id, name, active, machine, meta,
         last_run_at, last_run_status, baseline_interval_sec, liveness, silent_sec,
         warn_after_sec, dead_after_sec, liveness_at, updated_at)
       VALUES ('${SCHEDULER_SOURCE}', $1, $1, FALSE, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
       ON CONFLICT (source, wf_id) DO UPDATE SET
         name=EXCLUDED.name, active=FALSE, machine=EXCLUDED.machine, meta=EXCLUDED.meta,
         last_run_at=EXCLUDED.last_run_at, last_run_status=EXCLUDED.last_run_status,
         baseline_interval_sec=EXCLUDED.baseline_interval_sec, liveness=EXCLUDED.liveness,
         silent_sec=EXCLUDED.silent_sec, warn_after_sec=EXCLUDED.warn_after_sec,
         dead_after_sec=EXCLUDED.dead_after_sec, liveness_at=EXCLUDED.liveness_at, updated_at=EXCLUDED.updated_at
       WHERE ops_workflows.liveness IS DISTINCT FROM EXCLUDED.liveness
          OR ops_workflows.last_run_status IS DISTINCT FROM EXCLUDED.last_run_status
          OR ops_workflows.last_run_at IS NULL
          OR EXCLUDED.last_run_at - ops_workflows.last_run_at >= interval '10 minutes'
       RETURNING wf_id, liveness, (SELECT liveness FROM ops_workflows o WHERE o.source='${SCHEDULER_SOURCE}' AND o.wf_id=$1) AS prev_liveness`,
      // 下标固定（测试按下标断言）：[0]wf_id [1]machine [2]meta [3]last_run_at [4]last_run_status
      // [5]baseline_interval_sec [6]liveness [7]silent_sec [8]warn_after_sec [9]dead_after_sec [10]liveness_at/updated_at
      [job.name, SCHEDULER_MACHINE, JSON.stringify(meta), lastRunAt, statusOf(rec), intervalSec,
        lv.liveness, lv.silent_sec, lv.warn_after_sec, lv.dead_after_sec, collectedAt],
    );
    const row = changed[0];
    if (!row) continue;
    // 只在翻转时告警：ok/warn/cold → dead 一次，dead → 非 dead 一次
    if (row.liveness === 'dead' && row.prev_liveness !== 'dead') {
      flippedDead += 1;
      await raise('P1', `scheduler_job_dead_${job.name}`,
        `🔴 调度 job ${job.name} 失联：最后一轮 ${lastRunAt ?? '从未'}，静默 ${lv.silent_sec ?? '?'}s ≥ ${lv.dead_after_sec}s（尺子 ${intervalSec}s）`)
        .catch((e) => console.warn(`[scheduler-liveness] 告警失败 ${job.name}: ${e.message}`));
    } else if (row.prev_liveness === 'dead' && row.liveness !== 'dead') {
      recovered += 1;
      await raise('P2', `scheduler_job_recovered_${job.name}`, `🟢 调度 job ${job.name} 恢复（${row.liveness}）`)
        .catch((e) => console.warn(`[scheduler-liveness] 告警失败 ${job.name}: ${e.message}`));
    }
  }
  await writeHeartbeat(pool, SCHEDULER_SOURCE, SCHEDULER_MACHINE, 'ok', null, null, collectedAt);
  return { ok: true, jobs: jobs.length, flippedDead, recovered };
}
```

SQL 占位与数组一一对应（11 项）：`$1`→[0] wf_id/name，`$2`→[1] machine，`$3`→[2] meta，`$4`→[3] last_run_at，`$5`→[4] last_run_status，`$6`→[5] baseline_interval_sec，`$7`→[6] liveness，`$8`→[7] silent_sec，`$9`→[8] warn_after_sec，`$10`→[9] dead_after_sec，`$11`→[10] liveness_at/updated_at。测试里的下标与此一致。

`RETURNING` 里的子查询读的是本语句开始前的快照（Postgres 语义），所以 `prev_liveness` 拿到的是更新前的值，可用于翻转判定。

- [ ] **Step 6: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/ops-scheduler-liveness.test.js src/__tests__/ops-collector.test.js --reporter=dot`
Expected: PASS。

- [ ] **Step 7: commit-2**

```bash
git add packages/brain/src/ops-scheduler-liveness.js packages/brain/src/ops-collector.js packages/brain/src/__tests__/ops-scheduler-liveness.test.js
git commit -m "feat(brain): scheduler job 入运行舱——哨兵→ops_workflows(source=scheduler)，声明间隔活性+翻转告警+降噪"
```

---

### Task 6: 注册 `scheduler-liveness` job（注入 JOBS，排在 ops-notion-push 之前）

**Files:**
- Modify: `packages/brain/src/scheduler-jobs.js:45-59`（import）、`:129-130`（JOBS）
- Test: `packages/brain/src/__tests__/scheduler-jobs.test.js`

- [ ] **Step 1: 写 failing test**（追加到 `describe('scheduler-jobs 注册表')`；文件顶部 vi.mock 区追加一个 mock）

顶部 mock（与其他 handler mock 并列）：

```js
vi.mock('../ops-scheduler-liveness.js', () => ({
  runSchedulerLiveness: vi.fn().mockResolvedValue({ ok: true, jobs: 0, flippedDead: 0, recovered: 0 }),
}));
```

用例：

```js
  it('注册 scheduler-liveness，排在 ops-notion-push 之前，且把 JOBS 自身注入 handler（不 import 成环）', async () => {
    const { runSchedulerLiveness } = await import('../ops-scheduler-liveness.js');
    const names = JOBS.map((j) => j.name);
    expect(names.indexOf('scheduler-liveness')).toBeGreaterThan(-1);
    expect(names.indexOf('scheduler-liveness')).toBeLessThan(names.indexOf('ops-notion-push'));
    const pool = makePool();
    await runSchedulerJobsOnce(pool, JOBS.filter((j) => j.name === 'scheduler-liveness'));
    expect(runSchedulerLiveness).toHaveBeenCalledWith(pool, expect.objectContaining({ jobs: JOBS }));
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/scheduler-jobs.test.js --reporter=dot`
Expected: 新用例 FAIL（找不到 job）。

- [ ] **Step 3: commit-1**

```bash
git add packages/brain/src/__tests__/scheduler-jobs.test.js
git commit -m "test(brain): 注册 scheduler-liveness job 并注入 JOBS（Red）"
```

- [ ] **Step 4: 实现**

import 区（`:45` 之后）加：

```js
import { runSchedulerLiveness } from './ops-scheduler-liveness.js';
```

JOBS 里 `ops-notion-push`（`:130`）之前插入：

```js
  // 顺序要紧：先把 48 个 job 的哨兵翻成 ops_workflows 行，再推 Notion。JOBS 经闭包注入——
  // 本模块已 import ops-collector/notion-push-sync，反向 import 会成环（routes/sentinel.js 同款避坑）。
  { name: 'scheduler-liveness', needsPool: true, timeoutMs: 60_000, handler: (pool) => runSchedulerLiveness(pool, { jobs: JOBS }), description: 'Brain 调度 job 入运行舱：working_memory 哨兵→ops_workflows(source=scheduler)，活性按声明间隔算，翻转 dead 即 Bark（09-24 notion-gtd-sync 卡死 8.4h 无告警案，决策 69cd802f，task 50a2c256）' },
```

- [ ] **Step 5: 跑测试确认通过 + 全量 Brain 单测**

Run: `cd packages/brain && npx vitest run src/__tests__/scheduler-jobs.test.js --reporter=dot && npx vitest run --reporter=dot 2>&1 | tail -15`
Expected: PASS；全量无新增失败（既有 `scheduler_jobs_expected` 断言用 `JOBS.length`，自动跟随）。

- [ ] **Step 6: commit-2**

```bash
git add packages/brain/src/scheduler-jobs.js
git commit -m "feat(brain): 注册 scheduler-liveness job（注入 JOBS，排在 ops-notion-push 前）"
```

---

### Task 7: 便宜闸 registry 只取 n8n 行

**Files:**
- Modify: `packages/brain/src/routing/cheap-gates.js:15`
- Test: `packages/brain/src/routing/__tests__/cheap-gates.test.js`

- [ ] **Step 1: 写 failing test**（追加到 `describe('loadRegistryPool')`）

```js
  it('ops_workflows 只取 source=n8n（scheduler 行是 Brain 内部 job，job 名不能被当 workflowRef 命中）', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await loadRegistryPool(query);
    const wfSql = query.mock.calls.find(([sql]) => /FROM ops_workflows/.test(sql))[0];
    expect(wfSql).toMatch(/source = 'n8n'/);
    expect(wfSql).toMatch(/active = TRUE/);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/routing/__tests__/cheap-gates.test.js --reporter=dot`
Expected: 新用例 FAIL。

- [ ] **Step 3: commit-1**

```bash
git add packages/brain/src/routing/__tests__/cheap-gates.test.js
git commit -m "test(brain): 便宜闸 registry 只取 n8n 工作流（Red）"
```

- [ ] **Step 4: 实现**（`cheap-gates.js:15`）

```js
  // 只取 n8n 业务流程：ops_workflows 从 09-24 起也装 Brain 调度 job（source='scheduler'，active=FALSE），
  // 任务正文出现 ci-patrol / daily-backup 之类 job 名不能被当成 workflowRef 命中。
  const w = await query(`SELECT name, notion_id FROM ops_workflows WHERE active = TRUE AND source = 'n8n' ORDER BY name`);
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/routing/__tests__/ --reporter=dot`
Expected: PASS。

- [ ] **Step 6: commit-2**

```bash
git add packages/brain/src/routing/cheap-gates.js
git commit -m "fix(brain): 便宜闸 registry 只取 source=n8n，scheduler 行不进路由池"
```

---

### Task 8: 版本碎片 + DevGate + 全量测试

**Files:**
- Create: `changes/cp-09241015-scheduler-jobs-ops-cockpit.md`

- [ ] **Step 1: 写碎片**

```markdown
## Brain {VERSION} — 调度 job 入运行舱 + notion-gtd-sync 整轮有界

- 新 job `scheduler-liveness`：working_memory 哨兵 → `ops_workflows(source='scheduler')`，活性按声明间隔算（`classifyDeclaredLiveness`），翻转 dead 即 P1 告警、恢复 P2；只写机器列，10 分钟降噪。
- `notion-gtd-sync` 整轮总超时（`QIUMI_SYNC_ROUND_TIMEOUT_MS`，默认 5min）+ 当前步名 + `liveness_at`；超时释放 inFlight（09-24 卡死 8.4h 根治）。
- 哨兵 record 透传 handler 自报 `liveness_at`；JOBS 条目可声明 `livenessIntervalSec`。
- pg 客户端 `query_timeout`（`DB_QUERY_TIMEOUT_MS`，默认 10min）。
- 便宜闸 registry 只取 `source='n8n'`。
- 决策 69cd802f / task 50a2c256。
```

- [ ] **Step 2: DevGate 三闸 + 全量 Brain 测试**

Run（仓库根）：

```bash
node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs && (cd packages/brain && npx vitest run --reporter=dot 2>&1 | tail -20)
```

Expected: 三闸绿；vitest 无失败。

- [ ] **Step 3: commit**

```bash
git add changes/cp-09241015-scheduler-jobs-ops-cockpit.md
git commit -m "chore(brain): 版本碎片——调度 job 入运行舱 + gtd 整轮有界"
```

---

### Task 9: 清理与自检

- [ ] **Step 1: 检查无调试残留**

Run: `git diff main...HEAD -- packages/brain/src | grep -nE "console\.log\(|debugger|TODO" ; echo "exit=$?"`
Expected: 只允许既有风格的 `console.log('[notion-gtd] 同步循环已启动…')`（原本就有）；无新增调试输出。

- [ ] **Step 2: 确认 commit 顺序**（每个 Task 先 test 后 impl）

Run: `git log --oneline main..HEAD`
Expected: 交替出现 `test(...)（Red）` → `feat/fix(...)`。

完成后交给 superpowers:finishing-a-development-branch（Option 2：push + PR），PR 描述附上产验收步骤（见设计文档 §5 守卫 proven-to-fire）。
