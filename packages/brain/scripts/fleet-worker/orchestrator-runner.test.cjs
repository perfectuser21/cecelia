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
