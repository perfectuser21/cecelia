'use strict';
const { validateSpec } = require('./workspace-manager.cjs');

const RUN_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';
const RUN_ID_2 = '55555555-5555-4555-8555-555555555555';
const RUN_ID_3 = '66666666-6666-4666-8666-666666666666';
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
    mkdirFn: vi.fn(), openFn: vi.fn(() => 7),
    resolveMainShaFn: vi.fn(async () => 'a'.repeat(40)),
    env: { DB_HOST: '100.79.41.61', CECELIA_ORBSTACK_HOME: '/Users/host-admin' },
    probeCredentialHome: vi.fn(() => ({ root: '/Users/host-admin', uid: 501 })),
    existsFn: vi.fn(() => true),
    ...overrides,
  });
  return { runner, prepared, spawned, children };
}

describe('orchestrator-runner', () => {
  it('prepare 复用 workspaceManager 且以 run_id 为工作区键，spec 形状通过真实 validateSpec', async () => {
    const { runner, prepared } = build();
    const receipt = await runner.prepare({ run_id: RUN_ID, task_id: RUN_ID, repo: 'perfectuser21/cecelia' });
    expect(prepared[0]).toMatchObject({
      repo: 'perfectuser21/cecelia',
      attempt_id: RUN_ID,
      run_id: RUN_ID,
      branch: `cp-orch-${RUN_ID.slice(0, 8)}`,
      expected_head_sha: null,
      mode: 'read-write',
    });
    expect(prepared[0]).not.toHaveProperty('task_id'); // SPEC_FIELDS 白名单不认 task_id
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

  // 2026-09-24 实证（任务 281aa798）：Brain 侧 prepare 请求超时放弃后，fleet-worker 这边的作业
  // 停在 prepared 永远不 start，active() 一直计入 → maxConcurrent=2 只跑 1 条也持续 429。
  // prepared 必须有 TTL：过期视为终态释放槽位，迟到的 start 得 410。
  it('prepared 作业超过 TTL 未 start → 释放槽位，新 prepare 不再 429', async () => {
    let now = 1_000_000;
    const { runner } = build({ maxConcurrent: 1, preparedTtlMs: 10 * 60_000, nowFn: () => now });
    await runner.prepare({ run_id: RUN_ID, task_id: RUN_ID, repo: 'perfectuser21/cecelia' });
    await expect(
      runner.prepare({ run_id: RUN_ID_2, task_id: RUN_ID_2, repo: 'perfectuser21/cecelia' }),
    ).rejects.toThrow('orchestrator_slots_exhausted');
    now += 11 * 60_000;
    await expect(
      runner.prepare({ run_id: RUN_ID_2, task_id: RUN_ID_2, repo: 'perfectuser21/cecelia' }),
    ).resolves.toMatchObject({ status: 'prepared' });
  });

  it('过期的 prepared 作业迟到 start → orchestrator_prepared_expired（410），不占槽', async () => {
    let now = 1_000_000;
    const { runner, spawned } = build({ maxConcurrent: 1, preparedTtlMs: 10 * 60_000, nowFn: () => now });
    await runner.prepare({ run_id: RUN_ID, task_id: RUN_ID, repo: 'perfectuser21/cecelia' });
    now += 11 * 60_000;
    await expect(runner.start(RUN_ID, { controller_session_id: SESSION_ID, controller_generation: 1 }))
      .rejects.toMatchObject({ message: 'orchestrator_prepared_expired', statusCode: 410 });
    expect(spawned).toHaveLength(0);
  });

  it('TTL 内 start 照常（默认 TTL 不影响正常 prepare→start 节奏）', async () => {
    let now = 1_000_000;
    const { runner } = build({ maxConcurrent: 1, preparedTtlMs: 10 * 60_000, nowFn: () => now });
    await runner.prepare({ run_id: RUN_ID, task_id: RUN_ID, repo: 'perfectuser21/cecelia' });
    now += 9 * 60_000;
    await expect(runner.start(RUN_ID, { controller_session_id: SESSION_ID, controller_generation: 1 }))
      .resolves.toMatchObject({ status: 'running' });
  });

  it('未 prepare 直接 start → orchestrator_not_prepared', async () => {
    const { runner } = build();
    await expect(runner.start(RUN_ID, { controller_session_id: SESSION_ID, controller_generation: 1 }))
      .rejects.toThrow('orchestrator_not_prepared');
  });

  it('槽位预占：workspaceManager.prepare 失败时释放槽位，同一 run_id 可重试而非 orchestrator_already_exists', async () => {
    let callCount = 0;
    const flakyWorkspaceManager = {
      prepare: vi.fn(async (spec) => {
        validateSpec(spec, REPO_ALLOWLIST);
        callCount += 1;
        if (callCount === 1) throw new Error('workspace_boom');
        return { path: `/ws/${spec.attempt_id}` };
      }),
    };
    const { runner } = build({ workspaceManager: flakyWorkspaceManager, maxConcurrent: 1 });
    await expect(
      runner.prepare({ run_id: RUN_ID, task_id: RUN_ID, repo: 'perfectuser21/cecelia' }),
    ).rejects.toThrow('workspace_boom');
    // 槽位应已释放：同一 run_id 重新 prepare 应正常走到 workspaceManager.prepare 第二次调用，
    // 而不是被判定为 orchestrator_already_exists（证明失败分支没有把占位 job 遗留在 jobs 里）。
    await expect(
      runner.prepare({ run_id: RUN_ID, task_id: RUN_ID, repo: 'perfectuser21/cecelia' }),
    ).resolves.toMatchObject({ status: 'prepared' });
    expect(callCount).toBe(2);
  });

  it('C1：exit 钩子释放槽位——进程退出后第 3 个 prepare 不再撞 slots_exhausted', async () => {
    const { runner, children } = build({ maxConcurrent: 2 });
    await runner.prepare({ run_id: RUN_ID, task_id: RUN_ID, repo: 'perfectuser21/cecelia' });
    await runner.start(RUN_ID, { controller_session_id: SESSION_ID, controller_generation: 1 });
    await runner.prepare({ run_id: RUN_ID_2, task_id: RUN_ID_2, repo: 'perfectuser21/cecelia' });
    await runner.start(RUN_ID_2, { controller_session_id: SESSION_ID, controller_generation: 1 });
    // 满员：两个槽位都在 running，第 3 个 prepare 必须被拒
    await expect(
      runner.prepare({ run_id: RUN_ID_3, task_id: RUN_ID_3, repo: 'perfectuser21/cecelia' }),
    ).rejects.toThrow('orchestrator_slots_exhausted');
    // 第一个 job 的宿主进程退出（模拟 run.js 跑完），触发 exit 钩子
    children[0]._emit('exit', 0);
    expect((await runner.inspect(RUN_ID)).status).toBe('done');
    // 槽位应已释放，第 3 个 prepare 现在必须成功
    await expect(
      runner.prepare({ run_id: RUN_ID_3, task_id: RUN_ID_3, repo: 'perfectuser21/cecelia' }),
    ).resolves.toMatchObject({ status: 'prepared' });
  });

  it('C1：非 0 退出码 → job 置 failed（同样释放槽位）', async () => {
    const { runner, children } = build({ maxConcurrent: 1 });
    await runner.prepare({ run_id: RUN_ID, task_id: RUN_ID, repo: 'perfectuser21/cecelia' });
    await runner.start(RUN_ID, { controller_session_id: SESSION_ID, controller_generation: 1 });
    children[0]._emit('exit', 1);
    expect((await runner.inspect(RUN_ID)).status).toBe('failed');
  });

  it('C2：spawn 触发 error 事件 → job 置 failed，不抛顶层异常', async () => {
    const { runner, children } = build({ maxConcurrent: 1 });
    await runner.prepare({ run_id: RUN_ID, task_id: RUN_ID, repo: 'perfectuser21/cecelia' });
    await runner.start(RUN_ID, { controller_session_id: SESSION_ID, controller_generation: 1 });
    // 不应该抛出/reject——异步 spawn error 由内部 handler 兜住
    expect(() => children[0]._emit('error', new Error('ENOENT: spawn失败'))).not.toThrow();
    expect((await runner.inspect(RUN_ID)).status).toBe('failed');
  });

  it('inspect/terminal：非法 run_id → 400 orchestrator_run_id_invalid', async () => {
    const { runner } = build();
    await expect(runner.inspect('not-a-uuid')).rejects.toThrow('orchestrator_run_id_invalid');
    await expect(runner.terminal('not-a-uuid', {})).rejects.toThrow('orchestrator_run_id_invalid');
  });

  it('start 注入凭据根与可信属主 uid，runner/skills 走 CECELIA_ORCHESTRATOR_RUNNER_ROOT（回填 09-20 热修）', async () => {
    const { runner, spawned } = build({
      env: { DB_HOST: 'x', CECELIA_ORBSTACK_HOME: '/Users/host-admin', CECELIA_ORCHESTRATOR_RUNNER_ROOT: '/srv/runner-checkout' },
    });
    await runner.prepare({ run_id: RUN_ID, task_id: RUN_ID, repo: 'perfectuser21/cecelia' });
    await runner.start(RUN_ID, { controller_session_id: SESSION_ID, controller_generation: 1 });
    const { args, opts } = spawned[0];
    expect(args[0]).toBe('/srv/runner-checkout/packages/brain/src/orchestrator/run.js');
    expect(opts.env).toMatchObject({
      CECELIA_CREDENTIAL_HOME_ROOT: '/Users/host-admin',
      CECELIA_CREDENTIAL_TRUSTED_UIDS: '501',
      CECELIA_SKILLS_ROOT: '/srv/runner-checkout/packages/workflows/skills',
      REPO_ROOT: `/ws/${RUN_ID}`,
    });
  });

  it('runner root 缺省为 /private/var/lib/cecelia/runner-checkout（不再指向任务 worktree）', async () => {
    const { runner, spawned } = build();
    await runner.prepare({ run_id: RUN_ID, task_id: RUN_ID, repo: 'perfectuser21/cecelia' });
    await runner.start(RUN_ID, { controller_session_id: SESSION_ID, controller_generation: 1 });
    expect(spawned[0].args[0]).toBe('/private/var/lib/cecelia/runner-checkout/packages/brain/src/orchestrator/run.js');
  });

  it('凭据根探测失败 → start 500 orchestrator_credential_home_unavailable，run 置 failed 终态、不 spawn、槽位释放、重放 409', async () => {
    const { runner, spawned } = build({
      probeCredentialHome: vi.fn(() => { throw new Error('nope'); }),
      maxConcurrent: 1,
    });
    await runner.prepare({ run_id: RUN_ID, task_id: RUN_ID, repo: 'perfectuser21/cecelia' });
    const startErr = await runner.start(RUN_ID, { controller_session_id: SESSION_ID, controller_generation: 1 })
      .catch((err) => err);
    expect(startErr).toMatchObject({ message: 'orchestrator_credential_home_unavailable', statusCode: 500 });
    expect(startErr.cause).toMatchObject({ message: 'nope' });
    expect(spawned).toHaveLength(0);
    expect((await runner.inspect(RUN_ID)).status).toBe('failed');
    await expect(runner.prepare({ run_id: RUN_ID_2, task_id: RUN_ID_2, repo: 'perfectuser21/cecelia' }))
      .resolves.toMatchObject({ status: 'prepared' });
    await expect(runner.start(RUN_ID, { controller_session_id: SESSION_ID, controller_generation: 1 }))
      .rejects.toMatchObject({ message: 'orchestrator_not_startable', statusCode: 409 });
    await expect(runner.prepare({ run_id: RUN_ID, task_id: RUN_ID, repo: 'perfectuser21/cecelia' }))
      .rejects.toMatchObject({ message: 'orchestrator_already_exists', statusCode: 409 });
  });

  it('runner 入口不存在 → start 500 orchestrator_runner_root_unavailable，run 置 failed、不 spawn、槽位释放', async () => {
    const existsFn = vi.fn(() => false);
    const { runner, spawned } = build({
      env: { DB_HOST: 'x', CECELIA_ORBSTACK_HOME: '/Users/host-admin', CECELIA_ORCHESTRATOR_RUNNER_ROOT: '/srv/missing' },
      existsFn,
      maxConcurrent: 1,
    });
    await runner.prepare({ run_id: RUN_ID, task_id: RUN_ID, repo: 'perfectuser21/cecelia' });
    await expect(runner.start(RUN_ID, { controller_session_id: SESSION_ID, controller_generation: 1 }))
      .rejects.toMatchObject({ message: 'orchestrator_runner_root_unavailable', statusCode: 500 });
    expect(existsFn).toHaveBeenCalledWith('/srv/missing/packages/brain/src/orchestrator/run.js');
    expect(spawned).toHaveLength(0);
    expect((await runner.inspect(RUN_ID)).status).toBe('failed');
    await expect(runner.prepare({ run_id: RUN_ID_2, task_id: RUN_ID_2, repo: 'perfectuser21/cecelia' }))
      .resolves.toMatchObject({ status: 'prepared' });
  });

  it('spawn 返回非法 pid → 502 orchestrator_spawn_failed，run 置 failed、槽位释放', async () => {
    const { runner } = build({
      spawnFn: vi.fn(() => ({ pid: 0, once: vi.fn(), unref: vi.fn() })),
      maxConcurrent: 1,
    });
    await runner.prepare({ run_id: RUN_ID, task_id: RUN_ID, repo: 'perfectuser21/cecelia' });
    await expect(runner.start(RUN_ID, { controller_session_id: SESSION_ID, controller_generation: 1 }))
      .rejects.toMatchObject({ message: 'orchestrator_spawn_failed', statusCode: 502 });
    expect((await runner.inspect(RUN_ID)).status).toBe('failed');
    await expect(runner.prepare({ run_id: RUN_ID_2, task_id: RUN_ID_2, repo: 'perfectuser21/cecelia' }))
      .resolves.toMatchObject({ status: 'prepared' });
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
