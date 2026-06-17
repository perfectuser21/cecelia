/**
 * evaluateContractNode — target_environment 路由（mac_web → host，其余 → docker）。
 *
 * 根因（审计结论）：
 *  - host-executor.js（executeOnHost）写好但零调用方（死代码），evaluateContractNode
 *    无条件走 spawnDockerDetached → mac_web 的 Playwright UI 验证在无浏览器容器里物理不可能。
 *  - env 缺 WECHAT_RPA_WORKFLOW（evaluator SKILL 变量表声称注入实际没有）。
 *
 * 修复：targetEnv=mac_web → executeOnHost（host 直跑，localhost 可达 Dashboard/Brain），
 *      其余环境保持 docker 路径；两路径都补注入 WECHAT_RPA_WORKFLOW。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// resolveAccount 需要 mock（不然会真去查 account-usage 表）。
vi.mock('../../spawn/middleware/account-rotation.js', () => ({
  resolveAccount: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../account-usage.js', () => ({
  isSpendingCapped: () => false,
  isAuthFailed: () => false,
  selectBestAccount: vi.fn().mockResolvedValue(null),
}));

const { evaluateContractNode } = await import('../harness-task.graph.js');

const baseState = (overrides = {}) => ({
  task: { id: 'test-task-uuid', task_type: 'harness_evaluate', payload: { sprint_dir: 'sprints/x' } },
  initiativeId: 'test-init',
  pr_url: 'https://github.com/x/y/pull/123',
  pr_branch: 'cp-test-pr-branch',
  contractBranch: 'cp-proposer-branch',
  worktreePath: '/tmp/x',
  githubToken: 'fake-token',
  fix_round: 0,
  ...overrides,
});

const baseOpts = () => ({
  resolveToken: vi.fn().mockResolvedValue('fake-token'),
  poolOverride: { query: vi.fn().mockResolvedValue({ rows: [] }) },
});

const macWebTask = () => ({
  id: 'test-task-uuid',
  task_type: 'harness_evaluate',
  payload: { sprint_dir: 'sprints/x', target_environment: 'mac_web' },
});

const tmpDirs = [];
afterEach(() => {
  while (tmpDirs.length) {
    try { rmSync(tmpDirs.pop(), { recursive: true, force: true }); } catch { /* noop */ }
  }
});

describe('evaluateContractNode target_environment 路由', () => {
  it('targetEnv=mac_web → 调 executeOnHost（非 spawnDetached），且 host env.BRAIN_URL=localhost', async () => {
    const spawnDetached = vi.fn().mockResolvedValue({ containerId: 'fake' });
    const executeOnHost = vi.fn().mockResolvedValue({ exit_code: 0, stdout: '', stderr: '' });

    const state = baseState({ worktreePath: '/tmp/does-not-exist', task: macWebTask() });

    await evaluateContractNode(state, { ...baseOpts(), spawnDetached, executeOnHost })
      .catch(() => { /* 读不到 .brain-result.json 返回 FAIL，但 executeOnHost 已被调过 */ });

    expect(executeOnHost).toHaveBeenCalledOnce();
    expect(spawnDetached).not.toHaveBeenCalled();
    const env = executeOnHost.mock.calls[0][0].env;
    expect(env.BRAIN_URL).toBe('http://localhost:5221');
    expect(env.DB).toBe('postgresql://localhost/cecelia');
    expect(env.HARNESS_CALLBACK_URL).toMatch(/^http:\/\/localhost:5221\//);
  });

  it('targetEnv=mac_web + .brain-result.json verdict=PASS → evaluate_verdict=PASS', async () => {
    const wt = mkdtempSync(path.join(tmpdir(), 'host-eval-'));
    tmpDirs.push(wt);
    writeFileSync(path.join(wt, '.brain-result.json'), JSON.stringify({ verdict: 'PASS' }), 'utf8');

    const executeOnHost = vi.fn().mockResolvedValue({ exit_code: 0, stdout: '', stderr: '' });
    const state = baseState({ worktreePath: wt, task: macWebTask() });

    const res = await evaluateContractNode(state, { ...baseOpts(), executeOnHost });
    expect(res.evaluate_verdict).toBe('PASS');
    expect(res.evaluate_error).toBeFalsy();
  });

  it('targetEnv=mac_web + executeOnHost 非 0 退出 → evaluate_verdict=FAIL', async () => {
    const executeOnHost = vi.fn().mockResolvedValue({ exit_code: 1, stdout: '', stderr: 'boom' });
    const state = baseState({ worktreePath: '/tmp/does-not-exist', task: macWebTask() });

    const res = await evaluateContractNode(state, { ...baseOpts(), executeOnHost });
    expect(res.evaluate_verdict).toBe('FAIL');
    expect(res.evaluate_error).toBeTruthy();
  });

  it('targetEnv=local_api → 仍走 spawnDetached（回归），不调 executeOnHost', async () => {
    const spawnDetached = vi.fn().mockResolvedValue({ containerId: 'fake' });
    const executeOnHost = vi.fn().mockResolvedValue({ exit_code: 0 });

    const state = baseState({
      task: { id: 'test-task-uuid', task_type: 'harness_evaluate', payload: { sprint_dir: 'sprints/x', target_environment: 'local_api' } },
    });

    await evaluateContractNode(state, { ...baseOpts(), spawnDetached, executeOnHost })
      .catch(() => { /* interrupt 抛错 OK，spawn 已被调过 */ });

    expect(spawnDetached).toHaveBeenCalledOnce();
    expect(executeOnHost).not.toHaveBeenCalled();
    const env = spawnDetached.mock.calls[0][0].env;
    expect(env.BRAIN_URL).toBe('http://host.docker.internal:5221');
  });

  it('docker 路径 spawn env 含 WECHAT_RPA_WORKFLOW', async () => {
    const spawnDetached = vi.fn().mockResolvedValue({ containerId: 'fake' });
    const state = baseState();

    await evaluateContractNode(state, { ...baseOpts(), spawnDetached }).catch(() => {});

    expect(spawnDetached).toHaveBeenCalledOnce();
    const env = spawnDetached.mock.calls[0][0].env;
    expect(env.WECHAT_RPA_WORKFLOW).toBe('e2e-wechat-rpa.yml');
  });

  it('host 路径 env 含 WECHAT_RPA_WORKFLOW', async () => {
    const executeOnHost = vi.fn().mockResolvedValue({ exit_code: 0 });
    const state = baseState({ worktreePath: '/tmp/does-not-exist', task: macWebTask() });

    await evaluateContractNode(state, { ...baseOpts(), executeOnHost }).catch(() => {});

    expect(executeOnHost).toHaveBeenCalledOnce();
    const env = executeOnHost.mock.calls[0][0].env;
    expect(env.WECHAT_RPA_WORKFLOW).toBe('e2e-wechat-rpa.yml');
  });
});
