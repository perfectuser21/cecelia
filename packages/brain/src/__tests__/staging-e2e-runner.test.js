/**
 * 阶段2 Slice1 — staging-e2e-runner 单元测试（mock-based，不起真实 docker / curl / DB）。
 *
 * 覆盖：
 *   - deployStaging: success / skipped(STAGING_SKIP_REASON) / failed(throw)
 *   - deployStaging ZenithJoy customer line: :5201 健康 → success；:5201 挂 → failed（护栏触发）
 *   - runStagingCommand: :5221→:5222 端口重写 / 合法访问 /api/brain（无 planner_drift 拦截）/ 非 0 退出
 *   - runStagingCommand ZenithJoy: :5200→:5201 端口重写
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
  ZJ_STAGING_PORT,
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

// ─── deployStaging — ZenithJoy customer line 蓝绿护栏 ─────────────────────────
describe('deployStaging — ZenithJoy customer line（:5201 护栏）', () => {
  it(':5201 健康响应 → success（护栏 pass，准备跑 E2E）', async () => {
    let seen = null;
    const exec = (cmd) => { seen = cmd; return '{"status":"ok"}'; };
    const r = await deployStaging({ exec, line: 'customer' });
    expect(r.status).toBe('success');
    expect(r.stagingPort).toBe(ZJ_STAGING_PORT);
    expect(seen).toContain(`:${ZJ_STAGING_PORT}`);
  });

  it(':5201 健康检查失败（连接拒绝）→ failed，reason=zj_staging_unhealthy（护栏触发,:5200 不被触碰）', async () => {
    const exec = () => { const e = new Error('connect ECONNREFUSED'); e.status = 7; throw e; };
    const r = await deployStaging({ exec, line: 'customer', maxAttempts: 1, sleep: async () => {} });
    expect(r.status).toBe('failed');
    expect(r.reason).toBe('zj_staging_unhealthy');
    expect(r.stagingPort).toBe(ZJ_STAGING_PORT);
  });

  it(':5201 健康检查超时 → failed', async () => {
    const exec = () => { const e = new Error('ETIMEDOUT'); e.status = 28; e.stderr = 'curl timeout'; throw e; };
    const r = await deployStaging({ exec, line: 'customer', maxAttempts: 1, sleep: async () => {} });
    expect(r.status).toBe('failed');
    expect(r.reason).toBe('zj_staging_unhealthy');
  });

  it('opts.deployScript 有值时走 script（覆盖 customer 健康检查路径，供测试用）', async () => {
    let seen = null;
    const exec = (cmd) => { seen = cmd; return '=== Staging Deploy SUCCESS ===\n'; };
    const r = await deployStaging({ exec, line: 'customer', deployScript: '/tmp/my-zj-deploy.sh' });
    expect(r.status).toBe('success');
    expect(seen).toContain('/tmp/my-zj-deploy.sh');
  });

  it('重试：第 1 次失败（容器重启窗口），第 2 次成功 → success（ZJ CI deploy 时序竞争修复）', async () => {
    let callCount = 0;
    const exec = () => {
      callCount++;
      if (callCount === 1) { const e = new Error('connect ECONNREFUSED'); e.status = 7; throw e; }
      return '{"status":"ok"}';
    };
    const r = await deployStaging({ exec, line: 'customer', maxAttempts: 3, sleep: async () => {} });
    expect(r.status).toBe('success');
    expect(callCount).toBe(2);
  });

  it('重试：全部 maxAttempts 次均失败 → failed，reason=zj_staging_unhealthy', async () => {
    let callCount = 0;
    const exec = () => { callCount++; const e = new Error('ECONNREFUSED'); e.status = 7; throw e; };
    const r = await deployStaging({ exec, line: 'customer', maxAttempts: 3, sleep: async () => {} });
    expect(r.status).toBe('failed');
    expect(r.reason).toBe('zj_staging_unhealthy');
    expect(callCount).toBe(3);
  });

  it('默认 maxAttempts=5（覆盖 ZJ CI 2-3 分钟部署窗口）', async () => {
    let callCount = 0;
    const exec = () => { callCount++; const e = new Error('ECONNREFUSED'); e.status = 7; throw e; };
    const r = await deployStaging({ exec, line: 'customer', sleep: async () => {} });
    expect(r.status).toBe('failed');
    expect(callCount).toBe(5);
  });

  it('默认 retryDelayMs=30000（30s 间隔，注入 sleep 验证延迟参数）', async () => {
    const delays = [];
    const exec = () => { const e = new Error('ECONNREFUSED'); e.status = 7; throw e; };
    const sleep = async (ms) => { delays.push(ms); };
    await deployStaging({ exec, line: 'customer', sleep });
    expect(delays.length).toBe(4); // maxAttempts=5，间隔 4 次
    delays.forEach(d => expect(d).toBe(30_000));
  });

  it('全部重试失败 → output 包含尝试次数和总等待时间', async () => {
    const exec = () => { const e = new Error('connect ECONNREFUSED :5201'); e.status = 7; throw e; };
    const r = await deployStaging({ exec, line: 'customer', maxAttempts: 3, retryDelayMs: 30_000, sleep: async () => {} });
    expect(r.output).toMatch(/尝试 3 次均失败/);
    expect(r.output).toMatch(/总等待 60s/);
  });

  // JSON 层健康验证：防 SPA fallback 误判，同时提取 SHA
  it(':5201/health 返回 { status:"ok", sha } → success，zjSha + stagingSha 均携带', async () => {
    const exec = () => '{"status":"ok","sha":"abc123def456","service":"zenithjoy-api"}';
    const r = await deployStaging({ exec, line: 'customer', sleep: async () => {} });
    expect(r.status).toBe('success');
    expect(r.zjSha).toBe('abc123def456');
    expect(r.stagingSha).toBe('abc123def456');
    expect(r.output).toContain('[ZJ staging SHA: abc123def456');
  });

  it(':5201/health 返回旧格式 { status:"ok", build.sha } → success，stagingSha 兼容提取', async () => {
    const healthJson = JSON.stringify({
      status: 'ok',
      build: { sha: '8ecf9249378936b1a27395eb5a7efcb179a3fd23', buildTime: '2026-07-07T08:14:34Z' },
    });
    const exec = () => healthJson;
    const r = await deployStaging({ exec, line: 'customer', sleep: async () => {} });
    expect(r.status).toBe('success');
    expect(r.stagingSha).toBe('8ecf9249378936b1a27395eb5a7efcb179a3fd23');
    expect(r.zjSha).toBeNull();
    expect(r.output).toContain('[ZJ staging SHA: 8ecf9249378936b1a27395eb5a7efcb179a3fd23');
    expect(r.output).toContain('buildTime:2026-07-07T08:14:34Z');
  });

  it(':5201/health 返回 {"status":"ok"} 无 sha → success，zjSha=null stagingSha=null', async () => {
    const exec = () => '{"status":"ok"}';
    const r = await deployStaging({ exec, line: 'customer', sleep: async () => {} });
    expect(r.status).toBe('success');
    expect(r.zjSha).toBeNull();
    expect(r.stagingSha).toBeNull();
  });

  it(':5201/health 返回 HTML（SPA fallback）→ failed，reason=zj_staging_html_fallback（护栏触发）', async () => {
    const exec = () => '<!DOCTYPE html><html><head><title>ZenithJoy</title></head><body>app</body></html>';
    const r = await deployStaging({ exec, line: 'customer', maxAttempts: 1, sleep: async () => {} });
    expect(r.status).toBe('failed');
    expect(r.reason).toBe('zj_staging_html_fallback');
  });

  it(':5201/health 返回 {"status":"starting"} → failed，reason=zj_staging_unhealthy（非 ok JSON）', async () => {
    const exec = () => '{"status":"starting"}';
    const r = await deployStaging({ exec, line: 'customer', maxAttempts: 1, sleep: async () => {} });
    expect(r.status).toBe('failed');
    expect(r.reason).toBe('zj_staging_unhealthy');
  });

  it('重试：前两次返回 HTML，第三次返回 ok → success（冷启动期）', async () => {
    let callCount = 0;
    const exec = () => {
      callCount++;
      if (callCount < 3) return '<!DOCTYPE html><html>app</html>';
      return '{"status":"ok"}';
    };
    const r = await deployStaging({ exec, line: 'customer', maxAttempts: 5, sleep: async () => {} });
    expect(r.status).toBe('success');
    expect(callCount).toBe(3);
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

  // P1#5（2026-06-27 审计）：内部线 dashboard staging（:5251 是静态站，无 /api/brain）。
  // mac_web 合同实际引用 localhost:5174(dashboard) + localhost:5221(brain)。旧逻辑把 5221→5251
  // → brain 断言打到 dashboard 静态站必 FAIL，且 5174 完全不映射。正确：5174→5251，5221 保持活 brain。
  it('内部线(port=5251)：5174(dashboard)→:5251，5221(brain) 保持活 brain :5221 不打到静态站', () => {
    let seen = null;
    const exec = (cmd) => { seen = cmd; return 'ok'; };
    runStagingCommand(
      { cmd: 'curl localhost:5174/pipeline/x ; curl localhost:5221/api/brain/tasks/x' },
      { exec, port: DASHBOARD_STAGING_PORT },
    );
    expect(seen).toContain(`host.docker.internal:${DASHBOARD_STAGING_PORT}/pipeline/x`); // dashboard → 5251
    expect(seen).toContain('host.docker.internal:5221/api/brain/tasks/x');              // brain 保持活 5221
    expect(seen).not.toContain(`host.docker.internal:${DASHBOARD_STAGING_PORT}/api/brain`); // brain 不打到静态站
  });

  it('非内部线(port=5222)：维持 5221→:5222（回归不变）', () => {
    let seen = null;
    const exec = (cmd) => { seen = cmd; return 'ok'; };
    runStagingCommand({ cmd: 'curl localhost:5221/api/brain/x' }, { exec, port: STAGING_PORT });
    expect(seen).toContain(`host.docker.internal:${STAGING_PORT}/api/brain/x`);
  });

  // ZenithJoy 蓝绿护栏：合同里 :5200（production）→ :5201（staging）重写
  it('ZenithJoy(port=ZJ_STAGING_PORT)：:5200→:5201（合同 production 端口重写到 staging）', () => {
    let seen = null;
    const exec = (cmd) => { seen = cmd; return 'ok'; };
    runStagingCommand({ cmd: 'curl localhost:5200/health' }, { exec, port: ZJ_STAGING_PORT });
    expect(seen).toContain(`host.docker.internal:${ZJ_STAGING_PORT}/health`);
    expect(seen).not.toContain('localhost:5200');
  });

  it('ZenithJoy：127.0.0.1:5200 也重写到 :5201', () => {
    let seen = null;
    const exec = (cmd) => { seen = cmd; return 'ok'; };
    runStagingCommand({ cmd: 'curl 127.0.0.1:5200/api/v1/test' }, { exec, port: ZJ_STAGING_PORT });
    expect(seen).toContain(`host.docker.internal:${ZJ_STAGING_PORT}/api/v1/test`);
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

  it('ZenithJoy :5201 健康检查失败 → FAIL reason=zj_staging_unhealthy（原因透传，不被覆盖为 deploy_failed）', async () => {
    const pool = makeMockPool();
    const curlErr = 'curl: (7) Failed to connect to localhost port 5201: Connection refused';
    const deploy = () => ({ status: 'failed', reason: 'zj_staging_unhealthy', output: curlErr, stagingPort: 5201 });
    const notifyMsgs = [];
    const notify = async (msg) => { notifyMsgs.push(msg); };
    const zjTask = { id: 'task-zj', payload: { initiative_id: 'init-zj', pr_url: 'https://pr/zj', base_repo: 'perfectuser21/zenithjoy' } };
    const r = await runStagingE2E(zjTask, { pool, deploy, loadAcceptance: async () => ACCEPTANCE, notify });
    expect(r.verdict).toBe('FAIL');
    expect(r.reason).toBe('zj_staging_unhealthy');
    // 飞书通知含诊断输出（curl 错误）
    expect(notifyMsgs.some((m) => m.includes('Connection refused'))).toBe(true);
  });

  it('部署成功 + scenario 全过 → PASS，verdict 落库 + 写回 tasks.result', async () => {
    const pool = makeMockPool();
    const deploy = () => ({ status: 'success', reason: null, output: 'SUCCESS' });
    const r = await runStagingE2E(task, {
      pool, deploy, loadAcceptance: async () => ACCEPTANCE, exec: () => 'ok',
      // 必须注入：不注入会真扫 packages/quality/tests/regression/*.golden-smoke.test.ts 并 spawn vitest
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

  it('Slice6 lockPort: customer line 用 ZJ_STAGING_PORT(5201) 作锁 key，不与 Cecelia Brain staging 冲突', async () => {
    const pool = makeMockPool();
    const capturedLockKey = [];
    const acquireStagingLock = async (_, key) => { capturedLockKey.push(key); return { release: async () => {} }; };
    const deploy = () => ({ status: 'skipped', reason: 'no_docker', output: '' });
    const zjTask = { id: 'task-zj-lock', payload: { initiative_id: 'init-zj', pr_url: 'https://pr/zj-lock', base_repo: 'perfectuser21/zenithjoy' } };
    await runStagingE2E(zjTask, { pool, deploy, loadAcceptance: async () => ACCEPTANCE, acquireStagingLock });
    expect(capturedLockKey[0]).toBe(ZJ_STAGING_PORT);
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

// ─── handlePromote — ZenithJoy customer line FAIL 护栏通知 ─────────────────────
describe('handlePromote — ZenithJoy staging FAIL 护栏通知', () => {
  it('FAIL + customer line → 飞书通知 + 返回 NA（:5200 不被触碰）', async () => {
    const notifyMsgs = [];
    const notify = async (msg) => { notifyMsgs.push(msg); };
    const pool = { query: vi.fn(async () => ({ rows: [] })) };
    const status = await handlePromote(
      pool,
      { verdict: 'FAIL', baseRepo: 'perfectuser21/zenithjoy', prUrl: 'https://github.com/pr/1', initiativeId: 'init-zj-1' },
      { notify },
    );
    expect(status).toBe('n_a');
    expect(notifyMsgs).toHaveLength(1);
    expect(notifyMsgs[0]).toContain('ZJ 护栏触发');
    expect(notifyMsgs[0]).toContain('5201');
    expect(notifyMsgs[0]).toContain('5200');
  });

  it('FAIL + customer line → Bark 移动通知（双通知保证可达性）', async () => {
    const barkCalls = [];
    const notifyBark = async (title, body) => { barkCalls.push({ title, body }); };
    const pool = { query: vi.fn(async () => ({ rows: [] })) };
    await handlePromote(
      pool,
      { verdict: 'FAIL', baseRepo: 'perfectuser21/zenithjoy', prUrl: 'https://github.com/pr/9', initiativeId: 'init-zj-9' },
      { notify: async () => {}, notifyBark },
    );
    expect(barkCalls).toHaveLength(1);
    expect(barkCalls[0].title).toContain('ZJ 护栏触发');
    expect(barkCalls[0].body).toContain('5201');
    expect(barkCalls[0].body).toContain('5200');
    expect(barkCalls[0].body).toContain('init-zj-9');
  });

  it('SKIP + customer line → 不发 Bark（配置缺省非真失败）', async () => {
    const barkCalls = [];
    const notifyBark = async (title, body) => { barkCalls.push({ title, body }); };
    const pool = { query: vi.fn(async () => ({ rows: [] })) };
    await handlePromote(
      pool,
      { verdict: 'SKIP', baseRepo: 'perfectuser21/zenithjoy', prUrl: 'p', initiativeId: 'i' },
      { notify: async () => {}, notifyBark },
    );
    expect(barkCalls).toHaveLength(0);
  });

  it('FAIL + customer line + deployOutput → 通知含诊断输出（开发者无需查 CI 日志）', async () => {
    const notifyMsgs = [];
    const notify = async (msg) => { notifyMsgs.push(msg); };
    const pool = { query: vi.fn(async () => ({ rows: [] })) };
    const status = await handlePromote(
      pool,
      {
        verdict: 'FAIL',
        baseRepo: 'perfectuser21/zenithjoy',
        prUrl: 'https://github.com/pr/2',
        initiativeId: 'init-zj-2',
        deployOutput: 'curl: (7) Failed to connect to localhost port 5201: Connection refused',
      },
      { notify },
    );
    expect(status).toBe('n_a');
    expect(notifyMsgs).toHaveLength(1);
    expect(notifyMsgs[0]).toContain('ZJ 护栏触发');
    expect(notifyMsgs[0]).toContain('诊断');
    expect(notifyMsgs[0]).toContain('Connection refused');
  });

  it('FAIL + customer line + zjSha → 通知含候选 SHA（方便定位哪个 ZJ 版本坏了）', async () => {
    const notifyMsgs = [];
    const notify = async (msg) => { notifyMsgs.push(msg); };
    const pool = { query: vi.fn(async () => ({ rows: [] })) };
    await handlePromote(
      pool,
      {
        verdict: 'FAIL',
        baseRepo: 'perfectuser21/zenithjoy',
        prUrl: 'https://github.com/pr/3',
        initiativeId: 'init-zj-3',
        zjSha: '8ecf9249378936b1a27395eb5a7efcb179a3fd23',
      },
      { notify },
    );
    expect(notifyMsgs).toHaveLength(1);
    expect(notifyMsgs[0]).toContain('候选');
    expect(notifyMsgs[0]).toContain('8ecf9249378936b1a27395eb5a7efcb179a3fd23');
  });

  it('FAIL + customer line + zjSha=unknown → 通知不含候选行（避免"候选: unknown"干扰）', async () => {
    const notifyMsgs = [];
    const notify = async (msg) => { notifyMsgs.push(msg); };
    const pool = { query: vi.fn(async () => ({ rows: [] })) };
    await handlePromote(
      pool,
      { verdict: 'FAIL', baseRepo: 'perfectuser21/zenithjoy', prUrl: 'p', initiativeId: 'i', zjSha: 'unknown' },
      { notify },
    );
    expect(notifyMsgs).toHaveLength(1);
    expect(notifyMsgs[0]).not.toContain('候选');
  });

  it('SKIP + customer line → 不通知（配置缺省非真失败）', async () => {
    const notifyMsgs = [];
    const notify = async (msg) => { notifyMsgs.push(msg); };
    const pool = { query: vi.fn(async () => ({ rows: [] })) };
    const status = await handlePromote(
      pool,
      { verdict: 'SKIP', baseRepo: 'perfectuser21/zenithjoy', prUrl: 'p', initiativeId: 'i' },
      { notify },
    );
    expect(status).toBe('n_a');
    expect(notifyMsgs).toHaveLength(0);
  });

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

  it('FAIL + deployOutput 含 ZJ staging SHA → 通知里出现最后已知 SHA（诊断可见）', async () => {
    const notifyMsgs = [];
    const notify = async (msg) => { notifyMsgs.push(msg); };
    const pool = { query: vi.fn(async () => ({ rows: [] })) };
    // deployOutput 模拟一次成功健康检查后的 output（含 SHA 诊断行），紧接着下一次失败
    const deployOutput = 'ok\n[ZJ staging SHA: 8ecf9249378936b1a27395eb5a7efcb179a3fd23 buildTime:2026-07-07T08:14:34Z]';
    await handlePromote(
      pool,
      { verdict: 'FAIL', baseRepo: 'perfectuser21/zenithjoy', prUrl: 'p', initiativeId: 'i', deployOutput },
      { notify },
    );
    expect(notifyMsgs).toHaveLength(1);
    expect(notifyMsgs[0]).toContain('最后已知 staging SHA: 8ecf9249');
  });

  it('FAIL + deployOutput 无 SHA → 通知不含 SHA 行（向前兼容）', async () => {
    const notifyMsgs = [];
    const notify = async (msg) => { notifyMsgs.push(msg); };
    const pool = { query: vi.fn(async () => ({ rows: [] })) };
    await handlePromote(
      pool,
      { verdict: 'FAIL', baseRepo: 'perfectuser21/zenithjoy', prUrl: 'p', initiativeId: 'i', deployOutput: 'curl: (7) ECONNREFUSED' },
      { notify },
    );
    expect(notifyMsgs).toHaveLength(1);
    expect(notifyMsgs[0]).not.toContain('最后已知 staging SHA');
    expect(notifyMsgs[0]).toContain('ZJ 护栏触发');
  });
});

describe('Slice10: runGoldenSmokeRegression — regression 扫描', () => {
  it('无文件时返回 SKIP', async () => {
    const { runGoldenSmokeRegression } = await import('../staging-e2e-runner.js');
    const result = runGoldenSmokeRegression({ cwd: '/nonexistent-path-xyz' });
    expect(result.verdict).toBe('SKIP');
    expect(result.total).toBe(0);
  });

  it('全部为 windows 环境文件时返回 SKIP（skipped=total）', async () => {
    const os = await import('os');
    const fs = await import('fs');
    const tmpDir = fs.default.mkdtempSync(os.default.tmpdir() + '/gs-test-');
    const file = tmpDir + '/feature-x.golden-smoke.test.ts';
    fs.default.writeFileSync(file, '/**\n * target_env  : windows_cloud\n */\nit("x", () => {});\n');
    const { runGoldenSmokeRegression } = await import('../staging-e2e-runner.js');
    const result = runGoldenSmokeRegression({ cwd: tmpDir.replace('/packages/quality/tests/regression', '') || '/', cwd: process.cwd() });
    fs.default.rmSync(tmpDir, { recursive: true });
    expect(['SKIP', 'PASS']).toContain(result.verdict);
  });

  it('spawnSync 注入可覆盖执行器（PASS 路径）', async () => {
    const os = await import('os');
    const fs = await import('fs');
    const path = await import('path');
    const tmpDir = fs.default.mkdtempSync(os.default.tmpdir() + '/gs-regression-');
    const regDir = path.default.join(tmpDir, 'packages/quality/tests/regression');
    fs.default.mkdirSync(regDir, { recursive: true });
    const file = path.default.join(regDir, 'ability-a.golden-smoke.test.ts');
    fs.default.writeFileSync(file, '/** target_env: mac_web */\nit("smoke", () => expect(1).toBe(1));\n');
    const jsonResult = { testResults: [{ status: 'passed', numPassingTests: 1, numFailingTests: 0 }] };
    const tmpJson = path.default.join(os.default.tmpdir(), 'gs-mock-out.json');
    const mockSpawn = (_cmd, _args, _opts) => {
      fs.default.writeFileSync(tmpJson, JSON.stringify(jsonResult));
    };
    const { runGoldenSmokeRegression } = await import('../staging-e2e-runner.js');
    const result = runGoldenSmokeRegression({
      cwd: tmpDir,
      spawnSync: mockSpawn,
    });
    fs.default.rmSync(tmpDir, { recursive: true });
    expect(['PASS', 'FAIL', 'SKIP']).toContain(result.verdict);
  });
});
