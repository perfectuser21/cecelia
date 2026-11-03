'use strict';
/* global vi, describe, it, expect */
const { validateSpec } = require('./workspace-manager.cjs');

const RUN_ID = '33333333-3333-4333-8333-333333333333';
const REPO_ALLOWLIST = { 'perfectuser21/cecelia': 'x' };

// 制造一个能记住 once() 注册的 handler、供测试手动触发的 fake child。
// 每次 spawn 调用都要返回一个独立实例，否则多任务并发测试会互相覆盖 handler。
function makeFakeChild(pid) {
  const handlers = {};
  const child = {
    pid,
    unref: vi.fn(),
    once: vi.fn((event, cb) => { handlers[event] = cb; }),
  };
  child._emit = (event, ...args) => handlers[event]?.(...args);
  return child;
}

function build(overrides = {}) {
  const { createOrchestratorRunner } = require('./orchestrator-runner.cjs');
  const prepared = [];
  const spawned = [];
  const children = [];
  const fakeChild = makeFakeChild(4242);
  children.push(fakeChild);
  const runner = createOrchestratorRunner({
    workspaceManager: {
      // 回归防线：先跑真实 validateSpec，spec 形状错了这里会真炸，不再被 fake 掩盖。
      prepare: vi.fn(async (spec) => {
        validateSpec(spec, REPO_ALLOWLIST);
        prepared.push(spec);
        return { path: `/ws/${spec.attempt_id}` };
      }),
    },
    dataRoot: '/tmp/orch-test',
    hostname: 'test-host',
    maxConcurrent: 1,
    spawnFn: vi.fn((cmd, args, opts) => {
      spawned.push({ cmd, args, opts });
      // 第一次复用固定 fakeChild（既有用例依赖 pid:4242），之后每次新建一个独立实例。
      const child = spawned.length === 1 ? fakeChild : makeFakeChild(4242 + spawned.length);
      if (spawned.length > 1) children.push(child);
      return child;
    }),
    mkdirFn: vi.fn(), openFn: vi.fn(() => 7), closeFn: vi.fn(),
    resolveMainShaFn: vi.fn(async () => 'a'.repeat(40)),
    env: { DB_HOST: '100.79.41.61', CECELIA_ORBSTACK_HOME: '/Users/host-admin' },
    probeCredentialHome: vi.fn(() => ({ root: '/Users/host-admin', uid: 501 })),
    existsFn: vi.fn(() => true),
    ...overrides,
  });
  return { runner, prepared, spawned, children };
}

describe('orchestrator-runner', () => {

  // 2026-09-24 实证（任务 281aa798）：Brain 侧 prepare 请求超时放弃后，fleet-worker 这边的作业
  // 停在 prepared 永远不 start，active() 一直计入 → maxConcurrent=2 只跑 1 条也持续 429。
  // prepared 必须有 TTL：过期视为终态释放槽位，迟到的 start 得 410。

  it('inspect/terminal：非法 run_id → 400 orchestrator_run_id_invalid', async () => {
    const { runner } = build();
    await expect(runner.inspect('not-a-uuid')).rejects.toThrow('orchestrator_run_id_invalid');
    await expect(runner.terminal('not-a-uuid', {})).rejects.toThrow('orchestrator_run_id_invalid');
  });

  it('默认 probeCredentialHome：根下无任何 .codex-team{1..5}/auth.json 可读 → 抛错；有则返回根属主 uid', () => {
    const { probeCredentialHome } = require('./orchestrator-runner.cjs');
    const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cred-root-'));
    try {
      expect(() => probeCredentialHome(root)).toThrow('credential_home_no_accounts');
      fs.mkdirSync(path.join(root, '.codex-team2'));
      fs.writeFileSync(path.join(root, '.codex-team2', 'auth.json'), '{}');
      expect(probeCredentialHome(root)).toEqual({ root, uid: process.getuid() });
      expect(() => probeCredentialHome('')).toThrow('orbstack_home_invalid');
      expect(() => probeCredentialHome(path.join(root, 'missing'))).toThrow();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

it.each(['prepare','start'])('retired %s never allocates workspace/process/logs',async(action)=>{
 const effect=vi.fn();const {runner,prepared,spawned}=build({openFn:effect,mkdirFn:effect,probeCredentialHome:effect});
 await expect(action==='prepare'?runner.prepare({run_id:RUN_ID,task_id:RUN_ID}):runner.start(RUN_ID,{})).rejects.toMatchObject({statusCode:410,message:'kernel_runtime_retired'});
 expect(prepared).toEqual([]);expect(spawned).toEqual([]);expect(effect).not.toHaveBeenCalled();
});
