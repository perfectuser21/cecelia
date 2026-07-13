# launchd-patrol 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Brain scheduler 新增 launchd-patrol 哨兵 job，每 15min 核对宿主机 launchd 预期服务清单（disabled/未加载/未运行/端口不通 → P1+Bark 告警），堵住"launchd 服务被静默禁用多天无告警"的系统性缺口。

**Architecture:** 新文件 `packages/brain/src/launchd-patrol.js`（manifest 常量 + 自 gate handler + 容器内 ssh 逃逸宿主执行 launchctl/nc），注册进 `scheduler-jobs.js` JOBS（needsPool:false）。告警走 `sendBark`（dedupeKey DB 级 6h 去重）+ `raise('P1')`。设计文档：`docs/superpowers/specs/2026-07-12-launchd-patrol-design.md`。

**Tech Stack:** Node ESM、vitest（exec 注入 mock）、launchctl/nc（宿主）、ssh BatchMode 三件套（照 staging-e2e-runner.js:640 先例）。

---

### Task 1: launchd-patrol 核心模块（TDD）

**Files:**
- Create: `packages/brain/src/launchd-patrol.js`
- Test: `packages/brain/src/__tests__/launchd-patrol.test.js`

- [ ] **Step 1: 写失败测试**

`packages/brain/src/__tests__/launchd-patrol.test.js`：

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../notifier.js', () => ({ sendBark: vi.fn().mockResolvedValue(true) }));
vi.mock('../alerting.js', () => ({ raise: vi.fn().mockResolvedValue(undefined) }));

import {
  runLaunchdPatrol,
  __resetLaunchdPatrolForTest,
} from '../launchd-patrol.js';
import { sendBark } from '../notifier.js';
import { raise } from '../alerting.js';

// 健康宿主的 fake launchctl/nc 输出；overrides 注入各类坏状态
const HEALTHY_DISABLED_OUT = [
  '\tdisabled services = {',
  '\t\t"com.cecelia.frontend" => disabled',
  '\t\t"com.n8n" => disabled',
  '\t\t"com.openssh.sshd" => enabled',
  '\t}',
].join('\n');

function makeExec(overrides = {}) {
  return vi.fn((cmd) => {
    if (cmd.includes('print-disabled')) {
      if (overrides.hostUnreachable) throw new Error('ssh: connect to host timed out');
      return overrides.disabledOut ?? HEALTHY_DISABLED_OUT;
    }
    const m = cmd.match(/launchctl print system\/([\w.-]+)/);
    if (m) {
      const label = m[1];
      if (overrides.notLoaded?.includes(label)) throw new Error('Could not find service');
      if (overrides.notRunning?.includes(label)) return `system/${label} = {\n\tstate = waiting\n}`;
      return `system/${label} = {\n\tstate = running\n}`;
    }
    const p = cmd.match(/nc -z -G 3 localhost (\d+)/);
    if (p) {
      if (overrides.portDown?.includes(Number(p[1]))) throw new Error('connection refused');
      return '';
    }
    throw new Error(`unexpected cmd: ${cmd}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetLaunchdPatrolForTest();
});

describe('launchd-patrol manifest 核对', () => {
  it('全部健康 → anomalies 空且不告警（含废弃名单 frontend/n8n disabled 属预期）', async () => {
    const r = await runLaunchdPatrol({ exec: makeExec(), inContainer: false });
    expect(r.ok).toBe(true);
    expect(r.anomalies).toEqual([]);
    expect(r.checked).toBe(6); // 1 must-run + 3 must-load + 2 端口
    expect(sendBark).not.toHaveBeenCalled();
    expect(raise).not.toHaveBeenCalled();
  });

  it('必跑 daemon 被 disabled → 检出 + Bark(6h dedupe) + raise P1', async () => {
    const disabledOut = HEALTHY_DISABLED_OUT.replace(
      '"com.n8n" => disabled',
      '"com.n8n" => disabled\n\t\t"com.cecelia.bridge" => disabled',
    );
    const r = await runLaunchdPatrol({ exec: makeExec({ disabledOut }), inContainer: false });
    expect(r.anomalies).toContain('disabled:com.cecelia.bridge');
    expect(sendBark).toHaveBeenCalledWith(
      'launchd 巡检异常',
      expect.stringContaining('disabled:com.cecelia.bridge'),
      expect.objectContaining({
        dedupeKey: expect.stringContaining('launchd-patrol:'),
        dedupeTtlSec: 6 * 3600,
      }),
    );
    expect(raise).toHaveBeenCalledWith(
      'P1',
      'launchd_patrol_anomaly',
      expect.stringContaining('disabled:com.cecelia.bridge'),
    );
  });

  it('daemon 未加载（launchctl print 非零退出）→ not_loaded 检出', async () => {
    const r = await runLaunchdPatrol({
      exec: makeExec({ notLoaded: ['com.cecelia.token-refresh'] }),
      inContainer: false,
    });
    expect(r.anomalies).toEqual(['not_loaded:com.cecelia.token-refresh']);
  });

  it('必跑 daemon state 非 running → not_running 检出', async () => {
    const r = await runLaunchdPatrol({
      exec: makeExec({ notRunning: ['com.cecelia.bridge'] }),
      inContainer: false,
    });
    expect(r.anomalies).toEqual(['not_running:com.cecelia.bridge']);
  });

  it('周期型 daemon state 非 running 不算异常（只有必跑名单查 state）', async () => {
    const r = await runLaunchdPatrol({
      exec: makeExec({ notRunning: ['com.cecelia.pf-firewall'] }),
      inContainer: false,
    });
    expect(r.anomalies).toEqual([]);
  });

  it('端口不通 → port_down 检出', async () => {
    const r = await runLaunchdPatrol({
      exec: makeExec({ portDown: [5200] }),
      inContainer: false,
    });
    expect(r.anomalies).toEqual(['port_down:5200(zenithjoy-api)']);
  });

  it('宿主不可达（连通性探针失败）→ fail-open，不产生服务异常不告警', async () => {
    const r = await runLaunchdPatrol({
      exec: makeExec({ hostUnreachable: true }),
      inContainer: false,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('host_unreachable');
    expect(sendBark).not.toHaveBeenCalled();
    expect(raise).not.toHaveBeenCalled();
  });
});

describe('launchd-patrol gate 与 ssh 逃逸', () => {
  it('15min gate：间隔内二次调用 skipped', async () => {
    const exec = makeExec();
    const t0 = 1_800_000_000_000;
    const r1 = await runLaunchdPatrol({ exec, inContainer: false, now: t0 });
    expect(r1.skipped).toBeUndefined();
    const r2 = await runLaunchdPatrol({ exec, inContainer: false, now: t0 + 60_000 });
    expect(r2.skipped).toBe(true);
    const r3 = await runLaunchdPatrol({ exec, inContainer: false, now: t0 + 16 * 60_000 });
    expect(r3.skipped).toBeUndefined();
  });

  it('容器内（inContainer:true）所有命令包 ssh BatchMode 三件套', async () => {
    const exec = makeExec();
    await runLaunchdPatrol({ exec, inContainer: true });
    for (const [cmd] of exec.mock.calls) {
      expect(cmd).toMatch(/^ssh -i .*id_ed25519 -o StrictHostKeyChecking=no -o UserKnownHostsFile=\/dev\/null -o BatchMode=yes -o ConnectTimeout=10 administrator@host\.docker\.internal '/);
    }
  });
});
```

注意：makeExec 匹配 `launchctl print system/<label>` 时先于端口匹配即可；`inContainer:true` 时 fake exec 收到的是包了 ssh 的整串命令，`cmd.includes/match` 对内层命令依然命中（单引号包裹不影响子串匹配）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/launchd-patrol.test.js`
Expected: FAIL — `Cannot find module '../launchd-patrol.js'`

- [ ] **Step 3: commit-1（fail test）**

```bash
git add packages/brain/src/__tests__/launchd-patrol.test.js
git commit -m "test: launchd-patrol manifest 核对失败测试（TDD Red）"
```

- [ ] **Step 4: 写最小实现**

`packages/brain/src/launchd-patrol.js`：

```js
/**
 * launchd-patrol.js — 宿主机 launchd 服务巡检哨兵（任务 a5a6209a）
 *
 * 背景：launchd 服务被静默禁用/不加载已两次独立引发多天无告警生产故障
 * （07-08 zenithjoy-api 502 三天；07-10 com.cecelia.bridge 被 disabled，PR #3768）。
 * 本机 gui/501 域不存在 → ~/Library/LaunchAgents 永不加载，用 launchd 守 launchd
 * 是循环依赖，故守卫放 Brain（docker unless-stopped，存活性与宿主 launchd 独立）。
 *
 * 每 15min（模块自 gate）核对预期服务清单：
 *   - MUST_RUN_DAEMONS：系统域须 enabled + loaded + state=running
 *   - MUST_LOAD_DAEMONS：周期型，须 enabled + loaded（无常驻 pid）
 *   - MUST_LISTEN_PORTS：端口存活（双信号判定点 d172e54a：抓 launchd 管不到的
 *     nohup 孤儿宕机；zenithjoy-api 5200 与进程管理方式解耦）
 *   - EXPECTED_DISABLED：显式废弃名单，出现在 disabled 集合属预期不告警
 *     （判定点 6e9db0a8：frontend 判废弃，5211 已由 docker Dashboard 服务）
 *
 * 异常 → sendBark（dedupeKey DB 级 6h 去重，跨重启）+ raise P1（小时汇总通道）。
 * 宿主 ssh 不可达 → fail-open 不告警（照 harness-skill-relay 哲学；连续不可达由
 * scheduler_job_last_run 哨兵 + 战报兜底观测）。
 */
import { existsSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { raise } from './alerting.js';
import { sendBark } from './notifier.js';

export const MUST_RUN_DAEMONS = ['com.cecelia.bridge'];
export const MUST_LOAD_DAEMONS = [
  'com.cecelia.bridge-keepalive',
  'com.cecelia.token-refresh',
  'com.cecelia.pf-firewall',
];
export const MUST_LISTEN_PORTS = [
  { port: 3457, name: 'cecelia-bridge' },
  { port: 5200, name: 'zenithjoy-api' },
];
export const EXPECTED_DISABLED = ['com.cecelia.frontend', 'com.n8n'];

const INTERVAL_MS = parseInt(
  process.env.LAUNCHD_PATROL_INTERVAL_MS || String(15 * 60 * 1000),
  10,
);
const BARK_DEDUPE_TTL_SEC = 6 * 3600;
const EXEC_TIMEOUT_MS = 20_000;

let lastRunAt = 0;
export function __resetLaunchdPatrolForTest() {
  lastRunAt = 0;
}

function defaultExec(cmd) {
  return execSync(cmd, {
    encoding: 'utf8',
    timeout: EXEC_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** 容器内包 ssh 逃逸宿主（staging-e2e-runner.js spawnReviewPreview 同款三件套），宿主直跑原样返回 */
function buildHostCmd(cmd, inContainer) {
  if (!inContainer) return cmd;
  const target = process.env.CECELIA_HOST_EXEC_SSH || 'administrator@host.docker.internal';
  const key = `${homedir()}/.ssh/id_ed25519`;
  const quoted = `'${cmd.replace(/'/g, `'\\''`)}'`;
  return `ssh -i ${key} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes -o ConnectTimeout=10 ${target} ${quoted}`;
}

export function parseDisabledSet(out) {
  const set = new Set();
  for (const m of String(out).matchAll(/"([^"]+)"\s*=>\s*disabled/g)) set.add(m[1]);
  return set;
}

/**
 * scheduler-jobs handler（needsPool:false）。opts 仅供测试注入。
 * @returns {Promise<{skipped?:true}|{ok:false,reason:string}|{ok:true,checked:number,anomalies:string[]}>}
 */
export async function runLaunchdPatrol(opts = {}) {
  const now = opts.now ?? Date.now();
  if (now - lastRunAt < INTERVAL_MS) return { skipped: true };
  lastRunAt = now;

  const exec = opts.exec || defaultExec;
  const inContainer = opts.inContainer ?? existsSync('/.dockerenv');
  const run = (cmd) => exec(buildHostCmd(cmd, inContainer));

  // 首条命令兼做连通性探针：宿主不可达 → fail-open（不告警服务异常）
  let disabledOut;
  try {
    disabledOut = run('launchctl print-disabled system');
  } catch (e) {
    console.warn('[launchd-patrol] 宿主不可达，本轮跳过：', e.message?.slice(0, 200));
    return { ok: false, reason: 'host_unreachable' };
  }

  const disabledSet = parseDisabledSet(disabledOut);
  const anomalies = [];

  for (const label of [...MUST_RUN_DAEMONS, ...MUST_LOAD_DAEMONS]) {
    if (disabledSet.has(label)) {
      anomalies.push(`disabled:${label}`);
      continue;
    }
    let printOut;
    try {
      printOut = run(`launchctl print system/${label}`);
    } catch {
      anomalies.push(`not_loaded:${label}`);
      continue;
    }
    if (MUST_RUN_DAEMONS.includes(label) && !/state = running/.test(printOut)) {
      anomalies.push(`not_running:${label}`);
    }
  }

  for (const { port, name } of MUST_LISTEN_PORTS) {
    try {
      run(`nc -z -G 3 localhost ${port}`);
    } catch {
      anomalies.push(`port_down:${port}(${name})`);
    }
  }

  const checked = MUST_RUN_DAEMONS.length + MUST_LOAD_DAEMONS.length + MUST_LISTEN_PORTS.length;

  if (anomalies.length > 0) {
    const msg = `宿主 launchd 巡检发现 ${anomalies.length} 项异常: ${anomalies.join(', ')}`;
    console.warn(`[launchd-patrol] ${msg}`);
    const fingerprint = [...anomalies].sort().join('|');
    try {
      await sendBark('launchd 巡检异常', msg, {
        dedupeKey: `launchd-patrol:${fingerprint}`,
        dedupeTtlSec: BARK_DEDUPE_TTL_SEC,
      });
    } catch (e) {
      console.warn('[launchd-patrol] sendBark 失败：', e.message);
    }
    try {
      await raise('P1', 'launchd_patrol_anomaly', msg);
    } catch (e) {
      console.warn('[launchd-patrol] raise 失败：', e.message);
    }
  }

  return { ok: true, checked, anomalies };
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/launchd-patrol.test.js`
Expected: PASS（10 个用例全绿）

- [ ] **Step 6: commit-2（实现）**

```bash
git add packages/brain/src/launchd-patrol.js
git commit -m "feat(brain): launchd-patrol 宿主服务巡检哨兵（manifest 核对+P1/Bark 告警）"
```

---

### Task 2: 注册进 scheduler-jobs（TDD）

**Files:**
- Modify: `packages/brain/src/scheduler-jobs.js`（import 区 + JOBS 表）
- Modify: `packages/brain/src/__tests__/scheduler-jobs.test.js`（vi.mock 区、名单数组、needsPool 断言、4 处 `toHaveLength(11)`、1 处 `sentinelCalls toHaveLength(11)` → 全部 12）

- [ ] **Step 1: 先改注册表测试（Red）**

`__tests__/scheduler-jobs.test.js` 四处修改：

1. vi.mock 区（`vi.mock('../receipt-collector.js', ...)` 之后）加：

```js
vi.mock('../launchd-patrol.js', () => ({
  runLaunchdPatrol: vi.fn().mockResolvedValue({ skipped: true }),
}));
```

2. import 区（`import { runReceiptCollector } ...` 附近）加：

```js
import { runLaunchdPatrol } from '../launchd-patrol.js';
```

3. 名单测试改为 12 个：

```js
  it('JOBS 注册了 12 个 job', () => {
    expect(JOBS.map((j) => j.name)).toEqual([
      'arch-review', 'ci-patrol', 'strategy-trigger', 'conversation-digest', 'capture-digestion', 'daily-backup', 'line-dreaming', 'ledger-hygiene', 'battle-report', 'capture-triage', 'receipt-collector', 'launchd-patrol',
    ]);
  });
```

4. needsPool 断言测试加一行（`expect(runReceiptCollector).toHaveBeenCalledWith(pool);` 之后）：

```js
    expect(runLaunchdPatrol).toHaveBeenCalledWith();
```

5. 全文件把 `toHaveLength(11)` 全部改成 `toHaveLength(12)`（共 4 处：调用全部 job / 单 job reject / 哨兵 upsert / 哨兵写入失败）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/scheduler-jobs.test.js`
Expected: FAIL — JOBS 名单少 `launchd-patrol`

- [ ] **Step 3: commit-1（fail test）**

```bash
git add packages/brain/src/__tests__/scheduler-jobs.test.js
git commit -m "test: scheduler-jobs 注册表期待 launchd-patrol job（TDD Red）"
```

- [ ] **Step 4: 注册 job**

`scheduler-jobs.js`：import 区（`import { runReceiptCollector } from './receipt-collector.js';` 之后）加：

```js
import { runLaunchdPatrol } from './launchd-patrol.js';
```

JOBS 数组末尾（receipt-collector 条目后）加：

```js
  { name: 'launchd-patrol', needsPool: false, timeoutMs: DEFAULT_TIMEOUT_MS, handler: runLaunchdPatrol, description: '宿主 launchd 服务巡检（自带15min gate，manifest核对，异常P1+Bark，a5a6209a）' },
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/scheduler-jobs.test.js src/__tests__/launchd-patrol.test.js`
Expected: PASS 全绿

- [ ] **Step 6: commit-2（实现）**

```bash
git add packages/brain/src/scheduler-jobs.js
git commit -m "feat(brain): scheduler-jobs 注册 launchd-patrol 哨兵 job"
```

---

### Task 3: 版本 bump + DevGate + lint

**Files:**
- Modify: `packages/brain/package.json`（version 1.252.0 → 1.253.0，minor：新增功能）
- Modify: `packages/brain/package-lock.json`（两处 version 字段，见 memory version-management 陷阱）
- Modify: `.brain-versions`（末行追加 1.253.0）

- [ ] **Step 1: bump 三文件**

```bash
cd packages/brain && npm version minor --no-git-tag-version && cd ../..
echo "1.253.0" >> .brain-versions
bash scripts/check-version-sync.sh
```

Expected: check-version-sync 全 ✅（若脚本还查其他位置，按其输出补齐）

- [ ] **Step 2: DevGate 三闸**

```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/engine/scripts/devgate/check-dod-mapping.cjs
```

Expected: 全部通过（facts-check 与本改动无交集；DoD mapping 需要 DoD 条目见 Task 4）

- [ ] **Step 3: lint + 全量相关测试**

```bash
cd packages/brain && npx eslint src/launchd-patrol.js src/scheduler-jobs.js && npx vitest run src/__tests__/launchd-patrol.test.js src/__tests__/scheduler-jobs.test.js
```

Expected: eslint 干净、测试全绿

- [ ] **Step 4: commit**

```bash
git add packages/brain/package.json packages/brain/package-lock.json .brain-versions
git commit -m "chore(brain): bump 1.253.0（launchd-patrol）"
```

---

### Task 4: PRD/DoD 文件（DevGate DoD→Test 映射）

**Files:**
- Create: `sprints/07120809-launchd-patrol/dod.md`（若 check-dod-mapping 要求特定路径，以其输出为准）

- [ ] **Step 1: 写 DoD**

```markdown
# DoD：launchd-patrol 哨兵

- [x] [BEHAVIOR] 必跑 daemon 被 disabled 时检出并告警 — Test: tests/ packages/brain/src/__tests__/launchd-patrol.test.js
- [x] [BEHAVIOR] daemon 未加载/未运行/端口不通分别检出 — Test: tests/ packages/brain/src/__tests__/launchd-patrol.test.js
- [x] [BEHAVIOR] 废弃名单 disabled 不告警、宿主不可达 fail-open — Test: tests/ packages/brain/src/__tests__/launchd-patrol.test.js
- [x] [BEHAVIOR] job 注册进 scheduler-jobs 且 needsPool:false — Test: tests/ packages/brain/src/__tests__/scheduler-jobs.test.js
- [x] CI 全绿
```

- [ ] **Step 2: commit**

```bash
git add sprints/07120809-launchd-patrol/dod.md
git commit -m "docs: launchd-patrol DoD"
```

---

### 部署后验收（merge 后执行，不在 CI）

1. brain-deploy 后容器内冒烟：`docker exec cecelia-node-brain ssh -i /Users/administrator/.ssh/id_ed25519 -o BatchMode=yes -o StrictHostKeyChecking=no administrator@host.docker.internal 'launchctl print system/com.cecelia.bridge | head -3'` → 输出 state。
2. 等 ≥1 轮后查哨兵：`psql -c "select value_json from working_memory where key='scheduler_job_last_run:launchd-patrol'"` → 有记录且 ok:true。
3. **proven-to-fire**：宿主 `sudo launchctl disable system/com.cecelia.pf-firewall` → 缩短间隔或等 15min → Bark 真响 → 立即 `sudo launchctl enable system/com.cecelia.pf-firewall`。
4. 运维修复：zenithjoy-api nohup 孤儿迁系统域 LaunchDaemon（设计文档"运维修复"节步骤）。
