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
  STAGING_PORT,
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
  it('正常输出 → success', () => {
    const exec = () => '=== Staging Deploy SUCCESS ===\n';
    const r = deployStaging({ exec });
    expect(r.status).toBe('success');
    expect(r.reason).toBeNull();
  });

  it('STAGING_SKIP_REASON=no_docker → skipped（非失败）', () => {
    const exec = () => 'blah\nSTAGING_SKIP_REASON=no_docker\n';
    const r = deployStaging({ exec });
    expect(r.status).toBe('skipped');
    expect(r.reason).toBe('no_docker');
  });

  it('脚本抛错但 stdout 含 skip 原因 → 仍 skipped', () => {
    const exec = () => { const e = new Error('boom'); e.status = 1; e.stdout = 'STAGING_SKIP_REASON=no_env'; throw e; };
    const r = deployStaging({ exec });
    expect(r.status).toBe('skipped');
    expect(r.reason).toBe('no_env');
  });

  it('脚本抛错且无 skip 原因 → failed', () => {
    const exec = () => { const e = new Error('real fail'); e.status = 1; throw e; };
    const r = deployStaging({ exec });
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

  it('部署成功 + scenario 全过 → PASS，verdict 落库 + 写回 tasks.result', async () => {
    const pool = makeMockPool();
    const deploy = () => ({ status: 'success', reason: null, output: 'SUCCESS' });
    const r = await runStagingE2E(task, {
      pool, deploy, loadAcceptance: async () => ACCEPTANCE, exec: () => 'ok',
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
});
