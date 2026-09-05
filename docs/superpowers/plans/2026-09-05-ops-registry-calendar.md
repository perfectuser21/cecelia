# 指挥舱运行舱刀1（ops 注册投影+编排日历）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Brain 内新增 ops 只读投影（agent/机器清单 + 编排日历），由 scheduler job 复用 launchd-patrol 的 ssh 逃逸范式拉取宿主 launchd / HK OpenClaw / GHA cron，经 GET 端点现算输出，并以 upsert 模式推送 Notion 两库。

**Architecture:** 拉取模型（无宿主 daemon、无写端点）：scheduler-jobs 每 5min 跑 `runOpsCollector(pool)` → 容器内 ssh 逃逸宿主采三路 → 写 ops_agents / ops_schedule_entries / ops_source_heartbeats（per-source 心跳，宁 stale 不假数据）→ `GET /api/brain/agent-ops/agents|calendar` 现算（含 freshness 与 recurring_tasks 死排程 ⚠️）→ notion-push-sync 两个 upsert push 函数。设计契约见 `docs/superpowers/specs/2026-09-05-ops-registry-calendar-design.md` 与 `sprints/09052225-ops-registry-calendar/prep-prd.md`（**契约违反即 bug**）。

**Tech Stack:** node ESM + express + pg + vitest；Intl.DateTimeFormat 做 DST 正确的 next_run 推算；Notion REST（notionReq 复用）。

**铁律（每个 task 的 subagent prompt 必须 inline）：**
- NO PRODUCTION CODE WITHOUT FAILING TEST FIRST
- 每 task commit 顺序：commit-1 failing test（Red）→ commit-2 实现（Green）
- 测试跑法：`cd packages/brain && npx vitest run src/__tests__/<file> 2>&1 | tail -20`
- 本地任何 migrate 演练一律 `DB_NAME=cecelia_scratch`，禁碰生产 cecelia 库
- 所有外部命令依赖注入（照 launchd-patrol opts.exec），mock 必须断言命令参数

---

### Task 1: migration 433 — ops 三表

**Files:**
- Create: `packages/brain/migrations/433_ops_projection.sql`

- [ ] **Step 1: 写迁移文件**（无 test——SQL 由 Task 4/6 的集成断言覆盖；CREATE TABLE IF NOT EXISTS 幂等）

```sql
-- 433: ops 运行舱只读投影（指挥舱 G1 S1 加厚刀1，task 6fcb5356 / gp 804520f5 / 决策 1f4fbc0f）
-- 注意：agent_ops_agents(274) 是 Path4 微信 RPA 专用表（CHECK 枚举+275 外键），本迁移与其无关、不得复用。
CREATE TABLE IF NOT EXISTS ops_agents (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,            -- brain | openclaw | launchd
  host_alias TEXT NOT NULL,        -- local / hk-vps / mmv / xian-* …自由文本
  name TEXT NOT NULL,
  agent_type TEXT,
  status TEXT NOT NULL DEFAULT 'active',   -- active | offline
  last_seen_at TIMESTAMPTZ,
  meta JSONB NOT NULL DEFAULT '{}',        -- 白名单字段，禁整份外部 config（含凭据）
  notion_id TEXT,
  notion_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, host_alias, name)        -- 跨机器同名不互撞
);

CREATE TABLE IF NOT EXISTS ops_schedule_entries (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  host_alias TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,              -- launchd_interval | launchd_calendar | gha_cron | brain_recurring
  schedule_desc TEXT NOT NULL DEFAULT '',
  next_run_utc TIMESTAMPTZ,        -- 算不准=NULL，禁假精确
  last_state TEXT,
  last_exit_code INTEGER,
  active BOOLEAN NOT NULL DEFAULT TRUE,    -- 快照缺席→false（保留 notion_id 防重建页）
  notion_id TEXT,
  notion_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, host_alias, label)
);

CREATE TABLE IF NOT EXISTS ops_source_heartbeats (
  source TEXT NOT NULL,
  host_alias TEXT NOT NULL,
  last_report_at TIMESTAMPTZ,      -- 服务端时钟（stale 判定唯一基线）
  last_collected_at TIMESTAMPTZ,   -- 采集时间戳（单调守卫+展示）
  source_status TEXT NOT NULL DEFAULT 'never', -- ok|unreachable|parse_error|config_missing|schema_drift
  reason_code TEXT,
  last_error TEXT,                 -- 人可读原文（截断），与 reason_code 双写
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source, host_alias)
);
```

- [ ] **Step 2: 语法冒烟**：`psql "postgres://localhost/cecelia_scratch" -f packages/brain/migrations/433_ops_projection.sql` → 三个 CREATE TABLE 无报错（scratch 库！）
- [ ] **Step 3: Commit** `git add packages/brain/migrations/433_ops_projection.sql && git commit -m "feat(brain): migration 433 ops运行舱三表投影 — G1 step1"`

---

### Task 2: host-exec 共享模块（从 launchd-patrol 提取）

**Files:**
- Create: `packages/brain/src/host-exec.js`
- Modify: `packages/brain/src/launchd-patrol.js:56-81`（改为 import，删本地三函数）
- Test: 复跑 `packages/brain/src/__tests__/launchd-patrol.test.js`（行为零变化）

- [ ] **Step 1: 创建 host-exec.js**（内容=launchd-patrol.js 56-81 行三函数原样搬家+export）

```js
/**
 * host-exec.js — 容器内 ssh 逃逸宿主执行的共享三件套
 * 提取自 launchd-patrol.js（ops-collector 复用，重复第2处即提取）。行为不变。
 */
import { existsSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';

export const EXEC_TIMEOUT_MS = 20_000;

export function defaultExec(cmd) {
  return execSync(cmd, {
    encoding: 'utf8',
    timeout: EXEC_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** 密钥发现式回退（照 spawn/host-executor.js 先例）：宿主实际只有 id_rsa，硬编码 ed25519 会 Permission denied */
export function discoverSshKey(keyExistsFn = existsSync) {
  const dir = `${homedir()}/.ssh`;
  for (const name of ['id_ed25519', 'id_rsa']) {
    const candidate = `${dir}/${name}`;
    if (keyExistsFn(candidate)) return candidate;
  }
  return `${dir}/id_ed25519`;
}

/** 容器内包 ssh 逃逸宿主，宿主直跑原样返回 */
export function buildHostCmd(cmd, inContainer, keyExistsFn) {
  if (!inContainer) return cmd;
  const target = process.env.CECELIA_HOST_EXEC_SSH || 'administrator@host.docker.internal';
  const key = discoverSshKey(keyExistsFn);
  const quoted = `'${cmd.replace(/'/g, `'\\''`)}'`;
  return `ssh -i ${key} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes -o ConnectTimeout=10 ${target} ${quoted}`;
}
```

- [ ] **Step 2: launchd-patrol.js 改 import**：删除其本地 `defaultExec`/`discoverSshKey`/`buildHostCmd` 三函数与相应 `execSync/homedir/existsSync` 未用 import，顶部加 `import { defaultExec, buildHostCmd } from './host-exec.js';`（`existsSync` 若仍用于 inContainer 判定则保留）
- [ ] **Step 3: 跑既有测试确认零回归**：`npx vitest run src/__tests__/launchd-patrol.test.js` → 全 PASS
- [ ] **Step 4: Commit** `git commit -am "refactor(brain): 提取 host-exec 共享三件套（launchd-patrol 行为零变化）— G1 step1"`

---

### Task 3: ops-collector 纯解析函数（TDD）

**Files:**
- Create: `packages/brain/src/ops-collector.js`（本 task 只写纯函数部分）
- Test: `packages/brain/src/__tests__/ops-collector-parsers.test.js`

- [ ] **Step 1: 写 failing tests**（先 commit Red）

```js
import { describe, it, expect } from 'vitest';
import {
  parseLaunchctlList, parsePlistDump, computeNextRunUTC,
  extractOpenclawAgents, parseGhaCron,
} from '../ops-collector.js';

describe('parseLaunchctlList', () => {
  const OUT = `PID\tStatus\tLabel
1234\t0\tcom.cecelia.bridge
-\t78\tcom.zenithjoy.pipeline-worker
-\t0\tcom.apple.Finder
bad line without tabs`;
  it('只留自家 label，解析 pid/exit', () => {
    const rows = parseLaunchctlList(OUT);
    expect(rows).toEqual([
      { label: 'com.cecelia.bridge', pid: 1234, lastExitCode: 0 },
      { label: 'com.zenithjoy.pipeline-worker', pid: null, lastExitCode: 78 },
    ]);
  });
  it('坏行跳过不抛', () => expect(() => parseLaunchctlList('garbage\n???')).not.toThrow());
});

describe('parsePlistDump', () => {
  const OUT = `== /Library/LaunchDaemons/a.plist
{"Label":"com.cecelia.backup-db","StartCalendarInterval":{"Hour":3,"Minute":30}}
== /Library/LaunchDaemons/bad.plist
not-json
== /Library/LaunchDaemons/b.plist
{"Label":"com.cecelia.tick","StartInterval":300}`;
  it('按文件切块解析，坏块计入 badFiles', () => {
    const { plists, badFiles } = parsePlistDump(OUT);
    expect(plists.get('com.cecelia.backup-db').StartCalendarInterval).toEqual({ Hour: 3, Minute: 30 });
    expect(plists.get('com.cecelia.tick').StartInterval).toBe(300);
    expect(badFiles).toEqual(['/Library/LaunchDaemons/bad.plist']);
  });
});

describe('computeNextRunUTC（DST 正确，America/Los_Angeles）', () => {
  const TZ = 'America/Los_Angeles';
  it('每日 03:30 → 次日触发换算成 UTC（PDT=UTC-7）', () => {
    const from = new Date('2026-09-05T20:00:00Z'); // LA 13:00 PDT
    expect(computeNextRunUTC({ Hour: 3, Minute: 30 }, from, TZ))
      .toBe('2026-09-06T10:30:00.000Z');
  });
  it('跨 DST fall-back（2026-11-01 LA 回拨）后用 PST=UTC-8', () => {
    const from = new Date('2026-11-01T20:00:00Z'); // 回拨已发生
    expect(computeNextRunUTC({ Hour: 3, Minute: 30 }, from, TZ))
      .toBe('2026-11-02T11:30:00.000Z');
  });
  it('缺省字段=通配：只给 Minute=0 是每小时', () => {
    const from = new Date('2026-09-05T20:10:00Z');
    expect(computeNextRunUTC({ Minute: 0 }, from, TZ)).toBe('2026-09-05T21:00:00.000Z');
  });
  it('Weekday 7 与 0 都是周日', () => {
    const from = new Date('2026-09-05T20:00:00Z'); // 周六
    const a = computeNextRunUTC({ Weekday: 7, Hour: 1, Minute: 0 }, from, TZ);
    const b = computeNextRunUTC({ Weekday: 0, Hour: 1, Minute: 0 }, from, TZ);
    expect(a).toBe(b);
    expect(a).toBe('2026-09-06T08:00:00.000Z');
  });
  it('dict 数组=多触发点取最近', () => {
    const from = new Date('2026-09-05T20:00:00Z'); // LA 13:00
    expect(computeNextRunUTC([{ Hour: 23, Minute: 0 }, { Hour: 14, Minute: 0 }], from, TZ))
      .toBe('2026-09-05T21:00:00.000Z'); // LA 14:00 更近
  });
  it('视野内无触发返回 null（诚实留空）', () => {
    expect(computeNextRunUTC({ Month: 12, Day: 25 }, new Date('2026-09-05T00:00:00Z'), TZ, 8)).toBeNull();
  });
});

describe('extractOpenclawAgents', () => {
  it('dict 形 entries + 白名单字段（绝不带凭据）', () => {
    const cfg = { agents: { entries: { main: { model: 'x', apiKey: 'SECRET', workspace: '/w' } } }, auth: { k: 'SECRET' } };
    const rows = extractOpenclawAgents(cfg);
    expect(rows).toEqual([{ name: 'main', agent_type: 'openclaw_agent', meta: { model: 'x', workspace: '/w' } }]);
    expect(JSON.stringify(rows)).not.toContain('SECRET');
  });
  it('array 形 entries 也认', () => {
    expect(extractOpenclawAgents({ agents: { entries: [{ id: 'dev' }] } })[0].name).toBe('dev');
  });
  it('entries 缺失抛 schema_drift', () => {
    expect(() => extractOpenclawAgents({})).toThrow(/schema_drift/);
  });
});

describe('parseGhaCron', () => {
  it('grep -Rno 输出 → 条目', () => {
    const OUT = `/Users/administrator/perfect21/cecelia/.github/workflows/nightly.yml:12:    - cron: '0 19 * * *'`;
    expect(parseGhaCron(OUT)).toEqual([
      { label: 'cecelia/nightly.yml', schedule_desc: "cron(UTC): 0 19 * * *", kind: 'gha_cron' },
    ]);
  });
});
```

- [ ] **Step 2: 跑测确认全 FAIL**（模块不存在）：`npx vitest run src/__tests__/ops-collector-parsers.test.js` → FAIL
- [ ] **Step 3: Commit Red** `git add ... && git commit -m "test(brain): ops-collector 解析器 failing tests — G1 step1"`
- [ ] **Step 4: 实现纯函数**（`packages/brain/src/ops-collector.js` 首段）

```js
/**
 * ops-collector.js — 运行舱采集器（指挥舱 G1 S1 刀1，task 6fcb5356）
 * 拉取模型：scheduler job 复用 host-exec ssh 逃逸，无宿主 daemon/写端点。
 * 契约（PrepPRD D1-D3）：0条=可疑须 source_status 佐证；失败 reason_code+last_error 双写；
 * 宁 stale 不假数据；next_run 绝对 UTC 或 NULL；OpenClaw 只读 docker exec 写死路径；
 * launchd 只认已加载；meta 白名单禁凭据。
 */
import { existsSync } from 'fs';
import { defaultExec, buildHostCmd } from './host-exec.js';

export const OWN_LABEL_RE = /(cecelia|zenithjoy|perfect21|openclaw|claude|n8n|cloudflare)/i;
export const INTERVAL_MS = parseInt(process.env.OPS_COLLECTOR_INTERVAL_MS || String(5 * 60 * 1000), 10);

export function parseLaunchctlList(out, labelRe = OWN_LABEL_RE) {
  const rows = [];
  for (const line of String(out).split('\n').slice(1)) {
    const m = line.trim().match(/^(-|\d+)\s+(-?\d+)\s+(\S+)$/);
    if (!m) continue;
    const [, pid, status, label] = m;
    if (!labelRe.test(label)) continue;
    rows.push({ label, pid: pid === '-' ? null : Number(pid), lastExitCode: Number(status) });
  }
  return rows;
}

export function parsePlistDump(out) {
  const plists = new Map();
  const badFiles = [];
  for (const block of String(out).split(/^== /m).slice(1)) {
    const nl = block.indexOf('\n');
    const path = block.slice(0, nl).trim();
    const body = block.slice(nl + 1).trim();
    if (!body) continue;
    try {
      const j = JSON.parse(body);
      if (j.Label) plists.set(j.Label, {
        path,
        StartInterval: j.StartInterval ?? null,
        StartCalendarInterval: j.StartCalendarInterval ?? null,
      });
    } catch { badFiles.push(path); }
  }
  return { plists, badFiles };
}

const WEEKDAY_NUM = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** StartCalendarInterval → 下次触发绝对 UTC（DST 正确：逐分钟用 Intl 在目标时区比对）。算不出=null。 */
export function computeNextRunUTC(cal, from, timeZone, horizonDays = 8) {
  const entries = (Array.isArray(cal) ? cal : [cal]).filter(Boolean);
  if (!entries.length) return null;
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
  });
  const start = Math.ceil((from.getTime() + 1) / 60000) * 60000;
  for (let i = 0; i < horizonDays * 24 * 60; i++) {
    const t = new Date(start + i * 60000);
    const parts = Object.fromEntries(fmt.formatToParts(t).map((p) => [p.type, p.value]));
    const local = {
      Minute: Number(parts.minute), Hour: Number(parts.hour),
      Day: Number(parts.day), Month: Number(parts.month),
      Weekday: WEEKDAY_NUM[parts.weekday],
    };
    for (const e of entries) {
      let match = true;
      for (const [k, v] of Object.entries(e)) {
        if (!(k in local)) continue; // 未知键容忍（schema_drift 不失败）
        const want = k === 'Weekday' && Number(v) === 7 ? 0 : Number(v);
        if (local[k] !== want) { match = false; break; }
      }
      if (match) return t.toISOString();
    }
  }
  return null;
}

export function extractOpenclawAgents(config) {
  const entries = config?.agents?.entries;
  const list = Array.isArray(entries) ? entries
    : entries && typeof entries === 'object'
      ? Object.entries(entries).map(([id, v]) => ({ id, ...(v || {}) }))
      : null;
  if (!list) throw new Error('schema_drift: agents.entries 缺失或形状未知');
  return list
    .map((e) => ({
      name: String(e.id || e.name || ''),
      agent_type: 'openclaw_agent',
      meta: { // 白名单——clawdbot.json 含明文凭据，绝不整份入库
        model: typeof e.model === 'string' ? e.model : null,
        workspace: typeof e.workspace === 'string' ? e.workspace : null,
      },
    }))
    .filter((a) => a.name);
}

export function parseGhaCron(out) {
  const rows = [];
  for (const line of String(out).split('\n')) {
    const m = line.match(/\.github\/workflows\/([^:]+):\d+:.*cron:\s*'([^']+)'/);
    if (!m) continue;
    const repo = line.includes('/cecelia/') ? 'cecelia' : 'zenithjoy';
    rows.push({ label: `${repo}/${m[1]}`, schedule_desc: `cron(UTC): ${m[2]}`, kind: 'gha_cron' });
  }
  return rows;
}
```

- [ ] **Step 5: 跑测全 PASS** → **Step 6: Commit Green** `git commit -am "feat(brain): ops-collector 五个解析器（DST正确/白名单/坏块容错）— G1 step1"`

---

### Task 4: runOpsCollector 主流程（TDD，fake exec + fake pool）

**Files:**
- Modify: `packages/brain/src/ops-collector.js`（追加）
- Test: `packages/brain/src/__tests__/ops-collector-run.test.js`

- [ ] **Step 1: failing tests**

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { runOpsCollector, __resetOpsCollectorForTest, HK_OPENCLAW_CMD } from '../ops-collector.js';

function fakePool() {
  const queries = [];
  return {
    queries,
    query: async (sql, params) => { queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params }); return { rows: [] }; },
  };
}
const LIST_OK = 'PID\tStatus\tLabel\n-\t0\tcom.cecelia.backup-db';
const PLIST_OK = '== /L/a.plist\n{"Label":"com.cecelia.backup-db","StartInterval":300}';
const CLAW_OK = JSON.stringify({ agents: { entries: { main: {}, dev: {} } } });

function fakeExec(map) {
  const calls = [];
  const fn = (cmd) => {
    calls.push(cmd);
    for (const [key, val] of Object.entries(map)) {
      if (cmd.includes(key)) {
        if (val instanceof Error) throw val;
        return val;
      }
    }
    return '';
  };
  fn.calls = calls;
  return fn;
}

beforeEach(() => __resetOpsCollectorForTest());

describe('runOpsCollector', () => {
  it('OpenClaw 命令写死容器内路径（禁 find/通配）', () => {
    expect(HK_OPENCLAW_CMD).toContain('docker exec openclaw-gateway cat /root/.openclaw/clawdbot.json');
    expect(HK_OPENCLAW_CMD).toContain('BatchMode=yes');
    expect(HK_OPENCLAW_CMD).toContain('ConnectTimeout=6');
    expect(HK_OPENCLAW_CMD).not.toContain('find');
  });

  it('全部成功：三路各写快照+心跳 ok', async () => {
    const pool = fakePool();
    const exec = fakeExec({ 'launchctl list': LIST_OK, 'plutil': PLIST_OK, 'clawdbot.json': CLAW_OK, 'workflows': '' , 'readlink': '/var/db/timezone/zoneinfo/America/Los_Angeles' });
    const r = await runOpsCollector(pool, { exec, inContainer: false, now: Date.now() });
    expect(r.results.launchd.ok).toBe(true);
    expect(r.results.openclaw.ok).toBe(true);
    const hb = pool.queries.filter((q) => q.sql.includes('ops_source_heartbeats'));
    expect(hb.some((q) => q.params?.includes('openclaw'))).toBe(true);
    // openclaw upsert 带 (source,host,name) 冲突键
    expect(pool.queries.some((q) => q.sql.includes('ON CONFLICT (source, host_alias, name)'))).toBe(true);
  });

  it('ssh hk 腿断：openclaw 心跳 unreachable+last_error 双写，launchd 照常 ok（per-source 隔离）', async () => {
    const pool = fakePool();
    const exec = fakeExec({ 'launchctl list': LIST_OK, 'plutil': PLIST_OK, 'clawdbot.json': new Error('ssh: connect timeout'), 'readlink': 'zoneinfo/America/Los_Angeles' });
    const r = await runOpsCollector(pool, { exec, inContainer: false, now: Date.now() });
    expect(r.results.launchd.ok).toBe(true);
    expect(r.results.openclaw.ok).toBe(false);
    const hb = pool.queries.find((q) => q.sql.includes('ops_source_heartbeats') && q.params?.includes('unreachable'));
    expect(hb).toBeTruthy();
    expect(hb.params.join('|')).toContain('connect timeout'); // last_error 保留原文
  });

  it('launchctl 解析出 0 行 = parse_error 不是空快照', async () => {
    const pool = fakePool();
    const exec = fakeExec({ 'launchctl list': 'PID\tStatus\tLabel\n', 'clawdbot.json': CLAW_OK });
    const r = await runOpsCollector(pool, { exec, inContainer: false, now: Date.now() });
    expect(r.results.launchd.ok).toBe(false);
    expect(pool.queries.some((q) => q.params?.includes('parse_error'))).toBe(true);
    // 失败腿绝不能写 ops_agents（宁 stale 不假数据）
    expect(pool.queries.some((q) => q.sql.includes('INSERT INTO ops_agents') && q.params?.includes('launchd'))).toBe(false);
  });

  it('clawdbot JSON 半写入：整份丢弃走 parse_error', async () => {
    const pool = fakePool();
    const exec = fakeExec({ 'launchctl list': LIST_OK, 'plutil': PLIST_OK, 'clawdbot.json': '{"agents": {"entr', 'readlink': 'zoneinfo/America/Los_Angeles' });
    const r = await runOpsCollector(pool, { exec, inContainer: false, now: Date.now() });
    expect(r.results.openclaw.ok).toBe(false);
    expect(pool.queries.some((q) => q.sql.includes('INSERT INTO ops_agents') && q.params?.includes('openclaw'))).toBe(false);
  });

  it('模块自 gate：间隔内二次调用 skipped', async () => {
    const pool = fakePool();
    const exec = fakeExec({ 'launchctl list': LIST_OK, 'plutil': PLIST_OK, 'clawdbot.json': CLAW_OK, 'readlink': 'zoneinfo/America/Los_Angeles' });
    await runOpsCollector(pool, { exec, inContainer: false, now: 1000000000000 });
    const r2 = await runOpsCollector(pool, { exec, inContainer: false, now: 1000000000000 + 1000 });
    expect(r2.skipped).toBe(true);
  });

  it('快照缺席的 agent 标 offline 不删行', async () => {
    const pool = fakePool();
    const exec = fakeExec({ 'launchctl list': LIST_OK, 'plutil': PLIST_OK, 'clawdbot.json': CLAW_OK, 'readlink': 'zoneinfo/America/Los_Angeles' });
    await runOpsCollector(pool, { exec, inContainer: false, now: Date.now() });
    const off = pool.queries.find((q) => q.sql.includes("SET status='offline'"));
    expect(off).toBeTruthy();
    expect(off.sql).not.toContain('DELETE');
  });
});
```

- [ ] **Step 2: 跑测 FAIL → Commit Red**
- [ ] **Step 3: 实现主流程**（追加到 ops-collector.js）

```js
export const HK_OPENCLAW_CMD =
  "ssh -o BatchMode=yes -o ConnectTimeout=6 -o StrictHostKeyChecking=no root@100.86.118.99 " +
  "'docker exec openclaw-gateway cat /root/.openclaw/clawdbot.json'"; // 写死真身路径：宿主同名文件5份含旧备份

export const PLIST_DUMP_CMD =
  'for f in /Library/LaunchDaemons/*.plist; do echo "== $f"; /usr/bin/plutil -convert json -o - "$f" 2>/dev/null; echo ""; done';

export const GHA_CRON_CMD =
  "grep -RnoE \"cron: *'[^']+'\" /Users/administrator/perfect21/cecelia/.github/workflows /Users/administrator/perfect21/zenithjoy-workspace/.github/workflows 2>/dev/null || true";

let lastRunAt = 0;
export function __resetOpsCollectorForTest() { lastRunAt = 0; }

async function writeHeartbeat(pool, source, host, status, reasonCode, lastError, collectedAt) {
  await pool.query(
    `INSERT INTO ops_source_heartbeats (source, host_alias, last_report_at, last_collected_at, source_status, reason_code, last_error, updated_at)
     VALUES ($1,$2,NOW(),$3,$4,$5,$6,NOW())
     ON CONFLICT (source, host_alias) DO UPDATE SET
       last_report_at=NOW(), source_status=$4, reason_code=$5, last_error=$6, updated_at=NOW(),
       last_collected_at=COALESCE($3, ops_source_heartbeats.last_collected_at)`,
    [source, host, collectedAt || null, status, reasonCode, lastError ? String(lastError).slice(0, 500) : null]
  );
}

async function writeAgentsSnapshot(pool, source, host, agents, collectedAt) {
  for (const a of agents) {
    await pool.query(
      `INSERT INTO ops_agents (source, host_alias, name, agent_type, status, last_seen_at, meta, updated_at)
       VALUES ($1,$2,$3,$4,'active',$5,$6,NOW())
       ON CONFLICT (source, host_alias, name) DO UPDATE SET
         agent_type=EXCLUDED.agent_type, status='active', last_seen_at=EXCLUDED.last_seen_at,
         meta=EXCLUDED.meta, updated_at=NOW()`,
      [source, host, a.name, a.agent_type || null, collectedAt, JSON.stringify(a.meta || {})]
    );
  }
  // 快照缺席 → offline（不删行，保 notion_id 与历史）
  await pool.query(
    `UPDATE ops_agents SET status='offline', updated_at=NOW()
     WHERE source=$1 AND host_alias=$2 AND status='active' AND last_seen_at < $3`,
    [source, host, collectedAt]
  );
}

async function writeSchedulesSnapshot(pool, source, host, entries, collectedAt) {
  for (const s of entries) {
    await pool.query(
      `INSERT INTO ops_schedule_entries (source, host_alias, label, kind, schedule_desc, next_run_utc, last_state, last_exit_code, active, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,NOW())
       ON CONFLICT (source, host_alias, label) DO UPDATE SET
         kind=EXCLUDED.kind, schedule_desc=EXCLUDED.schedule_desc, next_run_utc=EXCLUDED.next_run_utc,
         last_state=EXCLUDED.last_state, last_exit_code=EXCLUDED.last_exit_code, active=TRUE, updated_at=NOW()`,
      [source, host, s.label, s.kind, s.schedule_desc || '', s.next_run_utc || null, s.last_state || null, s.last_exit_code ?? null]
    );
  }
  if (entries.length) {
    await pool.query(
      `UPDATE ops_schedule_entries SET active=FALSE, updated_at=NOW()
       WHERE source=$1 AND host_alias=$2 AND active=TRUE AND updated_at < $3`,
      [source, host, collectedAt]
    );
  }
}

function classifyError(e) {
  const msg = String(e?.message || '');
  if (/timed? ?out|connect|unreachable|Connection refused|ETIMEDOUT/i.test(msg)) return ['unreachable', 'ssh_or_exec_failed'];
  if (/schema_drift/.test(msg)) return ['schema_drift', 'schema_drift'];
  if (/No such file|not found|config_missing/i.test(msg)) return ['config_missing', 'config_missing'];
  return ['parse_error', 'parse_error'];
}

/** scheduler-jobs handler（needsPool:true）。opts 仅供测试注入。 */
export async function runOpsCollector(pool, opts = {}) {
  const now = opts.now ?? Date.now();
  if (now - lastRunAt < INTERVAL_MS) return { skipped: true };
  lastRunAt = now;
  const exec = opts.exec || defaultExec;
  const inContainer = opts.inContainer ?? existsSync('/.dockerenv');
  const run = (cmd) => exec(buildHostCmd(cmd, inContainer, opts.keyExistsFn));
  const collectedAt = new Date(now).toISOString();
  const results = {};

  // —— 腿1: launchd@local ——（只认已加载；0行=可疑判失败）
  try {
    const list = parseLaunchctlList(run('launchctl list'));
    if (list.length === 0) throw new Error('parse_error: launchctl list 解析出 0 行自家任务（0=可疑，禁当真空）');
    let hostTz = 'America/Los_Angeles';
    try { hostTz = String(run('readlink /etc/localtime')).split('zoneinfo/')[1]?.trim() || hostTz; } catch { /* 展示级信息，失败用默认 */ }
    const { plists } = parsePlistDump(run(PLIST_DUMP_CMD));
    const agents = list.map((l) => ({
      name: l.label, agent_type: 'launchd_job',
      meta: { pid: l.pid, last_exit_code: l.lastExitCode },
    }));
    const schedules = [];
    for (const l of list) {
      const p = plists.get(l.label);
      if (!p) continue;
      if (p.StartCalendarInterval) {
        schedules.push({
          label: l.label, kind: 'launchd_calendar',
          schedule_desc: `calendar(${hostTz}): ${JSON.stringify(p.StartCalendarInterval)}`,
          next_run_utc: computeNextRunUTC(p.StartCalendarInterval, new Date(now), hostTz),
          last_state: l.pid ? 'running' : (l.lastExitCode === 0 ? 'ok' : `exit ${l.lastExitCode}`),
          last_exit_code: l.lastExitCode,
        });
      } else if (p.StartInterval) {
        schedules.push({
          label: l.label, kind: 'launchd_interval',
          schedule_desc: `约每 ${p.StartInterval} 秒`, // 锚点=加载时刻，禁假精确
          next_run_utc: null,
          last_state: l.pid ? 'running' : (l.lastExitCode === 0 ? 'ok' : `exit ${l.lastExitCode}`),
          last_exit_code: l.lastExitCode,
        });
      }
    }
    await writeAgentsSnapshot(pool, 'launchd', 'local', agents, collectedAt);
    await writeSchedulesSnapshot(pool, 'launchd', 'local', schedules, collectedAt);
    await writeHeartbeat(pool, 'launchd', 'local', 'ok', null, null, collectedAt);
    results.launchd = { ok: true, agents: agents.length, schedules: schedules.length };
  } catch (e) {
    const [status, code] = classifyError(e);
    await writeHeartbeat(pool, 'launchd', 'local', status, code, e.message);
    results.launchd = { ok: false };
  }

  // —— 腿2: openclaw@hk-vps ——（解析失败整份丢弃，沿用上轮+stale）
  try {
    const raw = run(HK_OPENCLAW_CMD);
    let cfg;
    try { cfg = JSON.parse(raw); } catch { throw new Error(`parse_error: clawdbot.json 非法 JSON（前100字符: ${String(raw).slice(0, 100)}）`); }
    const agents = extractOpenclawAgents(cfg);
    await writeAgentsSnapshot(pool, 'openclaw', 'hk-vps', agents, collectedAt);
    await writeHeartbeat(pool, 'openclaw', 'hk-vps', 'ok', null, null, collectedAt);
    results.openclaw = { ok: true, agents: agents.length };
  } catch (e) {
    const [status, code] = classifyError(e);
    await writeHeartbeat(pool, 'openclaw', 'hk-vps', status, code, e.message);
    results.openclaw = { ok: false };
  }

  // —— 腿3: gha@github（静态解析宿主 checkout，失败不阻塞）——
  try {
    const entries = parseGhaCron(run(GHA_CRON_CMD));
    await writeSchedulesSnapshot(pool, 'gha', 'github', entries, collectedAt);
    await writeHeartbeat(pool, 'gha', 'github', 'ok', null, null, collectedAt);
    results.gha = { ok: true, schedules: entries.length };
  } catch (e) {
    const [status, code] = classifyError(e);
    await writeHeartbeat(pool, 'gha', 'github', status, code, e.message);
    results.gha = { ok: false };
  }

  return { ok: true, results };
}
```

- [ ] **Step 4: 跑测全 PASS → Commit Green** `git commit -am "feat(brain): runOpsCollector 三腿采集（per-source隔离/宁stale不假数据）— G1 step1"`

---

### Task 5: scheduler-jobs 挂载

**Files:**
- Modify: `packages/brain/src/scheduler-jobs.js`（import + JOBS 追加一行）

- [ ] **Step 1:** import：`import { runOpsCollector } from './ops-collector.js';`；JOBS 数组追加：

```js
  { name: 'ops-collector', needsPool: true, timeoutMs: 120_000, handler: (pool) => runOpsCollector(pool), description: '运行舱采集器（5min自gate，宿主launchctl+HK OpenClaw+GHA cron→ops_*投影，per-source心跳，G1 S1 刀1，task 6fcb5356）' },
```

- [ ] **Step 2:** `node --check packages/brain/src/scheduler-jobs.js` 冒烟 + 跑该文件相关既有测试（如有）
- [ ] **Step 3: Commit** `git commit -am "feat(brain): ops-collector 挂进 scheduler JOBS — G1 step1"`

---

### Task 6: GET /agent-ops/agents|calendar（TDD）

**Files:**
- Create: `packages/brain/src/routes/agent-ops.js`
- Modify: `packages/brain/src/routes.js`（import + `router.use('/agent-ops', agentOpsRouter);`）
- Test: `packages/brain/src/__tests__/agent-ops-routes.test.js`

- [ ] **Step 1: failing tests**（测导出的查询构建函数，fake pool；42P01→503）

```js
import { describe, it, expect } from 'vitest';
import { buildAgentsPayload, buildCalendarPayload, SKILL_BY_TASK_TYPE, STALE_FACTOR } from '../routes/agent-ops.js';

function poolReturning(rowsBySql) {
  return { query: async (sql) => {
    for (const [key, rows] of Object.entries(rowsBySql)) if (sql.includes(key)) return { rows };
    return { rows: [] };
  } };
}

describe('buildAgentsPayload', () => {
  it('per-source freshness：hk 心跳过期只灰 openclaw，launchd 保持 fresh', async () => {
    const now = new Date('2026-09-05T12:00:00Z');
    const pool = poolReturning({
      'FROM ops_agents': [
        { source: 'openclaw', host_alias: 'hk-vps', name: 'main', status: 'active' },
        { source: 'launchd', host_alias: 'local', name: 'com.cecelia.backup-db', status: 'active' },
      ],
      'FROM ops_source_heartbeats': [
        { source: 'openclaw', host_alias: 'hk-vps', last_report_at: new Date('2026-09-05T10:00:00Z'), source_status: 'ok' },
        { source: 'launchd', host_alias: 'local', last_report_at: new Date('2026-09-05T11:58:00Z'), source_status: 'ok' },
      ],
    });
    const p = await buildAgentsPayload(pool, now);
    const oc = p.sources.find((s) => s.source === 'openclaw');
    const ld = p.sources.find((s) => s.source === 'launchd');
    expect(oc.stale).toBe(true);
    expect(ld.stale).toBe(false);
    expect(p.agents.find((a) => a.source === 'openclaw').stale).toBe(true);
  });
  it('source_status 非 ok 即 stale（哪怕心跳新鲜）', async () => {
    const now = new Date('2026-09-05T12:00:00Z');
    const pool = poolReturning({
      'FROM ops_agents': [],
      'FROM ops_source_heartbeats': [
        { source: 'openclaw', host_alias: 'hk-vps', last_report_at: now, source_status: 'unreachable', reason_code: 'ssh_or_exec_failed', last_error: 'ssh: connect timeout' },
      ],
    });
    const p = await buildAgentsPayload(pool, now);
    expect(p.sources[0].stale).toBe(true);
    expect(p.sources[0].last_error).toContain('timeout'); // 失败留真实原因，透出给前端
  });
  it('表不存在(42P01) → 抛 migration_pending 语义错误', async () => {
    const pool = { query: async () => { const e = new Error('relation "ops_agents" does not exist'); e.code = '42P01'; throw e; } };
    await expect(buildAgentsPayload(pool, new Date())).rejects.toMatchObject({ reason_code: 'migration_pending' });
  });
});

describe('buildCalendarPayload', () => {
  it('合并实跑+排程+recurring；死排程标 suspicious 禁绿灯', async () => {
    const now = new Date('2026-09-05T12:00:00Z');
    const pool = poolReturning({
      'FROM tasks': [{ id: 't1', title: 'X', task_type: 'dev', status: 'completed', location: 'us', updated_at: now }],
      'FROM ops_schedule_entries': [{ source: 'launchd', host_alias: 'local', label: 'com.cecelia.backup-db', kind: 'launchd_calendar', schedule_desc: 'c', next_run_utc: now, last_state: 'ok', active: true }],
      'FROM recurring_tasks': [
        { title: '活的', cron_expression: '0 3 * * *', last_run_at: new Date('2026-09-05T03:00:00Z'), next_run_at: null, last_run_status: 'ok', is_active: true },
        { title: '死的', cron_expression: '0 4 * * *', last_run_at: new Date('2026-08-01T00:00:00Z'), next_run_at: null, last_run_status: null, is_active: true },
      ],
    });
    const p = await buildCalendarPayload(pool, now);
    expect(p.runs.length).toBe(1);
    expect(p.runs[0].skill).toBe('/dev'); // task_type→skill 映射
    const dead = p.schedules.find((s) => s.label === '死的');
    expect(dead.suspicious).toBe(true); // 3天无实跑 = ⚠️ 可疑
    expect(p.schedules.find((s) => s.label === '活的').suspicious).toBe(false);
  });
  it('task_type 映射不出 → skill 为 null（禁编造）', () => {
    expect(SKILL_BY_TASK_TYPE['dev']).toBe('/dev');
    expect(SKILL_BY_TASK_TYPE['不存在的类型']).toBeUndefined();
  });
});
```

- [ ] **Step 2: FAIL → Commit Red**
- [ ] **Step 3: 实现 routes/agent-ops.js**

```js
/**
 * agent-ops.js — 运行舱只读端点（指挥舱 G1 S1 刀1）
 * GET /agent-ops/agents   — agent/机器清单 + per-source freshness
 * GET /agent-ops/calendar — 过去24h实跑 + 排程面（ops_schedule_entries + recurring_tasks）
 * 契约：0条须 source_status 佐证；42P01→503 migration_pending 禁 200 空数组；stale 用服务端时钟。
 */
import { Router } from 'express';
import pool from '../db.js';
import { INTERVAL_MS } from '../ops-collector.js';

export const STALE_FACTOR = 3;

export const SKILL_BY_TASK_TYPE = {
  dev: '/dev',
  harness_initiative: 'harness(skill-relay)',
  harness_intervention: 'harness(skill-relay)',
  ci_patrol: '/ci-patrol',
  code_review: '/code-review',
  arch_review: '/arch-review',
  strategist_decision: '/strategy-session',
  strategy_session: '/strategy-session',
  initiative_verify: '/arch-review',
  data: null, // Brain 内部数据任务，无 skill
};

function isMissingTable(err) { return err?.code === '42P01'; }
function migrationPendingError(err) {
  const e = new Error('ops 表不存在，迁移未跑'); e.reason_code = 'migration_pending'; e.cause = err; return e;
}

export async function buildAgentsPayload(dbPool, now = new Date()) {
  let agents, hbs;
  try {
    agents = (await dbPool.query(`SELECT * FROM ops_agents ORDER BY source, host_alias, name`)).rows;
    hbs = (await dbPool.query(`SELECT * FROM ops_source_heartbeats`)).rows;
  } catch (err) {
    if (isMissingTable(err)) throw migrationPendingError(err);
    throw err;
  }
  const staleMs = STALE_FACTOR * INTERVAL_MS;
  const sources = hbs.map((h) => ({
    source: h.source, host_alias: h.host_alias,
    source_status: h.source_status, reason_code: h.reason_code, last_error: h.last_error,
    last_report_at: h.last_report_at, last_collected_at: h.last_collected_at,
    stale: h.source_status !== 'ok' || !h.last_report_at || (now - new Date(h.last_report_at)) > staleMs,
  }));
  const staleByKey = new Map(sources.map((s) => [`${s.source}|${s.host_alias}`, s.stale]));
  const global_stale = sources.length === 0 || sources.every((s) => s.stale);
  return {
    agents: agents.map((a) => ({ ...a, stale: staleByKey.get(`${a.source}|${a.host_alias}`) ?? true })),
    sources, global_stale, stale_threshold_ms: staleMs, server_now: now.toISOString(),
  };
}

export async function buildCalendarPayload(dbPool, now = new Date()) {
  let tasks, schedules, recurring;
  try {
    tasks = (await dbPool.query(
      `SELECT id, title, task_type, status, location, claimed_by, executor_kind, updated_at
       FROM tasks WHERE updated_at > NOW() - INTERVAL '24 hours'
         AND status IN ('in_progress','completed','failed','blocked','cancelled')
       ORDER BY updated_at DESC LIMIT 200`)).rows;
    schedules = (await dbPool.query(`SELECT * FROM ops_schedule_entries WHERE active = TRUE ORDER BY source, label`)).rows;
    recurring = (await dbPool.query(
      `SELECT title, cron_expression, last_run_at, next_run_at, last_run_status, is_active
       FROM recurring_tasks WHERE is_active = TRUE`)).rows;
  } catch (err) {
    if (isMissingTable(err)) throw migrationPendingError(err);
    throw err;
  }
  const DEAD_MS = 3 * 24 * 3600 * 1000;
  return {
    runs: tasks.map((t) => ({
      ...t,
      skill: SKILL_BY_TASK_TYPE[t.task_type] ?? null, // 推不出=null，前端显示"未标注"，禁编造
      machine: t.location || null,                     // 只有 us/hk/xian 粒度，如实透出
    })),
    schedules: [
      ...schedules.map((s) => ({ ...s, suspicious: false })),
      ...recurring.map((r) => ({
        source: 'brain', host_alias: 'local', label: r.title, kind: 'brain_recurring',
        schedule_desc: r.cron_expression || '', next_run_utc: r.next_run_at, last_state: r.last_run_status,
        // executeTick 废弃族：长期无实跑的排程标 ⚠️，禁画绿灯
        suspicious: !r.last_run_at || (now - new Date(r.last_run_at)) > DEAD_MS,
      })),
    ],
    server_now: now.toISOString(),
  };
}

const router = Router();

function handle(builder) {
  return async (req, res) => {
    try {
      res.json({ success: true, data: await builder(pool, new Date()) });
    } catch (err) {
      if (err.reason_code === 'migration_pending') {
        return res.status(503).json({ success: false, error: { code: 'migration_pending', message: err.message } });
      }
      console.error('[agent-ops]', err);
      res.status(500).json({ success: false, error: { code: 'internal', message: err.message } });
    }
  };
}

router.get('/agents', handle(buildAgentsPayload));
router.get('/calendar', handle(buildCalendarPayload));

export default router;
```

- [ ] **Step 4: routes.js 挂载**：import `agentOpsRouter from './routes/agent-ops.js';` + 在 `/harness/gaps` 挂载行后加：

```js
// 运行舱只读投影 — GET /agent-ops/agents, /agent-ops/calendar（指挥舱 G1 S1 刀1）
router.use('/agent-ops', agentOpsRouter);
```

- [ ] **Step 5: 跑测全 PASS → Commit Green** `git commit -am "feat(brain): /agent-ops agents+calendar 现算端点（per-source freshness/503闸/死排程⚠️）— G1 step1"`

---

### Task 7: Notion 两库 upsert 推送（TDD）

**Files:**
- Modify: `packages/brain/src/notion-push-sync.js`（新增两个 build 纯函数 + 两个 push 函数 + runNotionPushSync 追加两行）
- Test: `packages/brain/src/__tests__/notion-push-ops.test.js`

- [ ] **Step 1: failing tests**

```js
import { describe, it, expect } from 'vitest';
import { buildOpsAgentNotionProperties, buildOpsScheduleNotionProperties, isMissingDatabaseError } from '../notion-push-sync.js';

describe('buildOpsAgentNotionProperties（纯函数 oracle）', () => {
  it('全字段映射', () => {
    const p = buildOpsAgentNotionProperties({
      source: 'openclaw', host_alias: 'hk-vps', name: 'main', agent_type: 'openclaw_agent',
      status: 'active', last_seen_at: new Date('2026-09-05T12:00:00Z'),
    });
    expect(p.Name.title[0].text.content).toBe('main');
    expect(p.Source.select.name).toBe('openclaw');
    expect(p.Host.select.name).toBe('hk-vps');
    expect(p.Status.select.name).toBe('active');
    expect(p.LastSeen.date.start).toBe('2026-09-05T12:00:00.000Z');
  });
  it('last_seen_at 空 → 不发 LastSeen（禁假数据）', () => {
    const p = buildOpsAgentNotionProperties({ source: 's', host_alias: 'h', name: 'n', status: 'offline', last_seen_at: null });
    expect(p.LastSeen).toBeUndefined();
  });
});

describe('buildOpsScheduleNotionProperties', () => {
  it('suspicious/inactive 透出为 checkbox', () => {
    const p = buildOpsScheduleNotionProperties({
      source: 'brain', host_alias: 'local', label: 'X', kind: 'brain_recurring',
      schedule_desc: '0 3 * * *', next_run_utc: null, last_state: null, active: true,
    }, true);
    expect(p.Suspicious.checkbox).toBe(true);
    expect(p.NextRun).toBeUndefined();
  });
});

describe('isMissingDatabaseError', () => {
  it('database 级 404 识别（page 级不算）', () => {
    expect(isMissingDatabaseError(new Error('Could not find database with ID: xxx'))).toBe(true);
    expect(isMissingDatabaseError(new Error('Could not find page with ID: yyy'))).toBe(false);
  });
});
```

- [ ] **Step 2: FAIL → Commit Red**
- [ ] **Step 3: 实现**（notion-push-sync.js 追加；`export` build 函数与 isMissingDatabaseError 供测试）

```js
// ─── ops 运行舱两库（指挥舱 G1 S1 刀1）───────────────────────────
// DB id 不硬编码：来自 working_memory key='ops_notion_dbs'（create-ops-notion-dbs.js 一次性写入）。
// kv 缺失=库未创建（运维状态，静默跳过不刷错误）；value.disabled=true 为终止态（库被删，禁自动重建防平行库）。

export function isMissingDatabaseError(err) {
  return !!(err?.message && err.message.includes('Could not find database'));
}

export function buildOpsAgentNotionProperties(r) {
  const p = {
    Name: { title: [{ text: { content: String(r.name).slice(0, 200) } }] },
    Source: { select: { name: r.source } },
    Host: { select: { name: r.host_alias } },
    Status: { select: { name: r.status } },
  };
  if (r.agent_type) p.Type = { rich_text: buildRichText(r.agent_type) };
  if (r.last_seen_at) p.LastSeen = { date: { start: new Date(r.last_seen_at).toISOString() } };
  return p;
}

export function buildOpsScheduleNotionProperties(r, suspicious = false) {
  const p = {
    Name: { title: [{ text: { content: String(r.label).slice(0, 200) } }] },
    Source: { select: { name: r.source } },
    Host: { select: { name: r.host_alias } },
    Kind: { select: { name: r.kind } },
    Schedule: { rich_text: buildRichText(r.schedule_desc) },
    Suspicious: { checkbox: !!suspicious },
    Active: { checkbox: r.active !== false },
  };
  if (r.next_run_utc) p.NextRun = { date: { start: new Date(r.next_run_utc).toISOString() } };
  if (r.last_state) p.LastState = { rich_text: buildRichText(r.last_state) };
  return p;
}

async function getOpsNotionDbs(pool) {
  const { rows } = await pool.query(`SELECT value_json FROM working_memory WHERE key = 'ops_notion_dbs'`);
  return rows[0]?.value_json || null;
}

async function disableOpsPush(pool, errMsg) {
  await pool.query(
    `UPDATE working_memory SET value_json = value_json || '{"disabled":true}'::jsonb, updated_at = NOW()
     WHERE key = 'ops_notion_dbs'`);
  await logSyncError(pool, `[ops-push] Notion 库不可访问已停推（终止态，禁自动重建）: ${errMsg}`);
}

async function upsertOpsRows(pool, token, { table, dbId, rows, buildProps }) {
  for (const r of rows) {
    try {
      const properties = buildProps(r);
      if (r.notion_id) {
        await notionReq(token, `/pages/${r.notion_id}`, 'PATCH', { properties });
      } else {
        const page = await notionReq(token, '/pages', 'POST', { parent: { database_id: dbId }, properties });
        await pool.query(`UPDATE ${table} SET notion_id = $1 WHERE id = $2`, [page.id, r.id]);
      }
      await pool.query(`UPDATE ${table} SET notion_synced_at = NOW() WHERE id = $1`, [r.id]);
    } catch (err) {
      if (isMissingDatabaseError(err)) { await disableOpsPush(pool, err.message); return; }
      if (isStaleRelationError(err)) { // 页被人删 → 清 notion_id 下轮重建该页
        await pool.query(`UPDATE ${table} SET notion_id = NULL WHERE id = $1`, [r.id]);
        continue;
      }
      console.warn(`[notion-push-sync] ${table} ${r.id} 推送失败: ${err.message}`);
      await logSyncError(pool, err.message);
    }
  }
}

async function pushOpsAgents(pool, token) {
  const dbs = await getOpsNotionDbs(pool);
  if (!dbs?.agents_db || dbs.disabled) return;
  const { rows } = await pool.query(
    `SELECT * FROM ops_agents
     WHERE notion_synced_at IS NULL OR updated_at > notion_synced_at
     ORDER BY updated_at LIMIT 50`);
  await upsertOpsRows(pool, token, { table: 'ops_agents', dbId: dbs.agents_db, rows, buildProps: buildOpsAgentNotionProperties });
}

async function pushOpsSchedules(pool, token) {
  const dbs = await getOpsNotionDbs(pool);
  if (!dbs?.calendar_db || dbs.disabled) return;
  const { rows } = await pool.query(
    `SELECT * FROM ops_schedule_entries
     WHERE notion_synced_at IS NULL OR updated_at > notion_synced_at
     ORDER BY updated_at LIMIT 50`);
  await upsertOpsRows(pool, token, {
    table: 'ops_schedule_entries', dbId: dbs.calendar_db, rows,
    buildProps: (r) => buildOpsScheduleNotionProperties(r, false),
  });
}
```

runNotionPushSync 末尾追加：

```js
  await pushOpsAgents(pool, token);
  await pushOpsSchedules(pool, token);
```

- [ ] **Step 4: 跑测全 PASS（含既有 notion-push 相关测试零回归）→ Commit Green** `git commit -am "feat(brain): Notion ops两库 upsert 推送（PATCH模式/库404终止态/kv配置）— G1 step1"`

---

### Task 8: create-ops-notion-dbs.js（幂等创建脚本）

**Files:**
- Create: `scripts/ops/create-ops-notion-dbs.js`

- [ ] **Step 1: 写脚本**（merge 后宿主手跑一次；幂等：按 title 搜索已有库即复用）

```js
#!/usr/bin/env node
/**
 * create-ops-notion-dbs.js — 一次性创建运行舱 Notion 两库并把 id 写入 Brain kv。
 * 幂等：先 POST /search 按 title 找已有库，找到即复用（Notion 无 database upsert，重跑禁建平行库）。
 * 用法（宿主）：
 *   source ~/.credentials/1password.env && export OP_SERVICE_ACCOUNT_TOKEN
 *   NOTION_API_KEY=$(op item get "Notion" --vault CS --fields credential --reveal | tr -d '"') \
 *     node scripts/ops/create-ops-notion-dbs.js
 */
const NOTION = 'https://api.notion.com/v1';
const BRAIN = process.env.BRAIN_URL || 'http://localhost:5221';
const TOKEN = process.env.NOTION_API_KEY;
const JOURNEY_DB = '358c40c2-ba63-8148-bde7-e313d789931a'; // 现有库，用于取 AI Hub parent page

if (!TOKEN) { console.error('NOTION_API_KEY 未设置'); process.exit(1); }

async function notion(path, method = 'GET', body = null) {
  const res = await fetch(`${NOTION}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${data.message || JSON.stringify(data).slice(0, 300)}`);
  return data;
}

async function findDbByTitle(title) {
  const r = await notion('/search', 'POST', { query: title, filter: { property: 'object', value: 'database' } });
  return r.results.find((d) => (d.title?.[0]?.plain_text || '') === title)?.id || null;
}

async function ensureDb(title, properties, parentPageId) {
  const existing = await findDbByTitle(title);
  if (existing) { console.log(`✅ 已存在复用: ${title} → ${existing}`); return existing; }
  const db = await notion('/databases', 'POST', {
    parent: { type: 'page_id', page_id: parentPageId },
    title: [{ type: 'text', text: { content: title } }],
    properties,
  });
  console.log(`✅ 已创建: ${title} → ${db.id}`);
  return db.id;
}

const AGENTS_PROPS = {
  Name: { title: {} }, Source: { select: {} }, Host: { select: {} },
  Type: { rich_text: {} }, Status: { select: {} }, LastSeen: { date: {} },
};
const CALENDAR_PROPS = {
  Name: { title: {} }, Source: { select: {} }, Host: { select: {} }, Kind: { select: {} },
  Schedule: { rich_text: {} }, NextRun: { date: {} }, LastState: { rich_text: {} },
  Suspicious: { checkbox: {} }, Active: { checkbox: {} },
};

const main = async () => {
  const journeyDb = await notion(`/databases/${JOURNEY_DB}`);
  const parentPageId = journeyDb.parent?.page_id;
  if (!parentPageId) throw new Error('取不到 AI Hub parent page id（JOURNEY_DB.parent 非 page）');
  const agents_db = await ensureDb('Ops Agents & 机器', AGENTS_PROPS, parentPageId);
  const calendar_db = await ensureDb('Ops 编排日历', CALENDAR_PROPS, parentPageId);
  const kv = await fetch(`${BRAIN}/api/brain/kv/ops_notion_dbs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agents_db, calendar_db }),
  }).then((r) => r.json());
  if (!kv.ok) throw new Error(`kv 写入失败: ${JSON.stringify(kv)}`);
  console.log('✅ kv ops_notion_dbs 已写入，下一轮 notion-push 自动开始推送');
};

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
```

- [ ] **Step 2:** `node --check scripts/ops/create-ops-notion-dbs.js` 冒烟
- [ ] **Step 3: Commit** `git commit -am "feat(ops): Notion ops两库幂等创建脚本（title搜索复用+kv落地）— G1 step1"`

---

### Task 9: 收尾 — learning + 全量测试 + push

- [ ] **Step 1:** 写 `docs/learnings/cp-09052227-ops-registry-calendar.md`：含 `### 根本原因`（可观测性四层账本无投影+两处历史表/推送模式不可复用的原因）+ `### 下次预防` + `- [ ]` 项
- [ ] **Step 2:** `cd packages/brain && npm test` 全量（允许既有无关红灯按 CI 基线判断，本 PR 新增测试必须全绿）
- [ ] **Step 3:** 删残留 console.log/未用 import；`git push -u origin cp-09052227-ops-registry-calendar --no-verify`（quickcheck 已在 CI 跑）
- [ ] **Step 4:** 开 PR（title 含 G1 step1；body 引 PrepPRD/spec 路径 + 决策 1f4fbc0f + task 6fcb5356）

### merge 后（不在本 PR 内，写进 PR body 的 checklist）
1. `brain-deploy.sh` 重建镜像（容器跑镜像快照，不重建=改了没生效）
2. prod 跑迁移 433（部署管道自动）→ `curl :5221/api/brain/agent-ops/agents` 从 503 变 200
3. 等 ops-collector 首轮（≤5min）→ psql 验 ops_agents openclaw≥20 行 / launchd≥10 行
4. 宿主跑 `create-ops-notion-dbs.js` → 5min 内 Notion 两库出行
5. proven-to-fire：`launchctl bootout system/com.cecelia.brain-keepalive` 之类**不做**——改为把 OPS_COLLECTOR_INTERVAL_MS 临时调大或停 brain 容器 15min 观察 global_stale=true 后恢复，截图留证
