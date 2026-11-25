/**
 * 阶段2 Slice1 — staging-e2e-runner 单元测试（mock-based，不起真实 docker / curl / DB）。
 *
 * 覆盖：
 *   - deployStaging: success / skipped(STAGING_SKIP_REASON) / failed(throw)
 *   - runStagingCommand: :5221→:5222 端口重写 / 合法访问 /api/brain（无 planner_drift 拦截）/ 非 0 退出
 *   - runScenarios: 全 PASS / 部分 FAIL（failedScenarios 正确）
 *   - runStagingE2E: no_initiative_id / no_contract / deploy skip / deploy fail / PASS / scenario FAIL
 *     —— verdict 落 staging_e2e_results + 写回 tasks.result + 标 completed
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// updateTaskStatus 内部用真实 db pool，必须 mock 掉
const updateTaskStatus = vi.fn().mockResolvedValue({ success: true });
vi.mock('../task-updater.js', () => ({ updateTaskStatus: (...a) => updateTaskStatus(...a) }));
// db.js 仅作为默认 pool import，测试里全部走注入 opts.pool，但仍 mock 避免真连库
vi.mock('../db.js', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));

const {
  deployStaging,
  runStagingCommand,
  runScenarios,
  runStagingE2E,
  handlePromote,
  checkInitiativeAggregate,
  STAGING_PORT,
  DASHBOARD_STAGING_PORT,
} = await import('../staging-e2e-runner.js');

// 构造一个记录所有 query 的 mock pool
function makeMockPool() {
  const calls = [];
  return {
    calls,
    query: vi.fn(async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [] };
    }),
  };
}

const ACCEPTANCE = {
  scenarios: [
    { name: 'health', covered_tasks: ['t1'], commands: [{ cmd: 'curl localhost:5221/api/brain/tick/status' }] },
  ],
};

beforeEach(() => {
  updateTaskStatus.mockClear();
});

// ─── deployStaging ───────────────────────────────────────────────────────────
describe('deployStaging', () => {
  it('直接调用已退役客户线返回 SKIP 且不执行部署', async () => {
    const exec = vi.fn(() => 'unexpected deployment');
    const result = await deployStaging({ line: 'customer', exec });
    expect(result).toMatchObject({ status: 'skipped', reason: 'zenithjoy_staging_retired' });
    expect(exec).not.toHaveBeenCalled();
  });

  it('正常输出 → success', async () => {
    const exec = () => '=== Staging Deploy SUCCESS ===\n';
    const r = await deployStaging({ exec });
    expect(r.status).toBe('success');
    expect(r.reason).toBeNull();
  });

  it('STAGING_SKIP_REASON=no_docker → skipped（非失败）', async () => {
    const exec = () => 'blah\nSTAGING_SKIP_REASON=no_docker\n';
    const r = await deployStaging({ exec });
    expect(r.status).toBe('skipped');
    expect(r.reason).toBe('no_docker');
  });

  it('脚本抛错但 stdout 含 skip 原因 → 仍 skipped', async () => {
    const exec = () => { const e = new Error('boom'); e.status = 1; e.stdout = 'STAGING_SKIP_REASON=no_env'; throw e; };
    const r = await deployStaging({ exec });
    expect(r.status).toBe('skipped');
    expect(r.reason).toBe('no_env');
  });

  it('脚本抛错且无 skip 原因 → failed', async () => {
    const exec = () => { const e = new Error('real fail'); e.status = 1; throw e; };
    const r = await deployStaging({ exec });
    expect(r.status).toBe('failed');
    expect(r.reason).toBe('deploy_failed');
  });
});

// ─── runStagingCommand ─────────────────────────────────────────────────────────
describe('runStagingCommand', () => {
  it('把 :5221 重写为 host.docker.internal:5222（容器内 localhost 不通 staging，合法访问 /api/brain）', () => {
    let seen = null;
    const exec = (cmd) => { seen = cmd; return 'ok'; };
    const r = runStagingCommand({ cmd: 'curl localhost:5221/api/brain/tick/status' }, { exec });
    expect(seen).toContain(`host.docker.internal:${STAGING_PORT}/api/brain/tick/status`);
    expect(r.exitCode).toBe(0);
  });

  it('127.0.0.1:5221 也重写为 host.docker.internal:5222', () => {
    let seen = null;
    const exec = (cmd) => { seen = cmd; return 'ok'; };
    runStagingCommand({ cmd: 'curl 127.0.0.1:5221/health' }, { exec });
    expect(seen).toContain(`host.docker.internal:${STAGING_PORT}/health`);
  });

  it('空 cmd → exitCode 1', () => {
    expect(runStagingCommand({ cmd: '   ' }, {}).exitCode).toBe(1);
  });

  it('exec 抛错 → 非 0 + 含 stderr', () => {
    const exec = () => { const e = new Error('fail'); e.status = 7; e.stderr = 'boom'; throw e; };
    const r = runStagingCommand({ cmd: 'curl x' }, { exec });
    expect(r.exitCode).toBe(7);
    expect(r.output).toContain('boom');
  });

  // P1#5（2026-06-27 审计）：内部线 dashboard staging（:5223 是静态站，无 /api/brain）。
  // mac_web 合同实际引用 localhost:5174(dashboard) + localhost:5221(brain)。旧逻辑把 5221→5223
  // → brain 断言打到 dashboard 静态站必 FAIL，且 5174 完全不映射。正确：5174→5223，5221 保持活 brain。
  it('内部线(port=5223)：5174(dashboard)→:5223，5221(brain) 保持活 brain :5221 不打到静态站', () => {
    let seen = null;
    const exec = (cmd) => { seen = cmd; return 'ok'; };
    runStagingCommand(
      { cmd: 'curl localhost:5174/pipeline/x ; curl localhost:5221/api/brain/tasks/x' },
      { exec, port: DASHBOARD_STAGING_PORT },
    );
    expect(seen).toContain(`host.docker.internal:${DASHBOARD_STAGING_PORT}/pipeline/x`); // dashboard → 5223
    expect(seen).toContain('host.docker.internal:5221/api/brain/tasks/x');              // brain 保持活 5221
    expect(seen).not.toContain(`host.docker.internal:${DASHBOARD_STAGING_PORT}/api/brain`); // brain 不打到静态站
  });

  it('非内部线(port=5222)：维持 5221→:5222（回归不变）', () => {
    let seen = null;
    const exec = (cmd) => { seen = cmd; return 'ok'; };
    runStagingCommand({ cmd: 'curl localhost:5221/api/brain/x' }, { exec, port: STAGING_PORT });
    expect(seen).toContain(`host.docker.internal:${STAGING_PORT}/api/brain/x`);
  });


});

// ─── runScenarios ──────────────────────────────────────────────────────────────
describe('runScenarios', () => {
  it('全部命令 0 → PASS', () => {
    const exec = () => 'ok';
    const r = runScenarios(ACCEPTANCE, { exec });
    expect(r.verdict).toBe('PASS');
    expect(r.scenariosTotal).toBe(1);
    expect(r.scenariosPassed).toBe(1);
    expect(r.failedScenarios).toHaveLength(0);
  });

  it('某命令非 0 → FAIL + failedScenarios 记录场景名', () => {
    const exec = () => { const e = new Error('x'); e.status = 1; throw e; };
    const r = runScenarios(ACCEPTANCE, { exec });
    expect(r.verdict).toBe('FAIL');
    expect(r.failedScenarios[0].name).toBe('health');
  });

  it('非法合同结构 → 抛错', () => {
    expect(() => runScenarios({}, {})).toThrow();
  });
});

// ─── runStagingE2E 全流程 ───────────────────────────────────────────────────────
describe('runStagingE2E', () => {
  const task = { id: 'task-1', payload: { initiative_id: 'init-1', pr_url: 'https://pr/1' } };

  function insertedResult(pool) {
    return pool.calls.find((c) => /INSERT INTO staging_e2e_results/.test(c.sql));
  }

  it.each([
    { base_repo: 'perfectuser21/zenithjoy', pr_url: 'https://pr/zj' },
    { baseRepo: 'ZenithJoy', pr_url: 'https://pr/zj' },
    { pr_urls: ['https://github.com/perfectuser21/zenithjoy-workspace/pull/2588'] },
  ])('恢复旧客户任务时记录退役，保留历史核验', async (payload) => {
    const pool = makeMockPool();
    const deploy = vi.fn(() => ({ status: 'skipped', reason: 'no_docker', output: '' }));
    const loadAcceptance = vi.fn(async () => ACCEPTANCE);
    const notify = vi.fn();
    const r = await runStagingE2E(
      { id: 'task-zj', payload: { ...payload, initiative_id: 'init-zj' } },
      { pool, deploy, loadAcceptance, notify },
    );
    expect(r).toMatchObject({ success: true, verdict: 'SKIP', reason: 'zenithjoy_staging_retired' });
    expect(deploy).not.toHaveBeenCalled();
    expect(loadAcceptance).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(pool.calls.some(({ sql }) => sql.includes('staging_e2e_results'))).toBe(false);
    const write = pool.calls.find(({ sql }) => sql.includes('UPDATE tasks SET result'));
    expect(JSON.parse(write.params[1])).toEqual({
      staging_e2e_retirement: { verdict: 'SKIP', reason: 'zenithjoy_staging_retired' },
    });
    expect(updateTaskStatus).toHaveBeenCalledWith('task-zj', 'completed');
  });

  it('无 initiative_id → SKIP no_initiative_id', async () => {
    const pool = makeMockPool();
    const r = await runStagingE2E({ id: 't', payload: {} }, { pool, deploy: vi.fn(), loadAcceptance: vi.fn() });
    expect(r.verdict).toBe('SKIP');
    expect(r.reason).toBe('no_initiative_id');
    expect(insertedResult(pool).params[3]).toBe('SKIP'); // verdict 列
    expect(updateTaskStatus).toHaveBeenCalledWith('t', 'completed');
  });

  it('无合同 → SKIP no_contract，不触发 deploy', async () => {
    const pool = makeMockPool();
    const deploy = vi.fn();
    const r = await runStagingE2E(task, { pool, deploy, loadAcceptance: async () => null });
    expect(r.reason).toBe('no_contract');
    expect(deploy).not.toHaveBeenCalled();
  });

  it('deploy skipped(no_docker) → SKIP，不算失败', async () => {
    const pool = makeMockPool();
    const deploy = () => ({ status: 'skipped', reason: 'no_docker', output: '' });
    const r = await runStagingE2E(task, { pool, deploy, loadAcceptance: async () => ACCEPTANCE });
    expect(r.verdict).toBe('SKIP');
    expect(r.reason).toBe('no_docker');
    expect(updateTaskStatus).toHaveBeenCalledWith('task-1', 'completed');
  });

  it('deploy failed → FAIL deploy_failed', async () => {
    const pool = makeMockPool();
    const deploy = () => ({ status: 'failed', reason: 'deploy_failed', output: 'err' });
    const r = await runStagingE2E(task, { pool, deploy, loadAcceptance: async () => ACCEPTANCE });
    expect(r.verdict).toBe('FAIL');
    expect(r.reason).toBe('deploy_failed');
  });

  it('部署成功 + scenario 全过 → PASS，verdict 落库 + 写回 tasks.result', async () => {
    const pool = makeMockPool();
    const deploy = () => ({ status: 'success', reason: null, output: 'SUCCESS' });
    const r = await runStagingE2E(task, {
      pool, deploy, loadAcceptance: async () => ACCEPTANCE, exec: () => 'ok',
      // 必须注入：不注入会真扫 packages/brain/src/__tests__/regression/*.golden-smoke.test.ts 并 spawn vitest
      // 打 staging 端口（07-04 #3538 冻结首个 golden 文件后，单测环境无 staging 必 FAIL）
      runGoldenSmokeRegression: () => ({ verdict: 'SKIP', total: 0, passed: 0, failed: 0, skipped: 0, files: [] }),
    });
    expect(r.verdict).toBe('PASS');
    const ins = insertedResult(pool);
    expect(ins.params[3]).toBe('PASS');
    expect(ins.params[1]).toBe('init-1');     // initiative_id
    expect(ins.params[2]).toBe('https://pr/1'); // pr_url
    // 写回 tasks.result
    expect(pool.calls.some((c) => /UPDATE tasks SET result/.test(c.sql))).toBe(true);
    expect(updateTaskStatus).toHaveBeenCalledWith('task-1', 'completed');
  });

  it('部署成功 + scenario 失败 → FAIL scenarios_failed', async () => {
    const pool = makeMockPool();
    const deploy = () => ({ status: 'success', reason: null, output: 'SUCCESS' });
    const exec = () => { const e = new Error('x'); e.status = 1; throw e; };
    const r = await runStagingE2E(task, { pool, deploy, loadAcceptance: async () => ACCEPTANCE, exec });
    expect(r.verdict).toBe('FAIL');
    expect(r.reason).toBe('scenarios_failed');
    expect(insertedResult(pool).params[3]).toBe('FAIL');
  });

  it('DB 写失败 → 标 task failed（基础设施异常）', async () => {
    const pool = { calls: [], query: vi.fn().mockRejectedValue(new Error('db down')) };
    const r = await runStagingE2E(task, { pool, deploy: () => ({ status: 'success' }), loadAcceptance: async () => ACCEPTANCE, exec: () => 'ok' });
    expect(r.failed).toBe(true);
    expect(updateTaskStatus).toHaveBeenCalledWith('task-1', 'failed', expect.objectContaining({ error_message: expect.any(String) }));
  });

  // Slice6: staging 单实例串行，N 路并发会互相 docker rm 顶掉。deploy 前抢 pg_try_advisory_lock，
  // 抢不到 → SKIP staging_busy（不部署，让在跑的那路独占）；抢到 → finally 必释放锁。
  it('Slice6: 抢不到 staging 锁（并发）→ SKIP staging_busy，不 deploy', async () => {
    const pool = makeMockPool();
    const deploy = vi.fn();
    const r = await runStagingE2E(task, {
      pool, deploy, loadAcceptance: async () => ACCEPTANCE,
      acquireStagingLock: async () => null, // 抢锁失败（别人持有）
    });
    expect(r.verdict).toBe('SKIP');
    expect(r.reason).toBe('staging_busy');
    expect(deploy).not.toHaveBeenCalled();
  });

  it('Slice6: 抢到锁 → 结束必释放（即使 deploy 抛错也 finally release）', async () => {
    const pool = makeMockPool();
    const release = vi.fn().mockResolvedValue();
    const deploy = () => { throw new Error('deploy boom'); };
    await runStagingE2E(task, {
      pool, deploy, loadAcceptance: async () => ACCEPTANCE,
      acquireStagingLock: async () => ({ release }),
    });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('Slice6 lockPort: default(brain) line 用 STAGING_PORT(5222) 作锁 key', async () => {
    const pool = makeMockPool();
    const capturedLockKey = [];
    const acquireStagingLock = async (_, key) => { capturedLockKey.push(key); return { release: async () => {} }; };
    const deploy = () => ({ status: 'skipped', reason: 'no_docker', output: '' });
    // task 无 base_repo → legacy cecelia line → STAGING_PORT
    await runStagingE2E(task, { pool, deploy, loadAcceptance: async () => ACCEPTANCE, acquireStagingLock });
    expect(capturedLockKey[0]).toBe(STAGING_PORT);
  });

  // Slice9: staging 实测的 git SHA 落库（tested_sha），promote 时比对防 SHA 漂移。
  it('Slice9: PASS 落库含 tested_sha（git SHA 锚定）', async () => {
    const pool = makeMockPool();
    const deploy = () => ({ status: 'success', reason: null, output: 'SUCCESS' });
    await runStagingE2E(task, {
      pool, deploy, loadAcceptance: async () => ACCEPTANCE, exec: () => 'ok',
      getSha: () => 'abc123def456',
    });
    const ins = insertedResult(pool);
    expect(ins.params).toContain('abc123def456');
  });

  it('base_repo=第三方 repo → 不 deploy，SKIP unknown_line + pending_promote + 飞书通知', async () => {
    const pool = makeMockPool();
    const deploy = vi.fn();
    const notifyMsgs = [];
    const notify = async (m) => notifyMsgs.push(m);
    const acquireStagingLock = vi.fn();
    const task3p = {
      id: 'task-3p',
      payload: { initiative_id: 'init-1', pr_url: 'https://pr/3p', base_repo: 'https://github.com/acme/other-product.git' },
    };
    const r = await runStagingE2E(task3p, { pool, deploy, loadAcceptance: async () => ACCEPTANCE, notify, acquireStagingLock });
    // 不跑任何 deploy、不抢 staging 锁（cecelia 没有第三方 repo 的 staging 部署目标）
    expect(deploy).not.toHaveBeenCalled();
    expect(acquireStagingLock).not.toHaveBeenCalled();
    expect(r.verdict).toBe('SKIP');
    expect(r.reason).toBe('unknown_line');
    expect(r.promoteStatus).toBe('pending_promote');
    // verdict 落 staging_e2e_results
    expect(insertedResult(pool).params[3]).toBe('SKIP');
    // promote_status=pending_promote 落库
    const upd = pool.calls.find((c) => /UPDATE staging_e2e_results/.test(c.sql) && /promote_status/.test(c.sql));
    expect(upd).toBeTruthy();
    expect(upd.params).toContain('pending_promote');
    // 飞书通知一次，文案含 pending 语义
    expect(notifyMsgs.length).toBe(1);
    expect(notifyMsgs[0]).toMatch(/pending/i);
    expect(updateTaskStatus).toHaveBeenCalledWith('task-3p', 'completed');
  });

  it('base_repo 为空（legacy）→ 保持旧行为，照常 deploy', async () => {
    const pool = makeMockPool();
    const deploy = vi.fn(() => ({ status: 'skipped', reason: 'no_docker', output: '' }));
    // 复用文件顶部 task fixture（payload 无 base_repo）
    const r = await runStagingE2E(task, { pool, deploy, loadAcceptance: async () => ACCEPTANCE });
    expect(deploy).toHaveBeenCalledOnce();
    expect(r.reason).toBe('no_docker');
  });
});

describe('Slice9: handlePromote initiative 级聚合 gate + SHA 锚定', () => {
  it('checkInitiativeAggregate: 有 FAIL → allPass=false', async () => {
    const pool = { query: async () => ({ rows: [{ verdict: 'PASS', tested_sha: 'a' }, { verdict: 'FAIL', tested_sha: 'a' }] }) };
    const r = await checkInitiativeAggregate(pool, 'init-1');
    expect(r.allPass).toBe(false);
  });

  it('checkInitiativeAggregate: 全 PASS/SKIP 无 FAIL → allPass=true，带 tested_sha', async () => {
    const pool = { query: async () => ({ rows: [{ verdict: 'PASS', tested_sha: 'sha-x' }, { verdict: 'SKIP', tested_sha: null }] }) };
    const r = await checkInitiativeAggregate(pool, 'init-1');
    expect(r.allPass).toBe(true);
    expect(r.testedSha).toBe('sha-x');
  });

  it('handlePromote auto: 聚合有 FAIL → pending_promote，不调 promoteExec', async () => {
    const promoteExec = vi.fn();
    const status = await handlePromote(
      { query: vi.fn(async () => ({ rows: [] })) },
      { verdict: 'PASS', baseRepo: 'perfectuser21/cecelia', prUrl: 'p', initiativeId: 'i' },
      { checkInitiativeAggregate: async () => ({ allPass: false, testedSha: null }), promoteExec, notify: async () => {} },
    );
    expect(status).toBe('pending_promote');
    expect(promoteExec).not.toHaveBeenCalled();
  });

  it('handlePromote auto: SHA 漂移（tested != current）→ pending_promote，不调 promoteExec', async () => {
    const promoteExec = vi.fn();
    const status = await handlePromote(
      { query: vi.fn(async () => ({ rows: [] })) },
      { verdict: 'PASS', baseRepo: 'perfectuser21/cecelia', prUrl: 'p', initiativeId: 'i' },
      {
        checkInitiativeAggregate: async () => ({ allPass: true, testedSha: 'old-sha' }),
        getCurrentSha: () => 'new-sha',
        promoteExec, notify: async () => {},
      },
    );
    expect(status).toBe('pending_promote');
    expect(promoteExec).not.toHaveBeenCalled();
  });
});

describe('handlePromote 内部分流', () => {
  it('FAIL + internal line → 不通知（内部线 Cecelia 失败，非 ZJ 护栏场景）', async () => {
    const notifyMsgs = [];
    const notify = async (msg) => { notifyMsgs.push(msg); };
    const pool = { query: vi.fn(async () => ({ rows: [] })) };
    const status = await handlePromote(
      pool,
      { verdict: 'FAIL', baseRepo: 'perfectuser21/cecelia', prUrl: 'p', initiativeId: 'i' },
      { notify },
    );
    expect(status).toBe('n_a');
    expect(notifyMsgs).toHaveLength(0);
  });
});

describe('Slice10: runGoldenSmokeRegression — regression 扫描', () => {
  it('无文件时返回 SKIP', async () => {
    const { runGoldenSmokeRegression } = await import('../staging-e2e-runner.js');
    const result = runGoldenSmokeRegression({ cwd: '/nonexistent-path-xyz' });
    expect(result.verdict).toBe('SKIP');
    expect(result.total).toBe(0);
  });

  it('新回归目录中的 windows 文件计入 skipped 且不启动执行器', async () => {
    const os = await import('os');
    const fs = await import('fs');
    const path = await import('path');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-test-'));
    const regDir = path.join(tmpDir, 'packages/brain/src/__tests__/regression');
    fs.mkdirSync(regDir, { recursive: true });
    fs.writeFileSync(path.join(regDir, 'feature-x.golden-smoke.test.ts'), '/**\n * target_env: windows_cloud\n */\n');
    const spawn = vi.fn();
    try {
      const { runGoldenSmokeRegression } = await import('../staging-e2e-runner.js');
      expect(runGoldenSmokeRegression({ cwd: tmpDir, spawnSync: spawn })).toEqual({
        verdict: 'SKIP', total: 1, passed: 0, failed: 0, skipped: 1, files: [],
      });
      expect(spawn).not.toHaveBeenCalled();
    } finally { fs.rmSync(tmpDir, { recursive: true }); }
  });

  it.each([[1, 0, 'PASS'], [0, 1, 'FAIL']])(
    '新回归目录的执行结果 passed=%i failed=%i 返回 %s', async (passed, failed, verdict) => {
      const os = await import('os');
      const fs = await import('fs');
      const path = await import('path');
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-regression-'));
      const relative = 'packages/brain/src/__tests__/regression/ability-a.golden-smoke.test.ts';
      const file = path.join(tmpDir, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '/**\n * target_env: mac_web\n */\n');
      const execute = vi.fn((command, args, options) => {
        expect(command).toBe('npx');
        expect(args.at(-1)).toBe(file);
        expect(options.cwd).toBe(tmpDir);
        fs.writeFileSync(args[args.indexOf('--outputFile') + 1], JSON.stringify({
          numPassedTests: passed, numFailedTests: failed, numPendingTests: 0,
        }));
      });
      try {
        const { runGoldenSmokeRegression } = await import('../staging-e2e-runner.js');
        expect(runGoldenSmokeRegression({ cwd: tmpDir, spawnSync: execute })).toEqual({
          verdict, total: 1, passed, failed, skipped: 0, files: [relative],
        });
        expect(execute).toHaveBeenCalledOnce();
      } finally { fs.rmSync(tmpDir, { recursive: true }); }
    },
  );
});
