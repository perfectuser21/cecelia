/**
 * harness-staging-e2e.test.js — 阶段2 Slice1 单元测试
 *
 * 覆盖：
 *   - runStagingDeploy 解析 success / skip / failed 三种信号
 *   - createStagingE2eTask 防重 + 正常 INSERT
 *   - loadContractAcceptance 取 e2e_acceptance
 *   - persistStagingE2eResult 落库
 *   - handleStagingE2e 全分支 verdict（SKIP-no_contract / SKIP-deploy / FAIL-deploy / PASS / FAIL-e2e / ERROR）
 *   - task-router 对 staging_e2e 的注册（VALID/SKILL/LOCATION/INTERNAL_TASK_HANDLERS）
 */
import { describe, it, expect, vi } from 'vitest';
import {
  STAGING_PORT,
  runStagingDeploy,
  createStagingE2eTask,
  loadContractAcceptance,
  persistStagingE2eResult,
  handleStagingE2e,
} from '../harness-staging-e2e.js';
import { getInternalTaskHandler, INTERNAL_TASK_HANDLERS } from '../task-router.js';

// 简易 mock pool：按调用顺序返回预设结果，并记录 SQL
function makePool(responses = []) {
  const calls = [];
  let i = 0;
  return {
    calls,
    query: vi.fn(async (sql, params) => {
      calls.push({ sql, params });
      const r = responses[i++];
      if (typeof r === 'function') return r(sql, params);
      return r || { rows: [] };
    }),
  };
}

describe('STAGING_PORT', () => {
  it('固定为 5222', () => {
    expect(STAGING_PORT).toBe(5222);
  });
});

describe('runStagingDeploy', () => {
  it('输出含 "Staging Deploy SUCCESS" → success', async () => {
    const exec = vi.fn((cmd, args, opts, cb) =>
      cb(null, '=== Staging Deploy SUCCESS: cecelia-brain v1.0 在端口 5222 健康 ===', ''));
    const r = await runStagingDeploy({ execFile: exec });
    expect(r.status).toBe('success');
    expect(r.skipReason).toBeNull();
    expect(exec.mock.calls[0][1]).toEqual(['scripts/staging-deploy.sh']);
  });

  it('输出含 STAGING_SKIP_REASON=no_docker → skipped', async () => {
    const exec = vi.fn((cmd, args, opts, cb) =>
      cb(null, '[WARN] docker 不可用\nSTAGING_SKIP_REASON=no_docker', ''));
    const r = await runStagingDeploy({ execFile: exec });
    expect(r.status).toBe('skipped');
    expect(r.skipReason).toBe('no_docker');
  });

  it('skip 信号优先于非零退出（脚本 exit 0 但带 skip）', async () => {
    const exec = vi.fn((cmd, args, opts, cb) =>
      cb(null, 'STAGING_SKIP_REASON=no_env', ''));
    const r = await runStagingDeploy({ execFile: exec });
    expect(r.status).toBe('skipped');
    expect(r.skipReason).toBe('no_env');
  });

  it('非零退出且无 success/skip 信号 → failed，带 exitCode', async () => {
    const err = new Error('boom'); err.code = 1;
    const exec = vi.fn((cmd, args, opts, cb) => cb(err, '部署崩了', 'stderr'));
    const r = await runStagingDeploy({ execFile: exec });
    expect(r.status).toBe('failed');
    expect(r.exitCode).toBe(1);
    expect(r.output).toContain('部署崩了');
  });
});

describe('createStagingE2eTask', () => {
  it('缺 initiativeId → 不创建', async () => {
    const pool = makePool();
    const r = await createStagingE2eTask(pool, {});
    expect(r.created).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('已有未结束任务 → dedup 跳过，不 INSERT', async () => {
    const pool = makePool([{ rows: [{ id: 'existing-1' }] }]);
    const r = await createStagingE2eTask(pool, { initiativeId: 'init-1', subTaskId: 'ws1' });
    expect(r.created).toBe(false);
    expect(r.reason).toContain('existing-1');
    // 只查了 dedup，没 INSERT
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('无重复 → INSERT 并返回 taskId', async () => {
    const pool = makePool([
      { rows: [] },                       // dedup 无命中
      { rows: [{ id: 'new-task-1' }] },   // INSERT RETURNING
    ]);
    const r = await createStagingE2eTask(pool, {
      initiativeId: 'init-1', subTaskId: 'ws1', prUrl: 'https://x/pr/1',
    });
    expect(r.created).toBe(true);
    expect(r.taskId).toBe('new-task-1');
    const insert = pool.calls[1];
    expect(insert.sql).toMatch(/INSERT INTO tasks/);
    expect(insert.params[0]).toContain('init-1');
    const payload = JSON.parse(insert.params[2]);
    expect(payload.initiative_id).toBe('init-1');
    expect(payload.sub_task_id).toBe('ws1');
    expect(payload.pr_url).toBe('https://x/pr/1');
  });
});

describe('loadContractAcceptance', () => {
  it('返回 e2e_acceptance，没有则 null', async () => {
    const acc = { scenarios: [{ name: 's', covered_tasks: ['t'], commands: [{ cmd: 'echo 1' }] }] };
    const pool = makePool([{ rows: [{ e2e_acceptance: acc }] }]);
    expect(await loadContractAcceptance(pool, 'init-1')).toEqual(acc);

    const empty = makePool([{ rows: [] }]);
    expect(await loadContractAcceptance(empty, 'init-1')).toBeNull();
  });
});

describe('persistStagingE2eResult', () => {
  it('INSERT 进 staging_e2e_results，序列化 scenarios，返回 id', async () => {
    const pool = makePool([{ rows: [{ id: 'res-1' }] }]);
    const id = await persistStagingE2eResult(pool, {
      initiativeId: 'init-1', subTaskId: 'ws1', taskId: 'task-1',
      verdict: 'PASS', deployStatus: 'success',
      passedScenarios: [{ name: 's1' }], failedScenarios: [],
    });
    expect(id).toBe('res-1');
    const c = pool.calls[0];
    expect(c.sql).toMatch(/INSERT INTO staging_e2e_results/);
    expect(c.params[3]).toBe('PASS');           // verdict
    expect(c.params[6]).toBe(5222);             // staging_port
    expect(c.params[9]).toBe(JSON.stringify([{ name: 's1' }])); // passed_scenarios
  });
});

describe('handleStagingE2e — verdict 分支', () => {
  const acc = { scenarios: [{ name: 's', covered_tasks: ['t'], commands: [{ cmd: 'echo ok' }] }] };
  const task = { id: 'task-1', payload: { initiative_id: 'init-1', sub_task_id: 'ws1', pr_url: 'pr' } };

  it('缺 initiative_id → ERROR', async () => {
    const persist = vi.fn(async () => 'res');
    const r = await handleStagingE2e({ id: 'x', payload: {} }, { pool: {}, persist });
    expect(r.verdict).toBe('ERROR');
    expect(persist.mock.calls[0][1].skipReason).toBe('no_initiative_id');
  });

  it('无合同 → SKIP(no_contract)，不部署', async () => {
    const loadContract = vi.fn(async () => null);
    const runDeploy = vi.fn();
    const persist = vi.fn(async () => 'res');
    const r = await handleStagingE2e(task, { pool: {}, loadContract, runDeploy, persist });
    expect(r.verdict).toBe('SKIP');
    expect(r.skipReason).toBe('no_contract');
    expect(runDeploy).not.toHaveBeenCalled();
  });

  it('部署被优雅降级跳过 → SKIP(deploy skipReason)，不跑 E2E', async () => {
    const loadContract = vi.fn(async () => acc);
    const runDeploy = vi.fn(async () => ({ status: 'skipped', skipReason: 'no_docker', output: 'x' }));
    const runE2E = vi.fn();
    const persist = vi.fn(async () => 'res');
    const r = await handleStagingE2e(task, { pool: {}, loadContract, runDeploy, runE2E, persist });
    expect(r.verdict).toBe('SKIP');
    expect(r.skipReason).toBe('no_docker');
    expect(runE2E).not.toHaveBeenCalled();
  });

  it('部署失败 → FAIL(deploy_failed)，不跑 E2E', async () => {
    const loadContract = vi.fn(async () => acc);
    const runDeploy = vi.fn(async () => ({ status: 'failed', exitCode: 1, output: 'boom' }));
    const runE2E = vi.fn();
    const persist = vi.fn(async () => 'res');
    const r = await handleStagingE2e(task, { pool: {}, loadContract, runDeploy, runE2E, persist });
    expect(r.verdict).toBe('FAIL');
    expect(r.skipReason).toBe('deploy_failed');
    expect(runE2E).not.toHaveBeenCalled();
    expect(persist.mock.calls[0][1].failedScenarios[0].name).toMatch(/deploy/i);
  });

  it('部署成功 + E2E PASS → PASS，E2E 用 skipBootstrap', async () => {
    const loadContract = vi.fn(async () => acc);
    const runDeploy = vi.fn(async () => ({ status: 'success', output: 'ok' }));
    const runE2E = vi.fn(async () => ({ verdict: 'PASS', failedScenarios: [], passedScenarios: [{ name: 's' }] }));
    const persist = vi.fn(async () => 'res-pass');
    const r = await handleStagingE2e(task, { pool: {}, loadContract, runDeploy, runE2E, persist });
    expect(r.verdict).toBe('PASS');
    expect(r.deployStatus).toBe('success');
    expect(r.resultId).toBe('res-pass');
    // 第三参 opts.skipBootstrap=true（部署已就绪）
    expect(runE2E.mock.calls[0][2]).toMatchObject({ skipBootstrap: true });
    // 合同包进第二参
    expect(runE2E.mock.calls[0][1]).toMatchObject({ e2e_acceptance: acc });
  });

  it('部署成功 + E2E FAIL → FAIL，透传 failedScenarios', async () => {
    const loadContract = vi.fn(async () => acc);
    const runDeploy = vi.fn(async () => ({ status: 'success', output: 'ok' }));
    const failed = [{ name: 's', exitCode: 1, output: 'x' }];
    const runE2E = vi.fn(async () => ({ verdict: 'FAIL', failedScenarios: failed, passedScenarios: [] }));
    const persist = vi.fn(async () => 'res');
    const r = await handleStagingE2e(task, { pool: {}, loadContract, runDeploy, runE2E, persist });
    expect(r.verdict).toBe('FAIL');
    expect(persist.mock.calls[0][1].failedScenarios).toEqual(failed);
  });

  it('内部异常 → ERROR（兜底，不抛）', async () => {
    const loadContract = vi.fn(async () => { throw new Error('db down'); });
    const persist = vi.fn(async () => 'res-err');
    const r = await handleStagingE2e(task, { pool: {}, loadContract, persist });
    expect(r.verdict).toBe('ERROR');
    expect(r.skipReason).toBe('exception');
    expect(persist.mock.calls[0][1].verdict).toBe('ERROR');
  });
});

describe('task-router 注册 staging_e2e', () => {
  it('INTERNAL_TASK_HANDLERS 含 staging_e2e，getInternalTaskHandler 可解析', () => {
    expect(INTERNAL_TASK_HANDLERS.staging_e2e).toBeTypeOf('function');
    expect(getInternalTaskHandler('staging_e2e')).toBe(handleStagingE2e);
  });
});
