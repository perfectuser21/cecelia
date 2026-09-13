# orchestrator 进程远程化 + 机器角色模型 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Brain 派 harness 任务时经 fleet-worker 远程桥在 primary worker（现 MMV）上启动 orchestrator，同时把 8 处 `us-mac-m4` 字面量提升为机器角色解析。

**Architecture:** 三层保留（Brain 调度 → orchestrator 编排 → provider 执行），只改 orchestrator 的启动位置。新增叶子模块 `machine-registry.js` 作为机器清单+角色的单一事实来源；worker 侧新增 `orchestrator-runner.cjs`（独立槽位池）；Brain 侧新增 `orchestrator-remote-bridge.js`；判活改「租约过期=正面死亡证据」。orchestrator 与 Brain 的脐带是 DB 直连（决策 a9773a84：us-vps postgres 加听 Tailscale）。

**Tech Stack:** Node ESM（brain/src）+ CJS（fleet-worker 脚本）、vitest、pg。

**Spec:** `docs/superpowers/specs/2026-09-13-orchestrator-remote-launch-design.md`

## Global Constraints

- **新代码禁止出现 `us-mac-m4` 字面量**（机器清单数据行除外）——一律角色解析。验收：`grep -rn "'us-mac-m4'" packages/brain/src` 判断逻辑零命中
- TDD：每个任务 commit-1 failing test → commit-2 实现（lint-tdd-commit-order 闸）
- 错误码风格沿用蛇形小写（`orchestrator_bridge_prepare_http_502`）；凭据 broker 既有错误码**一字不改**
- 幂等写库用 `UPDATE … WHERE`（铁律 761f242b）；task.result 回执用固定子键（铁律 55f0d846）
- 判活 fail-open 铁律不破：只有正面证据才判 dead（kernel-liveness.js 头注释）
- worker 侧 `.cjs`、brain 侧 ESM，勿混
- 本 worktree 无 node_modules，首次跑测试前 `cd packages/brain && npm install`（约 6s）
- 版本号走 `changes/` 碎片（{VERSION} 占位），**禁碰五件套**（决策 #5179）

---

### Task 1: machine-registry.js（角色模型 SSOT）

**Files:**
- Create: `packages/brain/src/machine-registry.js`
- Test: `packages/brain/src/__tests__/machine-registry.test.js`

**Interfaces:**
- Produces: `MACHINE_ROLES`、`MACHINES`、`resolvePrimaryWorkerId(): string`、`isPrimaryWorker(id): boolean`、`listComputeWorkerIds(): string[]`、`workerBridgeUrlFor(id, env): string|null`

- [ ] **Step 1: Write the failing test**

```js
// packages/brain/src/__tests__/machine-registry.test.js
import { describe, it, expect } from 'vitest';
import {
  MACHINE_ROLES, MACHINES,
  resolvePrimaryWorkerId, isPrimaryWorker,
  listComputeWorkerIds, workerBridgeUrlFor,
} from '../machine-registry.js';

describe('machine-registry（角色模型 SSOT）', () => {
  it('恰好一台 primary（0 台或多台都是配置错误）', () => {
    const primaries = MACHINES.filter((m) => m.machineRole === MACHINE_ROLES.PRIMARY);
    expect(primaries).toHaveLength(1);
  });

  it('当前 primary 解析为 us-mac-m4（Mac Studio 到货后此断言随清单更新）', () => {
    expect(resolvePrimaryWorkerId()).toBe('us-mac-m4');
    expect(isPrimaryWorker('us-mac-m4')).toBe(true);
    expect(isPrimaryWorker('us-vps')).toBe(false);
    expect(isPrimaryWorker(undefined)).toBe(false);
  });

  it('compute workers = primary + secondary，与旧 COMPUTE_SERVERS 完全一致', () => {
    expect(listComputeWorkerIds().sort()).toEqual(
      ['us-mac-m4', 'xian-mac-m1', 'xian-mac-m4'].sort(),
    );
  });

  it('bridge url：env 覆盖优先，否则 tailscaleIp:5231', () => {
    expect(workerBridgeUrlFor('us-mac-m4', { FLEET_WORKER_US_MAC_M4_URL: 'http://override:5231' }))
      .toBe('http://override:5231');
    expect(workerBridgeUrlFor('us-mac-m4', {})).toBe('http://100.71.151.105:5231');
    expect(workerBridgeUrlFor('nonexistent', {})).toBeNull();
  });

  it('scheduler 不是 compute worker', () => {
    expect(listComputeWorkerIds()).not.toContain('us-vps');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/brain && npx vitest run src/__tests__/machine-registry.test.js`
Expected: FAIL（模块不存在）

- [ ] **Step 3: Write the implementation**

```js
// packages/brain/src/machine-registry.js
/**
 * machine-registry.js — 机器清单与角色模型（单一事实来源）
 *
 * 决策 2e756506（orchestrator 远程化方案B）+ a9773a84（DB 通路）。
 * 背景：主理人 2026-09-13 定调机器演进——10 月 Mac Studio(2TB/128GB) 到货后
 * 成为主力 worker，MMV 退位。此前 8 处 'us-mac-m4' 字面量的真实语义是
 * 「主力机兼凭据权威」，不是某台具体机器；迁移时会一次性爆发。
 * 本模块把角色提为一等公民：迁移 = 把 machineRole:'primary' 挪到新机器，代码零改动。
 *
 * 铁律：叶子模块，零依赖；判断逻辑禁止出现机器 id 字面量——一律角色解析。
 * 角色语义（引擎-机器绑定铁律 ca6bf8e7）：
 *   scheduler — 只调度不执行（us-vps，内存小）
 *   primary   — 主力 worker：跑 orchestrator + 全 provider；兼凭据权威
 *   secondary — 次级 worker：只跑 Codex
 */

export const MACHINE_ROLES = Object.freeze({
  SCHEDULER: 'scheduler',
  PRIMARY: 'primary',
  SECONDARY: 'secondary',
});

// 完整机器清单：从 routes/infra-status.js 原样迁入（Task 2 删除原定义改为
// re-export），每行新增 machineRole；未参与调度的机器 machineRole: null。
// ⚠️ 实现时把 infra-status.js SERVERS 数组的全部字段原样搬来（含 sshUser/
// publicIp/isLocal 等），下表只标注新增的 machineRole 值：
//   us-mac-m4   → 'primary'
//   us-vps      → 'scheduler'
//   hk-vps      → null
//   xian-mac-m1 → 'secondary'
//   xian-mac-m4 → 'secondary'
//   xian-pc     → null
//   nas         → null
//   （其余若有，一律 null）
export const MACHINES = Object.freeze([
  /* 原 SERVERS 数组整体迁入 + machineRole 字段，见上表 */
]);

const primaries = MACHINES.filter((m) => m.machineRole === MACHINE_ROLES.PRIMARY);
if (primaries.length !== 1) {
  // fail-fast：0 台没有执行主力、>1 台凭据权威二义，都是部署级配置错误
  throw new Error(`machine_registry_primary_invalid:count=${primaries.length}`);
}

export function resolvePrimaryWorkerId() {
  return primaries[0].id;
}

export function isPrimaryWorker(machineId) {
  return machineId != null && machineId === primaries[0].id;
}

export function listComputeWorkerIds() {
  return MACHINES
    .filter((m) => m.machineRole === MACHINE_ROLES.PRIMARY
      || m.machineRole === MACHINE_ROLES.SECONDARY)
    .map((m) => m.id);
}

/** worker 桥地址：FLEET_WORKER_<ID大写下划线>_URL env 覆盖优先，否则 tailscaleIp:5231 */
export function workerBridgeUrlFor(machineId, env = process.env) {
  const machine = MACHINES.find((m) => m.id === machineId);
  if (!machine) return null;
  const envKey = `FLEET_WORKER_${machineId.toUpperCase().replaceAll('-', '_')}_URL`;
  if (env[envKey]) return env[envKey];
  if (!machine.tailscaleIp) return null;
  return `http://${machine.tailscaleIp}:5231`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/brain && npx vitest run src/__tests__/machine-registry.test.js`
Expected: PASS（5 个用例全绿）

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/machine-registry.js packages/brain/src/__tests__/machine-registry.test.js
git commit -m "feat(brain): 机器角色模型 SSOT machine-registry（scheduler/primary/secondary）"
```

---

### Task 2: infra-status / canonical-machine-id 改为派生

**Files:**
- Modify: `packages/brain/src/routes/infra-status.js:20-100`（SERVERS 数组体迁出，改 re-export）
- Modify: `packages/brain/src/orchestrator/preflight/canonical-machine-id.js:1-6`
- Test: 既有测试回归（不新增文件）

**Interfaces:**
- Consumes: Task 1 的 `MACHINES` / `listComputeWorkerIds`
- Produces: `SERVERS`、`COMPUTE_SERVERS`（对既有消费方 fleet-resource-cache.js / selfcheck.js 形状不变）；`CANONICAL_MACHINE_IDS` 语义不变

- [ ] **Step 1: 改 infra-status.js**

```js
// 顶部新增：
import { MACHINES, listComputeWorkerIds } from '../machine-registry.js';

// 删除原 SERVERS 数组字面量定义与原 COMPUTE_SERVERS 定义，替换为：
export const SERVERS = MACHINES;
export const COMPUTE_SERVERS = listComputeWorkerIds();
```

- [ ] **Step 2: 改 canonical-machine-id.js**

```js
// 原：
// const CANONICAL_MACHINE_IDS = Object.freeze(['us-mac-m4','xian-mac-m4','xian-mac-m1']);
// 改为（顺序保证：primary 必须排第一——execution-transport.js 用解构
// [LOCAL_MACHINE_ID, ...REMOTE] = listCanonicalMachineIds()，首位即本机语义）：
import { listComputeWorkerIds, resolvePrimaryWorkerId } from '../../machine-registry.js';

const primaryId = resolvePrimaryWorkerId();
const CANONICAL_MACHINE_IDS = Object.freeze([
  primaryId,
  ...listComputeWorkerIds().filter((id) => id !== primaryId),
]);
```

- [ ] **Step 3: 全量回归**

Run: `cd packages/brain && npm test 2>&1 | tail -20`
Expected: 全绿（尤其 canonical-machine-id / production-transport / fleet-resource-cache / selfcheck 相关既有用例——它们锁的取值没变，只是来源变了）

- [ ] **Step 4: Commit**

```bash
git add packages/brain/src/routes/infra-status.js packages/brain/src/orchestrator/preflight/canonical-machine-id.js packages/brain/src/machine-registry.js
git commit -m "refactor(brain): SERVERS/COMPUTE_SERVERS/CANONICAL_MACHINE_IDS 改为从 machine-registry 派生"
```

---

### Task 3: production-transport 主机身份改角色解析

**Files:**
- Modify: `packages/brain/src/orchestrator/production-transport.js:1-6`
- Test: `packages/brain/src/orchestrator/production-transport.test.js`（补一条派生断言）

**Interfaces:**
- Produces: `DEFAULT_LOCAL_MACHINE_ID`（导出名不变、取值经角色解析，今天仍 === 'us-mac-m4'）

- [ ] **Step 1: 补 failing 派生断言**

```js
// production-transport.test.js 新增：
import { resolvePrimaryWorkerId } from '../machine-registry.js';
it('DEFAULT_LOCAL_MACHINE_ID 由 primary 角色派生（禁字面量）', () => {
  expect(DEFAULT_LOCAL_MACHINE_ID).toBe(resolvePrimaryWorkerId());
});
```

- [ ] **Step 2: 改实现**

```js
// production-transport.js 原：
// export const DEFAULT_LOCAL_MACHINE_ID = 'us-mac-m4';
// 改为：
import { resolvePrimaryWorkerId } from '../machine-registry.js';
export const DEFAULT_LOCAL_MACHINE_ID = resolvePrimaryWorkerId();
```
`:137` 的 `if (localMachineId !== DEFAULT_LOCAL_MACHINE_ID) throw` 守卫**保持不动**（语义自动跟随角色）。

- [ ] **Step 3: 跑该文件测试**

Run: `cd packages/brain && npx vitest run src/orchestrator/production-transport.test.js`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/brain/src/orchestrator/production-transport.js packages/brain/src/orchestrator/production-transport.test.js
git commit -m "refactor(brain): DEFAULT_LOCAL_MACHINE_ID 改为 primary 角色解析"
```

---

### Task 4: worker 侧 orchestrator-runner.cjs（独立槽位池）

**Files:**
- Create: `packages/brain/scripts/fleet-worker/orchestrator-runner.cjs`
- Test: `packages/brain/scripts/fleet-worker/orchestrator-runner.test.cjs`

**Interfaces:**
- Consumes: fleet-worker 既有 `workspaceManager.prepare(spec, {nodeDeps})`（workspace-manager.cjs:290，spec 形状 `{repo, branch, base_sha, attempt_id, run_id}`，返回 `{path, ...}`）
- Produces: `createOrchestratorRunner({workspaceManager, dataRoot, hostname, maxConcurrent, spawnFn, env, resolveMainShaFn}) → {prepare(body), start(id, body), inspect(id), terminal(id, body)}`

- [ ] **Step 1: Write the failing test**

```js
// orchestrator-runner.test.cjs
'use strict';
const RUN_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';

function build(overrides = {}) {
  const { createOrchestratorRunner } = require('./orchestrator-runner.cjs');
  const prepared = [];
  const spawned = [];
  const fakeChild = { pid: 4242, unref: vi.fn(), once: vi.fn() };
  const runner = createOrchestratorRunner({
    workspaceManager: {
      prepare: vi.fn(async (spec) => { prepared.push(spec); return { path: `/ws/${spec.attempt_id}` }; }),
    },
    dataRoot: '/tmp/orch-test',
    hostname: 'test-host',
    maxConcurrent: 1,
    spawnFn: vi.fn((cmd, args, opts) => { spawned.push({ cmd, args, opts }); return fakeChild; }),
    mkdirFn: vi.fn(), openFn: vi.fn(() => 7),
    resolveMainShaFn: vi.fn(async () => 'a'.repeat(40)),
    env: { DB_HOST: '100.79.41.61' },
    ...overrides,
  });
  return { runner, prepared, spawned };
}

describe('orchestrator-runner', () => {
  it('prepare 复用 workspaceManager 且以 run_id 为工作区键', async () => {
    const { runner, prepared } = build();
    const receipt = await runner.prepare({ run_id: RUN_ID, task_id: RUN_ID, repo: 'perfectuser21/cecelia' });
    expect(prepared[0]).toMatchObject({ repo: 'perfectuser21/cecelia', attempt_id: RUN_ID, run_id: RUN_ID });
    expect(receipt).toMatchObject({ orchestrator_id: RUN_ID, status: 'prepared', worktree_path: `/ws/${RUN_ID}` });
  });

  it('base_sha 缺省时经 resolveMainShaFn 解析，显式传入则不解析', async () => {
    const { runner, prepared } = build();
    await runner.prepare({ run_id: RUN_ID, task_id: RUN_ID, repo: 'perfectuser21/cecelia', base_sha: 'b'.repeat(40) });
    expect(prepared[0].base_sha).toBe('b'.repeat(40));
  });

  it('start 在宿主 spawn detached run.js，带 controller 租约参数与 DB env', async () => {
    const { runner, spawned } = build();
    await runner.prepare({ run_id: RUN_ID, task_id: RUN_ID, repo: 'perfectuser21/cecelia' });
    const receipt = await runner.start(RUN_ID, { controller_session_id: SESSION_ID, controller_generation: 3 });
    expect(receipt).toMatchObject({ pid: 4242, host: 'test-host', status: 'running' });
    const { args, opts } = spawned[0];
    expect(args).toEqual(expect.arrayContaining([
      '--task-id', RUN_ID, '--run-id', RUN_ID,
      '--controller-session-id', SESSION_ID, '--controller-generation', '3',
    ]));
    expect(args[0]).toContain('packages/brain/src/orchestrator/run.js');
    expect(opts.detached).toBe(true);
    expect(opts.env.DB_HOST).toBe('100.79.41.61');
    expect(opts.env.CECELIA_HARNESS_RUNTIME).toBe('kernel-v1');
  });

  it('槽位独立：满员 prepare 抛 orchestrator_slots_exhausted（429）', async () => {
    const { runner } = build();
    await runner.prepare({ run_id: RUN_ID, task_id: RUN_ID, repo: 'perfectuser21/cecelia' });
    await expect(
      runner.prepare({ run_id: SESSION_ID, task_id: SESSION_ID, repo: 'perfectuser21/cecelia' }),
    ).rejects.toThrow('orchestrator_slots_exhausted');
  });

  it('未 prepare 直接 start → orchestrator_not_prepared', async () => {
    const { runner } = build();
    await expect(runner.start(RUN_ID, { controller_session_id: SESSION_ID, controller_generation: 1 }))
      .rejects.toThrow('orchestrator_not_prepared');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/brain && npx vitest run scripts/fleet-worker/orchestrator-runner.test.cjs`
Expected: FAIL（模块不存在）

- [ ] **Step 3: Write the implementation**

```js
// orchestrator-runner.cjs
'use strict';
/**
 * orchestrator-runner.cjs — kernel orchestrator 的 worker 侧生命周期（决策 2e756506）。
 *
 * 与 attempt-runner 的分工：attempt = 短周期终端执行体（docker 容器）；
 * orchestrator = 长周期编排进程（宿主裸进程），它内部还会派 attempt 给本机 worker。
 * 槽位必须独立（判定点 854888a0）：共用池会自锁——orchestrator 占满槽位后，
 * 它要派的 attempt 永远拿不到槽位，互相等死。
 *
 * 为什么裸进程不进容器：orchestrator 要回连本机 5231 派 attempt、要直连 us-vps
 * postgres（决策 a9773a84）、要读宿主 provider 账号目录——容器化需为这三条各开
 * 通道且无先例；宿主上它们全是现成的。
 */
const { spawn } = require('node:child_process');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const path = require('node:path');
const execFileAsync = promisify(execFile);

const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SHA_RE = /^[a-f0-9]{40}$/;
const TERMINAL = new Set(['done', 'failed']);

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function createOrchestratorRunner({
  workspaceManager,
  dataRoot,
  hostname,
  maxConcurrent = 2,
  spawnFn = spawn,
  mkdirFn = (p) => fs.mkdirSync(p, { recursive: true, mode: 0o700 }),
  openFn = (p) => fs.openSync(p, 'a'),
  resolveMainShaFn = null,
  repoSourceFor = (repo) => `https://github.com/${repo}.git`,
  env = process.env,
} = {}) {
  if (!workspaceManager || typeof workspaceManager.prepare !== 'function') {
    throw new Error('orchestrator_runner_workspace_manager_required');
  }
  const jobs = new Map(); // run_id → {status, worktreePath, taskId, pid, startedAt}
  const active = () => [...jobs.values()].filter((j) => !TERMINAL.has(j.status)).length;

  const resolveMainSha = resolveMainShaFn ?? (async (repo) => {
    const { stdout } = await execFileAsync(
      'git', ['ls-remote', repoSourceFor(repo), 'refs/heads/main'],
      { timeout: 30_000, maxBuffer: 1024 * 1024 },
    );
    const sha = String(stdout).split(/\s/)[0];
    if (!SHA_RE.test(sha)) throw httpError('orchestrator_main_sha_unresolvable', 502);
    return sha;
  });

  return Object.freeze({
    async prepare(body) {
      const runId = body?.run_id;
      if (!UUID_RE.test(runId ?? '')) throw httpError('orchestrator_run_id_invalid', 400);
      if (!UUID_RE.test(body?.task_id ?? '')) throw httpError('orchestrator_task_id_invalid', 400);
      const repo = body?.repo ?? 'perfectuser21/cecelia';
      const existing = jobs.get(runId);
      if (existing) {
        if (existing.status === 'prepared') return receipt(existing); // 幂等重放
        throw httpError('orchestrator_already_exists', 409);
      }
      if (active() >= maxConcurrent) throw httpError('orchestrator_slots_exhausted', 429);
      const baseSha = SHA_RE.test(body?.base_sha ?? '') ? body.base_sha : await resolveMainSha(repo);
      const workspace = await workspaceManager.prepare(
        { repo, branch: 'main', base_sha: baseSha, attempt_id: runId, run_id: runId },
        { nodeDeps: true },
      );
      const job = {
        runId, taskId: body.task_id, status: 'prepared',
        worktreePath: workspace.path, baseSha, pid: null, host: hostname, startedAt: null,
      };
      jobs.set(runId, job);
      return receipt(job);
    },

    async start(runId, body) {
      const job = jobs.get(runId);
      if (!job) throw httpError('orchestrator_not_prepared', 404);
      if (job.status === 'running') return receipt(job); // 幂等重放
      if (job.status !== 'prepared') throw httpError(`orchestrator_not_startable:${job.status}`, 409);
      const sessionId = body?.controller_session_id;
      const generation = Number(body?.controller_generation);
      if (!UUID_RE.test(sessionId ?? '') || !Number.isSafeInteger(generation) || generation < 1) {
        throw httpError('controller_lease_identity_missing', 400);
      }
      const runner = path.join(job.worktreePath, 'packages/brain/src/orchestrator/run.js');
      const logDir = path.join(dataRoot, 'orchestrator-logs');
      let stdio = 'ignore';
      let logPath = null;
      try { // 刀0 同款：零遗言不可接受，日志落盘失败不阻断 spawn
        mkdirFn(logDir);
        logPath = path.join(logDir, `kernel-${runId}.log`);
        const fd = openFn(logPath);
        stdio = ['ignore', fd, fd];
      } catch { /* stdio 保持 ignore */ }
      const child = spawnFn(process.execPath, [
        runner,
        '--task-id', job.taskId,
        '--run-id', runId,
        '--controller-session-id', sessionId,
        '--controller-generation', String(generation),
      ], {
        cwd: job.worktreePath,
        detached: true,
        stdio,
        env: {
          ...env,
          CECELIA_HARNESS_RUNTIME: 'kernel-v1',
          REPO_ROOT: job.worktreePath,
          ...(logPath ? { CECELIA_KERNEL_LOG_PATH: logPath } : {}),
        },
      });
      if (!Number.isInteger(child.pid) || child.pid <= 0) {
        throw httpError('orchestrator_spawn_failed', 502);
      }
      child.unref?.();
      job.pid = child.pid;
      job.status = 'running';
      job.startedAt = Date.now();
      return receipt(job);
    },

    async inspect(runId) {
      const job = jobs.get(runId);
      if (!job) throw httpError('orchestrator_not_found', 404);
      return receipt(job);
    },

    async terminal(runId, body) {
      const job = jobs.get(runId);
      if (!job) throw httpError('orchestrator_not_found', 404);
      job.status = body?.outcome === 'failed' ? 'failed' : 'done';
      return receipt(job);
    },
  });

  function receipt(job) {
    return {
      orchestrator_id: job.runId,
      status: job.status,
      worktree_path: job.worktreePath,
      base_sha: job.baseSha,
      pid: job.pid,
      host: hostname,
    };
  }
}

module.exports = { createOrchestratorRunner };
```
（注意：`receipt` 是函数声明提升在工厂函数体内，放 return 之后语法有效；若 lint 不喜欢，移到 return 之前。）

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/brain && npx vitest run scripts/fleet-worker/orchestrator-runner.test.cjs`
Expected: PASS（5 用例）

- [ ] **Step 5: Commit（两段：test 先行）**

```bash
git add packages/brain/scripts/fleet-worker/orchestrator-runner.test.cjs
git commit -m "test(fleet-worker): orchestrator-runner failing tests（TDD commit-1）"
git add packages/brain/scripts/fleet-worker/orchestrator-runner.cjs
git commit -m "feat(fleet-worker): orchestrator-runner——kernel 编排进程的 worker 侧生命周期（独立槽位池）"
```

---

### Task 5: fleet-worker.cjs 接入 /harness/orchestrators/* 路由

**Files:**
- Modify: `packages/brain/scripts/fleet-worker/fleet-worker.cjs`（三处：import 段 / buildRunnerBundle:402 附近 / createServer 路由 :593 附近）
- Test: `packages/brain/scripts/fleet-worker/fleet-worker.test.js`（追加路由用例）

**Interfaces:**
- Consumes: Task 4 `createOrchestratorRunner`
- Produces: HTTP 面 `POST /harness/orchestrators/prepare`（202）、`POST /harness/orchestrators/:id/(start|inspect|terminal)`（200）；鉴权与 attempt 共用同一 bearer token（`CECELIA_FLEET_WORKER_TOKEN_FILE`）

- [ ] **Step 1: 追加 failing 路由测试**（模仿该文件既有 attempt 路由用例的 server 构造方式，新增：）

```js
it('orchestrator prepare 经鉴权后 202，start 返回 pid/host', async () => {
  // 复用文件里既有的 buildServer/token 测试脚手架，orchestratorRunner 注入 stub：
  const orchestratorRunner = {
    prepare: vi.fn(async (b) => ({ orchestrator_id: b.run_id, status: 'prepared', worktree_path: '/ws/x' })),
    start: vi.fn(async (id) => ({ orchestrator_id: id, status: 'running', pid: 77, host: 'w1' })),
    inspect: vi.fn(), terminal: vi.fn(),
  };
  // POST /harness/orchestrators/prepare {run_id, task_id, repo} + Bearer token → 202
  // POST /harness/orchestrators/<id>/start {controller_session_id, controller_generation} → 200 {pid:77}
  // 无 token → 401；未知路径 → 404
});
```
（具体断言写全：status 码、响应体字段、401 分支——参照同文件 attempt 用例的写法逐条抄形。）

- [ ] **Step 2: 实现路由**

```js
// import 段：
const { createOrchestratorRunner } = require('./orchestrator-runner.cjs');

// 顶部常量区（ATTEMPT_ACTION_PATH 旁）：
const ORCHESTRATOR_ACTION_PATH = /^\/harness\/orchestrators\/([a-f0-9-]+)\/(start|inspect|terminal)$/;

// buildRunnerBundle 内（attemptRunner 构造后）：
const orchestratorRunner = createOrchestratorRunner({
  workspaceManager,
  dataRoot: roots.state,
  hostname: workerId,
  maxConcurrent: Number(env.CECELIA_ORCHESTRATOR_MAX_CONCURRENT ?? 2),
  env,
});
// bundle 返回值加 orchestratorRunner；createServer options 透传之。

// createServer 路由（放在 attempt 段之前，同一 validBearer 之后）：
if (request.url?.startsWith('/harness/orchestrators')) {
  if (!orchestratorRunner) { writeJson(response, 404, { error: 'not_found' }); return; }
  if (!validBearer(request, attemptToken)) { writeJson(response, 401, { error: 'unauthorized' }); return; }
  try {
    if (request.method === 'POST' && request.url === '/harness/orchestrators/prepare') {
      const body = await readJson(request, maximumRequestBytes);
      writeJson(response, 202, await orchestratorRunner.prepare(body));
      return;
    }
    const m = request.url.match(ORCHESTRATOR_ACTION_PATH);
    if (request.method === 'POST' && m) {
      const body = await readJson(request, maximumRequestBytes);
      writeJson(response, 200, await orchestratorRunner[m[2]](m[1], body));
      return;
    }
    writeJson(response, 404, { error: 'not_found' });
  } catch (error) {
    const statusCode = requestErrorStatus(error);
    if (statusCode >= 500) {
      console.error(`[fleet-worker] orchestrator_request_failed url=${request.url} reason=${error?.message}`);
    }
    writeJson(response, statusCode, { error: safeString(error.message, 'invalid_request') });
  }
  return;
}
```

- [ ] **Step 3: 跑 worker 全部测试**

Run: `cd packages/brain && npx vitest run scripts/fleet-worker/`
Expected: 新旧全绿

- [ ] **Step 4: Commit（两段式同 Task 4）**

---

### Task 6: Brain 侧 orchestrator-remote-bridge.js

**Files:**
- Create: `packages/brain/src/orchestrator-remote-bridge.js`
- Test: `packages/brain/src/__tests__/orchestrator-remote-bridge.test.js`

**Interfaces:**
- Consumes: Task 1 `resolvePrimaryWorkerId` / `workerBridgeUrlFor`
- Produces: `createOrchestratorBridge({env, fetchFn, prepareTimeoutMs, startTimeoutMs}) → {prepare(input), start(input), inspect(input), targetMachineId}`

- [ ] **Step 1: failing test**

```js
import { describe, it, expect, vi } from 'vitest';
import { createOrchestratorBridge } from '../orchestrator-remote-bridge.js';

const ENV = { KERNEL_FLEET_BRIDGE_TOKEN: 't0k3n', FLEET_WORKER_US_MAC_M4_URL: 'http://worker:5231' };
const RUN_ID = '33333333-3333-4333-8333-333333333333';

function fetchOk(body) {
  return vi.fn(async () => ({ ok: true, status: 202, json: async () => body }));
}

describe('orchestrator-remote-bridge', () => {
  it('prepare 打 primary 的 /harness/orchestrators/prepare，带 Bearer', async () => {
    const fetchFn = fetchOk({ orchestrator_id: RUN_ID, status: 'prepared', worktree_path: '/ws/x' });
    const bridge = createOrchestratorBridge({ env: ENV, fetchFn });
    const r = await bridge.prepare({ run_id: RUN_ID, task_id: RUN_ID, repo: 'perfectuser21/cecelia' });
    expect(r.worktree_path).toBe('/ws/x');
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('http://worker:5231/harness/orchestrators/prepare');
    expect(init.headers.Authorization).toBe('Bearer t0k3n');
  });

  it('非 2xx → orchestrator_bridge_prepare_http_<code>（禁静默）', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 429, json: async () => ({ error: 'orchestrator_slots_exhausted' }) }));
    const bridge = createOrchestratorBridge({ env: ENV, fetchFn });
    await expect(bridge.prepare({ run_id: RUN_ID, task_id: RUN_ID }))
      .rejects.toThrow('orchestrator_bridge_prepare_http_429:orchestrator_slots_exhausted');
  });

  it('token 缺失 fail-closed', () => {
    expect(() => createOrchestratorBridge({ env: { FLEET_WORKER_US_MAC_M4_URL: 'http://w' } }))
      .toThrow('orchestrator_bridge_token_missing');
  });

  it('targetMachineId = primary（角色解析，禁字面量）', () => {
    const bridge = createOrchestratorBridge({ env: ENV, fetchFn: fetchOk({}) });
    expect(bridge.targetMachineId).toBe('us-mac-m4'); // 今天的取值；Mac Studio 后随清单变
  });
});
```

- [ ] **Step 2: 实现**

```js
// orchestrator-remote-bridge.js
/**
 * Brain → primary worker 的 orchestrator 启动桥（决策 2e756506 方案B）。
 * 不复用 remote-bridge-transport（那是 attempt 形状：租约/回执/凭据信封耦合），
 * orchestrator 只需 prepare/start/inspect 三个薄调用。
 */
import { resolvePrimaryWorkerId, workerBridgeUrlFor } from './machine-registry.js';

const DEFAULT_PREPARE_TIMEOUT_MS = 180_000; // 首次要 clone + npm install
const DEFAULT_START_TIMEOUT_MS = 30_000;

export function createOrchestratorBridge({
  env = process.env,
  fetchFn = globalThis.fetch,
  prepareTimeoutMs = DEFAULT_PREPARE_TIMEOUT_MS,
  startTimeoutMs = DEFAULT_START_TIMEOUT_MS,
} = {}) {
  const targetMachineId = resolvePrimaryWorkerId();
  const baseUrl = workerBridgeUrlFor(targetMachineId, env);
  const token = env.KERNEL_FLEET_BRIDGE_TOKEN;
  if (!baseUrl) throw new Error('orchestrator_bridge_url_missing');
  if (!token) throw new Error('orchestrator_bridge_token_missing');

  async function post(pathname, body, op, timeoutMs) {
    let response;
    try {
      response = await fetchFn(`${baseUrl}${pathname}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new Error(`orchestrator_bridge_${op}_request_failed:${error?.message ?? 'unknown'}`);
    }
    let payload = null;
    try { payload = await response.json(); } catch { /* 保持 null */ }
    if (!response.ok) {
      const detail = payload?.error ? `:${payload.error}` : '';
      throw new Error(`orchestrator_bridge_${op}_http_${response.status}${detail}`);
    }
    return payload;
  }

  return Object.freeze({
    targetMachineId,
    prepare: (input) => post('/harness/orchestrators/prepare', input, 'prepare', prepareTimeoutMs),
    start: ({ run_id, ...rest }) => post(`/harness/orchestrators/${run_id}/start`, rest, 'start', startTimeoutMs),
    inspect: ({ run_id }) => post(`/harness/orchestrators/${run_id}/inspect`, {}, 'inspect', startTimeoutMs),
  });
}
```

- [ ] **Step 3: 跑测试 → PASS；两段式 commit**

---

### Task 7: 闸语义反转 + `_spawnKernelRuntimeRemote`（核心接线）

**Files:**
- Modify: `packages/brain/src/harness-skill-relay.js`（闸段 :406-431 + kernel 分支 :437-446 + 新函数）
- Modify: `tests/gp/f1/step1-local-execution-guard.test.js`（kernel-v1 headless 断言从「拒绝」改为「走远程」；非 kernel 断言保持）
- Test: `tests/gp/f1/step3-orchestrator-remote-launch.test.js`（新建，GP 锚产物）

**Interfaces:**
- Consumes: Task 6 `createOrchestratorBridge`；既有 `createKernelRun` / `finalizeKernelRun` / `deriveGear` / `deriveReviewRequired`
- Produces: `spawnSkillRelaySession` 在 `CECELIA_LOCAL_EXECUTION_ENABLED==='false'` 时：kernel-v1 headless → 远程派发；kernel-v1 headed 与所有非 kernel 路径 → 拒绝（错误码不变 `local_execution_disabled_on_scheduler`）

- [ ] **Step 1: 新建 GP failing test**

```js
// tests/gp/f1/step3-orchestrator-remote-launch.test.js
/**
 * GP F1 step3：闸开着时 kernel-v1 headless 必须走远程 orchestrator 派发。
 * lint-gp-anchor-artifact 要求：真 import 被改模块，不 mock 它。
 */
import { describe, it, expect, vi } from 'vitest';
import { spawnSkillRelaySession } from '../../../packages/brain/src/harness-skill-relay.js';

const TASK_ID = '55555555-5555-4555-8555-555555555555';
const RUN_ID = '66666666-6666-4666-8666-666666666666';

function kernelTask() {
  return {
    id: TASK_ID,
    title: 'remote kernel task',
    payload: { harness_runtime: 'kernel-v1', base_repo: 'https://github.com/perfectuser21/cecelia.git' },
  };
}

function fakeDeps(bridgeCalls) {
  return {
    env: { CECELIA_LOCAL_EXECUTION_ENABLED: 'false' },
    pool: { query: vi.fn(async () => ({ rows: [] })) },
    now: () => new Date('2026-09-13T00:00:00Z'),
    createKernelRun: vi.fn(async () => ({
      created: true,
      run: { id: RUN_ID, controller_session_id: '77777777-7777-4777-8777-777777777777', controller_generation: 1 },
    })),
    finalizeRun: vi.fn(async () => {}),
    orchestratorBridge: {
      targetMachineId: 'primary-under-test',
      prepare: vi.fn(async (input) => { bridgeCalls.push(['prepare', input]); return { worktree_path: '/ws/r', status: 'prepared' }; }),
      start: vi.fn(async (input) => { bridgeCalls.push(['start', input]); return { pid: 999, host: 'primary-under-test', status: 'running' }; }),
    },
  };
}

describe('GP F1 step3 — orchestrator 远程派发', () => {
  it('闸=false + kernel-v1 headless → 经桥 prepare+start，不本机 spawn', async () => {
    const bridgeCalls = [];
    const result = await spawnSkillRelaySession(kernelTask(), fakeDeps(bridgeCalls));
    expect(result.ok).toBe(true);
    expect(result.remote).toBe(true);
    expect(result.pid).toBe(999);
    expect(bridgeCalls.map(([op]) => op)).toEqual(['prepare', 'start']);
    expect(bridgeCalls[1][1]).toMatchObject({ run_id: RUN_ID, controller_generation: 1 });
  });

  it('闸=false + 远程 prepare 失败 → run finalize failed 且错误透传（禁静默）', async () => {
    const bridgeCalls = [];
    const deps = fakeDeps(bridgeCalls);
    deps.orchestratorBridge.prepare = vi.fn(async () => { throw new Error('orchestrator_bridge_prepare_http_429:orchestrator_slots_exhausted'); });
    const result = await spawnSkillRelaySession(kernelTask(), deps);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('orchestrator_bridge_prepare_http_429');
    expect(deps.finalizeRun).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ outcome: 'failed' }));
  });

  it('闸=false + 非 kernel 路径 → 仍拒绝（错误码不变）', async () => {
    const result = await spawnSkillRelaySession(
      { id: TASK_ID, payload: {} },
      { env: { CECELIA_LOCAL_EXECUTION_ENABLED: 'false' } },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('local_execution_disabled_on_scheduler');
  });
});
```

- [ ] **Step 2: Run → FAIL**（当前实现 kernel-v1 也被一刀切拒绝）

- [ ] **Step 3: 改 harness-skill-relay.js**

闸段（:424-429）改为只计算标志、不再提前 return：

```js
  const localExecutionDisabled =
    (deps.env ?? process.env).CECELIA_LOCAL_EXECUTION_ENABLED === 'false';
```

kernel-v1 分支（:437-446）改为：

```js
  if (task.payload?.harness_runtime === 'kernel-v1' && isHeaded) {
    if (localExecutionDisabled) {
      console.warn(`[skill-relay][local-exec-guard] headed kernel 无法远程化 task=${task?.id}`);
      return { ok: false, mode: RELAY_FLAG, error: 'local_execution_disabled_on_scheduler' };
    }
    return _spawnHeadedKernelRuntime(task, { dbPool, now, short, initiativeId, deps });
  }
  if (task.payload?.harness_runtime === 'kernel-v1') {
    if (localExecutionDisabled) {
      // 判定点 e3a41ecc：闸语义=「禁本机起，放行远程」——这是闸 reason 文案的原意
      return _spawnKernelRuntimeRemote(task, { dbPool, now, initiativeId, deps });
    }
    return _spawnKernelRuntime(task, { dbPool, now, initiativeId, deps });
  }
  if (localExecutionDisabled) {
    console.warn(`[skill-relay][local-exec-guard] CECELIA_LOCAL_EXECUTION_ENABLED=false — refusing local harness spawn task=${task?.id}（执行须下放 Mac worker，见决策 96054a8b）`);
    return { ok: false, mode: RELAY_FLAG, error: 'local_execution_disabled_on_scheduler' };
  }
```
（`dbPool/now/isHeaded/initiativeId` 的取值行保持原位置原写法；闸判定移到它们之后。）

新函数（放 `_spawnKernelRuntime` 之后，结构刻意同构便于对读）：

```js
import { createOrchestratorBridge } from './orchestrator-remote-bridge.js';

async function _spawnKernelRuntimeRemote(task, { dbPool, now, initiativeId, deps }) {
  const bridge = deps.orchestratorBridge
    ?? createOrchestratorBridge({ env: deps.env ?? process.env });
  const sprintDir = task.payload?.sprint_dir
    || `sprints/${stampMMDDHHNN(now())}-kernel-${shortId(task.id)}`;
  const reviewRequired = deriveReviewRequired(task);
  const gear = deriveGear(task);
  const createRun = deps.createKernelRun ?? createKernelRun;
  const created = await createRun(dbPool, {
    taskId: task.id,
    initiativeId,
    phase: 'planning',
    journeyId: task.payload?.journey_id || null,
    abilityId: task.ability_id || task.payload?.ability_id || null,
    host: 'kernel-v1',
    deadlineHours: 8,
    createdSource: 'kernel_dispatch_remote',
    gear,
  });
  const runId = created.run?.id;
  if (!runId) throw new Error('kernel-v1 run authority returned no id');
  if (!created.created) {
    return { ok: false, mode: 'kernel-v1', deferred: true, reason: 'kernel_run_exists', runId };
  }
  try {
    const prep = await bridge.prepare({
      run_id: runId,
      task_id: task.id,
      repo: parseBaseRepoOrDefault(task.payload?.base_repo),
      ...(task.payload?.base_sha ? { base_sha: task.payload.base_sha } : {}),
    });
    const started = await bridge.start({
      run_id: runId,
      controller_session_id: created.run.controller_session_id,
      controller_generation: Number(created.run.controller_generation),
    });
    await dbPool.query(
      `UPDATE tasks SET payload = COALESCE(payload,'{}'::jsonb) || $2::jsonb, updated_at=NOW() WHERE id=$1`,
      [task.id, JSON.stringify({
        harness_runtime: 'kernel-v1',
        sprint_dir: sprintDir,
        worktree_path: prep.worktree_path,
        execution_location: `remote:${bridge.targetMachineId}`,
        review_required: reviewRequired,
      })],
    );
    console.log(`[skill-relay][kernel-v1] remote-launched run=${runId} machine=${bridge.targetMachineId} pid=${started.pid ?? '?'}`);
    return { ok: true, mode: 'kernel-v1', runId, remote: true, pid: started.pid, host: started.host, sprintDir, worktreePath: prep.worktree_path };
  } catch (error) {
    const finalizeRun = deps.finalizeRun ?? finalizeKernelRun;
    await finalizeRun(dbPool, {
      runId, expectedTaskId: task.id, outcome: 'failed',
      reason: `kernel_remote_launch_failed:${error.message}`,
    });
    return { ok: false, mode: 'kernel-v1', runId, error: error.message };
  }
}

/** base_repo（URL 或 owner/name）→ worker repoAllowlist 键；解析不出回落 cecelia。 */
function parseBaseRepoOrDefault(baseRepo) {
  if (typeof baseRepo === 'string') {
    const m = baseRepo.match(/([\w-]+\/[\w.-]+?)(?:\.git)?$/);
    if (m) return m[1];
  }
  return 'perfectuser21/cecelia';
}
```

- [ ] **Step 4: 更新 step1-local-execution-guard.test.js**

先读该文件。其中断言「kernel-v1 + 闸=false → 拒绝」的用例改为断言走远程（注入 `deps.orchestratorBridge` stub 同 Step 1 写法）；断言非 kernel 拒绝、缺省放行的用例**原样保留**。

- [ ] **Step 5: 跑 GP 双测 + brain 全量**

Run: `cd packages/brain && npx vitest run ../../tests/gp/f1/step1-local-execution-guard.test.js ../../tests/gp/f1/step3-orchestrator-remote-launch.test.js && npm test 2>&1 | tail -10`
Expected: 全绿

- [ ] **Step 6: 两段式 commit**（test commit 带 `test(gp):` 前缀）

---

### Task 8: kernel-liveness 租约判死（远程判活通道）

**Files:**
- Modify: `packages/brain/src/orchestrator/kernel-run-store.js:127-140`（`loadKernelRun` SELECT 增列 `controller_lease_expires_at`）
- Modify: `packages/brain/src/lib/kernel-liveness.js`（① 心跳与 ② pid 之间插入租约判据）
- Test: `packages/brain/src/lib/__tests__/kernel-liveness.test.js`（已存在，追加用例；helper 沿用该文件既有 fake 形状）

**Interfaces:**
- Produces: `assessKernelLiveness` 新增 verdict 路径 `{verdict:'dead', reason:'controller_lease_expired', source:'lease'}`

- [ ] **Step 1: failing test**

```js
// 追加用例（fake pool 形状参照该文件既有用例；核心三条）：
it('租约过期 + 心跳过期 → dead（远程 orchestrator 唯一判死通道）', async () => {
  const now = Date.parse('2026-09-13T00:10:00Z');
  const run = {
    id: 'r1', phase: 'running',
    orchestrator_heartbeat_at: new Date(now - 10 * 60_000).toISOString(),
    controller_lease_expires_at: new Date(now - 60_000).toISOString(),
    orchestrator_pid: 123, orchestrator_host: 'remote-host',
  };
  const verdict = await assessKernelLiveness({
    pool: fakePool(), task: kernelTask(), run, now: () => now,
  });
  expect(verdict).toMatchObject({ verdict: 'dead', reason: 'controller_lease_expired' });
});

it('心跳新鲜时租约字段不参与（① 先行）', async () => { /* fresh heartbeat → alive 不变 */ });

it('租约列缺失（legacy run）→ 回落 pid 探活，host 不匹配仍 unknown（fail-open 不破）', async () => {
  // controller_lease_expires_at: null + stale heartbeat + host mismatch → verdict unknown
});
```

- [ ] **Step 2: 实现**

kernel-run-store.js `loadKernelRun` SELECT 列表加 `controller_lease_expires_at,`（`loadKernelRunById` 同步加，保持两查询列一致）。

kernel-liveness.js 在 ① 心跳块之后、② pid 块之前插入：

```js
  // ①.5 租约（判定点 0eef6860 + 决策 a9773a84）：跨主机判死的唯一正面证据通道。
  // 契约：orchestrator 心跳写失败即 throw controller_lease_renewal_lost 自杀
  // （heartbeat.js:41）——所以「租约过期」不是"我不知道"，是"它要么死了要么已自杀"。
  // 这不违反 fail-open 铁律：lease 是 orchestrator 自己续的正面存活证明，过期即失活。
  // 心跳新鲜时 ① 已经返回 alive，走到这里说明心跳已 stale。
  const leaseMs = toEpochMs(row.controller_lease_expires_at);
  if (leaseMs != null && now() > leaseMs) {
    return {
      verdict: 'dead', reason: 'controller_lease_expired',
      source: 'lease', runId: row.id,
    };
  }
```

- [ ] **Step 2.5: 验证心跳 throw 自杀路径（spec 错误处理表要求，读代码确认非新增代码）**

确认链路：`heartbeat.js:41` lease 丢失 throw `controller_lease_renewal_lost` → `run.js:500`
`handleKernelProcessFatal` → `run.js:561` `process.exit(1)`。在 Step 1 租约测试的头注释里
引用这三处坐标——这是「租约过期=正面死亡证据」成立的前提，坐标变了测试就该跟着审。

另注（spec「连错 DB 拒启」条）：orchestrator 启动第一读就是按 run_id 读 initiative_runs
（activateQueuedKernelTask / loadKernelRunById），连错库该行不存在 → 响亮失败，天然满足，
无需新增代码；部署段第 4 步验收时顺带确认失败信息可见于 kernel 日志。

- [ ] **Step 3: 跑判活 + watchdog + slot-allocator 相关既有测试**

Run: `cd packages/brain && npx vitest run src/lib src/orchestrator/kernel-run-store* src/harness-relay-watchdog* 2>&1 | tail -8`
Expected: 全绿（旧行为唯一变化：租约过期从 unknown → dead，这正是目的）

- [ ] **Step 4: 两段式 commit**

---

### Task 9: credential brokers 改角色判据（先锁行为）

**Files:**
- Modify: `packages/brain/src/orchestrator/credential-broker.js:144`
- Modify: `packages/brain/src/orchestrator/github-credential-broker.js:36`
- Test: 两个既有 `*.test.js` 各追加锁行为用例

**Interfaces:**
- Produces: 错误码**一字不改**（`credential_broker_us_authority_required` / `github_credential_broker_us_authority_required`）；判据从字面量比较改 `isPrimaryWorker()`

- [ ] **Step 1: 先加锁行为测试（当前实现就该绿——这是"锁"不是"驱动"）**

```js
// 两个 broker 测试各追加：
import { resolvePrimaryWorkerId } from '../machine-registry.js';
it('权威判据锁定：primary 放行、非 primary fail-closed、错误码不变', async () => {
  // controllerMachineId = resolvePrimaryWorkerId() → issue 走到凭据加载
  // controllerMachineId = 'us-vps' → 抛 credential_broker_us_authority_required
  // controllerMachineId = undefined → 同上
});
```
Run：先在**未改实现**时跑，必须绿（证明锁住的是现状）。

- [ ] **Step 2: 改两处判据**

```js
// credential-broker.js 顶部：
import { isPrimaryWorker } from '../machine-registry.js';
// :144 原 if (controllerMachineId !== 'us-mac-m4') → 改：
if (!isPrimaryWorker(controllerMachineId)) {
  fail('credential_broker_us_authority_required');
}
// github-credential-broker.js:36 同型替换，错误码不动。
```

- [ ] **Step 3: 跑两个 broker 测试 + 全量**

Run: `cd packages/brain && npm test 2>&1 | tail -10`
Expected: 全绿

- [ ] **Step 4: 字面量清零验收**

Run: `grep -rn "'us-mac-m4'" packages/brain/src --include='*.js' | grep -v machine-registry.js | grep -v __tests__ | grep -v '\.test\.'`
Expected: 空输出（判断逻辑零命中；测试里作为「今天的取值」断言可留）

- [ ] **Step 5: 两段式 commit**

---

### Task 10: CI 闸配套（contract / smoke / 版本碎片 / DevGate）

**Files:**
- Create: `sprints/09131144-orchestrator-remote-launch/contract-draft.md`
- Create: `packages/brain/scripts/smoke/orchestrator-remote-launch-smoke.sh`
- Modify: `packages/quality/smoke-allowlist.txt`（登记新 smoke）
- Create: `changes/<branch-slug>.md`（版本碎片，{VERSION} 占位）
- Create: `scripts/ci/__tests__/machine-registry-role-guard.test.sh`（配置守卫：改坏角色即红）

- [ ] **Step 1: contract-draft.md**（check-test-coverage 闸要求 `## Test Contract` 表，BEHAVIOR 项名与测试 `it()` 双向子串匹配，`.sh` 免匹配）

```markdown
# Contract — orchestrator 远程化 + 机器角色模型

## Test Contract

| # | 类型 | 覆盖项 | 测试 |
|---|------|--------|------|
| 1 | BEHAVIOR | 恰好一台 primary | packages/brain/src/__tests__/machine-registry.test.js |
| 2 | BEHAVIOR | 闸=false + kernel-v1 headless → 经桥 prepare+start，不本机 spawn | tests/gp/f1/step3-orchestrator-remote-launch.test.js |
| 3 | BEHAVIOR | 闸=false + 非 kernel 路径 → 仍拒绝 | tests/gp/f1/step3-orchestrator-remote-launch.test.js |
| 4 | BEHAVIOR | 槽位独立：满员 prepare 抛 orchestrator_slots_exhausted | packages/brain/scripts/fleet-worker/orchestrator-runner.test.cjs |
| 5 | BEHAVIOR | 租约过期 + 心跳过期 → dead | packages/brain/src/lib/__tests__/kernel-liveness.test.js |
| 6 | BEHAVIOR | 权威判据锁定：primary 放行、非 primary fail-closed、错误码不变 | packages/brain/src/orchestrator/credential-broker.test.js |
| 7 | SMOKE | 闸关必有远程执行路径 | packages/brain/scripts/smoke/orchestrator-remote-launch-smoke.sh |
```
（表中覆盖项文字必须与对应 `it()` 名互为子串——照 Task 各 Step 的 it 名原样抄。）

- [ ] **Step 2: smoke（生产不变量：闸关着的机器必须有远程执行路径）**

```bash
#!/usr/bin/env bash
# Smoke: local_execution.enabled=false 的 Brain 必须 fleet_transport 就绪——
# 否则调度器既不本机执行也无处远程派发 = harness 全类任务静默停摆（96054a8b 的反面）。
# 依赖约束：bash+curl+node，禁 jq（同 local-execution-guard-smoke.sh）。
set -euo pipefail
URL="${BRAIN_URL:-http://localhost:5221}/api/brain/health"
OUT=/tmp/smoke-orchestrator-remote-launch.json
printf '%s\n' "▶️  smoke: orchestrator-remote-launch-smoke.sh"
HTTP_CODE=$(curl -sS -o "$OUT" -w "%{http_code}" "$URL")
[ "$HTTP_CODE" = "200" ] || { echo "❌ HTTP $HTTP_CODE"; cat "$OUT"; exit 1; }
node -e '
const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const le = j.local_execution, ft = j.fleet_transport;
const fail = (m) => { console.error("❌ " + m); process.exit(1); };
if (!le || typeof le.enabled !== "boolean") fail("缺 local_execution");
if (le.enabled === false) {
  if (!ft || ft.enabled !== true) fail("闸关着但 fleet_transport 未就绪——调度器无任何执行路径");
  if (!Array.isArray(ft.worker_machines) || ft.worker_machines.length === 0) fail("无 worker 机器");
}
console.log("✅ orchestrator-remote-launch-smoke OK (enabled=" + le.enabled + ")");
' "$OUT"
```

- [ ] **Step 3: 登记 allowlist + 版本碎片**

```bash
echo "packages/brain/scripts/smoke/orchestrator-remote-launch-smoke.sh" >> packages/quality/smoke-allowlist.txt
cat > changes/cp-09131145-orchestrator-remote-launch.md << 'EOF'
### {VERSION}
- feat(brain): orchestrator 进程远程化——闸开时经 fleet-worker 在 primary worker 启动 kernel（决策 2e756506/a9773a84）
- feat(brain): 机器角色模型 machine-registry（scheduler/primary/secondary），8 处 us-mac-m4 字面量改角色解析
- feat(fleet-worker): /harness/orchestrators/* 端点 + orchestrator-runner 独立槽位池
- fix(brain): kernel 判活新增租约过期判死通道（远程 orchestrator 可判死）
EOF
```

- [ ] **Step 4: 配置守卫 .sh test（proven-to-fire 的 CI 形态）**

```bash
# scripts/ci/__tests__/machine-registry-role-guard.test.sh
#!/usr/bin/env bash
# 守卫：machine-registry 必须恰好一台 primary，且判断逻辑无 us-mac-m4 字面量。
# 亲验报红方法：临时把 xian-mac-m4 的 machineRole 改成 primary → 本测试必红。
set -euo pipefail
cd "$(dirname "$0")/../../.."
node --input-type=module -e '
import { MACHINES } from "./packages/brain/src/machine-registry.js";
const p = MACHINES.filter((m) => m.machineRole === "primary");
if (p.length !== 1) { console.error("primary count=" + p.length); process.exit(1); }
'
HITS=$(grep -rn "'us-mac-m4'" packages/brain/src --include='*.js' \
  | grep -v machine-registry.js | grep -v __tests__ | grep -v '\.test\.' || true)
[ -z "$HITS" ] || { echo "❌ 判断逻辑出现机器字面量:"; echo "$HITS"; exit 1; }
echo "✅ machine-registry role guard OK"
```

- [ ] **Step 5: DevGate 三连 + 全量**

```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/quality/scripts/devgate/check-dod-mapping.cjs
cd packages/brain && npm test 2>&1 | tail -6
```
Expected: 四者全过

- [ ] **Step 6: Commit**

```bash
git add sprints/09131144-orchestrator-remote-launch/contract-draft.md \
  packages/brain/scripts/smoke/orchestrator-remote-launch-smoke.sh \
  packages/quality/smoke-allowlist.txt changes/ scripts/ci/__tests__/machine-registry-role-guard.test.sh
git commit -m "chore(brain): orchestrator 远程化 CI 配套——contract/smoke/版本碎片/角色守卫"
```

---

## 部署段（非代码任务，merge 后按序执行；均已获主理人确认）

1. **us-vps postgres 开 Tailscale 监听**（决策 a9773a84）：`listen_addresses = 'localhost, 100.79.41.61'` + pg_hba `host cecelia cecelia 100.64.0.0/10 scram-sha-256` → reload → **验证非 tailnet 源被拒**
2. **MMV fleet-worker 更新**：主 checkout 拉 main → launchd **`bootout` + `bootstrap`**（`kickstart` 不重读 plist，09-13 交接单坑）→ worker env 加 `DB_HOST=100.79.41.61 DB_PORT=5432 DB_NAME=cecelia DB_USER=cecelia DB_PASSWORD=<凭据>`（从 1Password/CS 取）与 `CECELIA_ORCHESTRATOR_MAX_CONCURRENT=2`
3. **us-vps Brain**：compose 增 `KERNEL_FLEET_REMOTE_CALLBACK_BASE_URL=http://100.79.41.61:5221`（判定点 d3281fb0：回调直指，去掉绕 MMV socat）→ 手动 build+切换（流程照交接单「部署实操（09-13 补）」，含 baseline tag / build 后清盘 / 一次性容器验证）
4. **端到端验收**：重放靶子 task `feef7d3f-c08e-4ee1-acba-a6a4e626edf2` → `initiative_runs.orchestrator_host` 应为 MMV；us-vps `ps aux | grep orchestrator/run.js` 应空
5. **proven-to-fire**：MMV 上 `kill <orchestrator pid>` → 观察 Brain 在租约到期（默认 300s，run.js:418）+ 一个 watchdog 周期内判死重拉——**亲眼看它报红才算守卫**

## 回滚

- 代码：revert PR；闸行为退回一刀切拒绝（与今天等价）
- postgres 监听：删 Tailscale 行 + reload，即回纯 localhost
- Brain 镜像：`docker tag cecelia-brain:<上一版> latest && docker compose up -d node-brain`
